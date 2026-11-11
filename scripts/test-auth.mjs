import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

const migrationNames = [
  '001_initial_schema.sql',
  '002_admin_booking.sql',
  '003_booking_tracking.sql',
  '004_customer_auth.sql',
];
const phone = '+989307897825';
const otherPhone = '+989111111111';
const ipHash = 'a'.repeat(64);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const db = new PGlite({extensions: {pgcrypto}});

await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const name of migrationNames) {
  await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
}

const createOtp = (p, code) => db.query(
  'select * from public.create_customer_otp($1,$2,$3)',
  [p, hash(code), ipHash],
);
const verifyOtp = (p, code, session) => db.query(
  'select * from public.verify_customer_otp($1,$2,$3)',
  [p, hash(code), hash(session)],
);
const register = (p, temp, first, last, marketing, session) => db.query(
  'select * from public.register_customer($1,$2,$3,$4,$5,$6)',
  [p, hash(temp), first, last, marketing, hash(session)],
);

let challenge = (await createOtp(phone, 'correct')).rows[0];
assert.ok(challenge.challenge_id);
assert.equal((await db.query('select count(*)::int as n from customer_otp_challenges')).rows[0].n, 1);
assert.equal((await verifyOtp(phone, 'wrong', 'session-1')).rows.length, 0);
assert.equal((await db.query('select attempts from customer_otp_challenges where id=$1', [challenge.challenge_id])).rows[0].attempts, 1);
for (let i = 0; i < 4; i++) assert.equal((await verifyOtp(phone, 'wrong', 'session-' + i)).rows.length, 0);
await assert.rejects(verifyOtp(phone, 'wrong', 'locked'), /otp_locked/);

challenge = (await createOtp(phone, 'fresh')).rows[0];
await db.query('update customer_otp_challenges set expires_at=now()-interval \'1 second\' where id=$1', [challenge.challenge_id]);
await assert.rejects(verifyOtp(phone, 'fresh', 'expired'), /otp_expired/);

challenge = (await createOtp(phone, 'usable')).rows[0];
const verification = (await verifyOtp(phone, 'usable', 'registration-token')).rows[0];
assert.equal(verification.is_new_user, true);
assert.ok(verification.account_id === null);
assert.equal((await db.query("select token_type from customer_sessions where token_hash=$1", [hash('registration-token')])).rows[0].token_type, 'registration');
await assert.rejects(verifyOtp(phone, 'usable', 'reused'), /otp_expired/);
await assert.rejects(register(otherPhone, 'registration-token', 'نام', 'خانوادگی', false, 'access-other'), /registration_expired/);
const account = (await register(phone, 'registration-token', 'نام', 'خانوادگی', true, 'access-1')).rows[0];
assert.ok(account.account_id);
await assert.rejects(register(phone, 'registration-token', 'نام', 'خانوادگی', true, 'access-2'), /registration_expired/);
assert.equal((await db.query('select phone_e164, marketing_consent from customer_accounts where id=$1', [account.account_id])).rows[0].marketing_consent, true);
assert.equal((await db.query('select count(*)::int as n from customer_accounts where phone_e164=$1', [phone])).rows[0].n, 1);
await db.query("update customer_auth_rate_limits set window_started_at=now()-interval '1 hour' where rate_key='phone:' || md5($1)", [phone]);
challenge = (await createOtp(phone, 'existing')).rows[0];
const existingVerification = (await verifyOtp(phone, 'existing', 'access-existing')).rows[0];
assert.equal(existingVerification.is_new_user, false);
assert.equal(existingVerification.account_id, account.account_id);
const accessSession = (await db.query("select expires_at, token_type, phone_e164 from customer_sessions where token_hash=$1", [hash('access-existing')])).rows[0];
assert.equal(accessSession.token_type, 'access');
assert.equal(accessSession.phone_e164, phone);
await db.query("update customer_sessions set expires_at=now()-interval '1 second' where token_hash=$1", [hash('access-existing')]);
assert.ok((await db.query("select expires_at <= now() as expired from customer_sessions where token_hash=$1", [hash('access-existing')])).rows[0].expired);

await db.exec('set role anon');
for (const table of ['customer_accounts', 'customer_otp_challenges', 'customer_sessions', 'customer_auth_rate_limits']) {
  await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
}
await db.exec('reset role');
await db.close();

