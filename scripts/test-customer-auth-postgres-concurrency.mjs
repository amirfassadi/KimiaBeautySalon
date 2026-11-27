import assert from 'node:assert/strict';
import {randomInt} from 'node:crypto';
import {Pool} from 'pg';
import {postgresConfig} from '../server/postgres-config.js';
import {createCustomerRegistrationService} from '../server/customer-auth-registration.js';
import {createOtpVerificationService} from '../server/customer-auth-otp-verification.js';
import {hashCustomerOtp} from '../server/customer-auth-otp-crypto.js';
import {generateOpaqueCredential, hashOpaqueCredential} from '../server/customer-auth-credentials.js';
import {ACCESS_COOKIE} from '../server/customer-auth-cookies.js';
import {createCustomerAuthHttp} from '../server/customer-auth-http.js';

const connectionString = process.env.KIMIA_TEST_DATABASE_URL;
if (!connectionString) {
  console.log('Skipped customer-auth PostgreSQL concurrency test: set KIMIA_TEST_DATABASE_URL to an isolated local kimia_test_* database.');
  process.exit(0);
}

const target = new URL(connectionString);
const databaseName = decodeURIComponent(target.pathname.slice(1));
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname) ||
    !/^kimia_test_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Refusing to connect: KIMIA_TEST_DATABASE_URL must target localhost and a database named kimia_test_*.');
}

const pool = new Pool(postgresConfig({
  DATABASE_URL: connectionString,
  DATABASE_PASSWORD: process.env.KIMIA_TEST_DATABASE_PASSWORD,
}, {max: 8, application_name: 'kimia-customer-auth-concurrency-test'}));
const hashSecret = Buffer.from('dedicated-postgres-concurrency-test-secret');
const testEnv = {
  NODE_ENV: 'test',
  AUTH_CUSTOMER_ENABLED: 'true',
  AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  AUTH_CUSTOMER_PUBLIC_LINKS_ENABLED: 'false',
};
const randomPhone = () => `+9893${String(randomInt(0, 100000000)).padStart(8, '0')}`;

try {
  const identity = await pool.query(
    `select current_database() as database_name, current_user as role_name,
            role.rolsuper, role.rolbypassrls
       from pg_roles role where role.rolname=current_user`,
  );
  assert.equal(identity.rows[0]?.database_name, databaseName);
  assert.ok(identity.rows[0] && !identity.rows[0].rolsuper && !identity.rows[0].rolbypassrls,
    'Use a dedicated non-superuser, non-BYPASSRLS application role.');

  const verification = createOtpVerificationService({pool, hashSecret});
  const registration = createCustomerRegistrationService({pool});

  const otpPhone = randomPhone();
  const otpCode = String(randomInt(0, 1000000)).padStart(6, '0');
  const otpHash = hashCustomerOtp({secret: hashSecret, phone: otpPhone, code: otpCode});
  assert.equal(otpHash.ok, true);
  await pool.query(
    `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at)
     values ($1,$2,now()+interval '5 minutes')`,
    [otpPhone, otpHash.value],
  );
  const otpResults = await Promise.all([
    verification.verify({phone: otpPhone, code: otpCode}),
    verification.verify({phone: otpPhone, code: otpCode}),
  ]);
  assert.equal(otpResults.filter(result => result.ok).length, 1);
  assert.equal(otpResults.filter(result => result.code === 'otp_expired').length, 1);
  assert.equal((await pool.query(
    'select count(*)::int as count from public.kimia_customer_registration_proofs where phone_e164=$1',
    [otpPhone],
  )).rows[0].count, 1);

  const registrationPhone = randomPhone();
  const registrationCredential = generateOpaqueCredential();
  await pool.query(
    `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
     values ($1,$2,now()+interval '15 minutes')`,
    [registrationPhone, hashOpaqueCredential(registrationCredential)],
  );
  const registrationInput = {
    profile: {first_name: 'آزمون', last_name: 'هم‌زمان'},
    registrationCredential,
  };
  const registrationResults = await Promise.all([
    registration.register(registrationInput),
    registration.register(registrationInput),
  ]);
  assert.equal(registrationResults.filter(result => result.ok).length, 1);
  assert.equal(registrationResults.filter(result => result.code === 'registration_proof_missing').length, 1);
  const registeredAccount = await pool.query(
    `select id from public.kimia_customer_accounts where phone_e164=$1`,
    [registrationPhone],
  );
  assert.equal(registeredAccount.rowCount, 1);
  assert.equal((await pool.query(
    'select count(*)::int as count from public.kimia_customer_referrals where customer_account_id=$1',
    [registeredAccount.rows[0].id],
  )).rows[0].count, 1);

  const rollbackPhone = randomPhone();
  const rollbackCredential = generateOpaqueCredential();
  await pool.query(
    `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
     values ($1,$2,now()+interval '15 minutes')`,
    [rollbackPhone, hashOpaqueCredential(rollbackCredential)],
  );
  const failingPool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, values) {
          if (/insert into public\.kimia_customer_access_sessions/i.test(sql)) {
            throw new Error('Injected test-only session insert failure.');
          }
          return client.query(sql, values);
        },
        release() { client.release(); },
      };
    },
  };
  const rollbackResult = await createCustomerRegistrationService({pool: failingPool}).register({
    profile: {first_name: 'تراکنش', last_name: 'ناموفق'},
    registrationCredential: rollbackCredential,
  });
  assert.deepEqual(rollbackResult, {ok: false, code: 'auth_unavailable'});
  assert.equal((await pool.query(
    'select count(*)::int as count from public.kimia_customer_accounts where phone_e164=$1',
    [rollbackPhone],
  )).rows[0].count, 0);
  assert.equal((await pool.query(
    'select used_at from public.kimia_customer_registration_proofs where proof_hash=$1',
    [hashOpaqueCredential(rollbackCredential)],
  )).rows[0].used_at, null);

  const outageRegistration = await createCustomerRegistrationService({
    pool: {connect: async () => { throw new Error('Injected test-only database outage.'); }},
  }).register({
    profile: {first_name: 'قطعی', last_name: 'آزمایشی'},
    registrationCredential: generateOpaqueCredential(),
  });
  assert.deepEqual(outageRegistration, {ok: false, code: 'auth_unavailable'});

  const replacementPhone = randomPhone();
  const account = await pool.query(
    `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
     values ($1,'نشست','آزمایشی') returning id`,
    [replacementPhone],
  );
  const previousCredential = generateOpaqueCredential();
  await pool.query(
    `insert into public.kimia_customer_access_sessions
       (account_id,phone_e164,token_hash,expires_at)
     values ($1,$2,$3,now()+interval '30 days')`,
    [account.rows[0].id, replacementPhone, hashOpaqueCredential(previousCredential)],
  );
  const replacementCode = String(randomInt(0, 1000000)).padStart(6, '0');
  const replacementHash = hashCustomerOtp({
    secret: hashSecret,
    phone: replacementPhone,
    code: replacementCode,
  });
  await pool.query(
    `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at)
     values ($1,$2,now()+interval '5 minutes')`,
    [replacementPhone, replacementHash.value],
  );
  const replacement = await verification.verify({
    phone: replacementPhone,
    code: replacementCode,
    previousCredential: {type: 'access', raw: previousCredential},
  });
  assert.equal(replacement.ok, true);
  assert.equal(replacement.is_new_user, false);
  assert.equal((await pool.query(
    'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
    [hashOpaqueCredential(previousCredential)],
  )).rows[0].revoked, true);

  const http = createCustomerAuthHttp({
    pool,
    env: testEnv,
    adminSession: async () => ({id: 'isolated-test-admin'}),
    readiness: async () => ({ok: true}),
  });
  const logoutRequest = () => new Request('http://127.0.0.1/api/auth/logout', {
    method: 'POST',
    headers: {
      origin: 'http://127.0.0.1',
      'content-type': 'application/json',
      cookie: `${ACCESS_COOKIE}=${replacement.credential.raw}`,
    },
    body: '{}',
  });
  const logoutResponses = await Promise.all([
    http.handle(logoutRequest()),
    http.handle(logoutRequest()),
  ]);
  assert.deepEqual(logoutResponses.map(response => response.status), [200, 200]);
  assert.match(logoutResponses[0].headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal((await pool.query(
    'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
    [hashOpaqueCredential(replacement.credential.raw)],
  )).rows[0].revoked, true);

  console.log(`Customer-auth PostgreSQL concurrency/rollback checks passed for ${databaseName}. Test rows remain in this disposable database.`);
} finally {
  await pool.end();
}