const {default: worker} = await import(new URL('../dist/server/index.js', import.meta.url));
const disabledRequest = (path, body) => worker.fetch(new Request('https://kimia-beauty-salon.test' + path, {
  method: 'POST',
  headers: {'content-type': 'application/json', origin: 'https://kimia-beauty-salon.test'},
  body: JSON.stringify(body),
}), {});
for (const path of ['/api/auth/otp/send', '/api/auth/otp/verify', '/api/auth/register']) {
  const response = await disabledRequest(path, {phone: '۰۹۳۰۷۸۹۷۸۲۵', code: '123456', temp_token: 'x'.repeat(43)});
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /123456|token|secret/i);
}

const originalFetch = globalThis.fetch;
const calls = [];
const completeAuthEnv = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SECRET_KEY: 'secret-key',
  RATE_LIMIT_SALT: 'salt',
  AUTH_SMS_URL: 'https://sms.test/send',
  AUTH_SMS_TOKEN: 'sms-token',
};
for (const flag of [false, 'false', 'enabled', undefined]) {
  const externalCalls = [];
  globalThis.fetch = async (input) => {
    externalCalls.push(String(input));
    throw new Error('disabled auth must not call external services');
  };
  const env = {...completeAuthEnv, AUTH_CUSTOMER_ENABLED: flag};
  const status = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/auth/status'), env);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {enabled: false});
  const disabled = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/auth/otp/send', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({phone}),
  }), env);
  assert.equal(disabled.status, 503);
  assert.equal(externalCalls.length, 0);
}
globalThis.fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (url.endsWith('/rpc/create_customer_otp')) {
    return new Response(JSON.stringify([{challenge_id: '00000000-0000-0000-0000-000000000001'}]), {status: 200});
  }
  if (url.endsWith('/rpc/revoke_customer_otp')) return new Response('', {status: 204});
  if (url === 'https://sms.test/send') return new Response('provider failure', {status: 500});
  throw new Error('unexpected mocked request');
};
try {
  const response = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/auth/otp/send', {
    method: 'POST',
    headers: {'content-type': 'application/json', origin: 'https://kimia-beauty-salon.test'},
    body: JSON.stringify({phone}),
  }), {
    ...completeAuthEnv,
    AUTH_CUSTOMER_ENABLED: 'true',
  });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /correct|123456|sms-token/i);
  assert.ok(calls.some((url) => url.endsWith('/rpc/revoke_customer_otp')));
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.endsWith('/rpc/verify_customer_otp')) {
    return new Response(JSON.stringify([{is_new_user: true, account_id: null}]), {status: 200});
  }
  if (url.endsWith('/rpc/register_customer')) {
    return new Response(JSON.stringify([{account_id: '00000000-0000-0000-0000-000000000002'}]), {status: 200});
  }
  throw new Error('unexpected mocked request');
};
try {
  const verifyResponse = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/auth/otp/verify', {
    method: 'POST',
    headers: {'content-type': 'application/json', origin: 'https://kimia-beauty-salon.test'},
    body: JSON.stringify({phone, code: '123456'}),
  }), {
    ...completeAuthEnv,
    AUTH_CUSTOMER_ENABLED: 'true',
  });
  assert.equal(verifyResponse.status, 200);
  const verifyBody = await verifyResponse.json();
  assert.equal(verifyBody.is_new_user, true);
  assert.match(verifyBody.temp_token, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(verifyBody), /123456|sms-token|secret-key/i);

  const registerResponse = await worker.fetch(new Request('https://kimia-beauty-salon.test/api/auth/register', {
    method: 'POST',
    headers: {'content-type': 'application/json', origin: 'https://kimia-beauty-salon.test'},
    body: JSON.stringify({phone, temp_token: verifyBody.temp_token, first_name: 'نام', last_name: 'خانوادگی', marketing: false}),
  }), {
    ...completeAuthEnv,
    AUTH_CUSTOMER_ENABLED: 'true',
  });
  assert.equal(registerResponse.status, 201);
  const registerBody = await registerResponse.json();
  assert.match(registerBody.session_token, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(registerBody), /123456|sms-token|secret-key/i);
  assert.match(registerResponse.headers.get('set-cookie') || '', /HttpOnly; Secure; SameSite=Lax/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Customer auth tests passed: migrations, OTP lifecycle, registration binding, sessions, RLS, inactive routes, and SMS failure handling.');
