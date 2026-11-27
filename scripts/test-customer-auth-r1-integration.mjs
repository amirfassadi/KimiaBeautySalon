import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer, request as httpRequest} from 'node:http';
import {Script} from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createStandaloneHandler} from '../server/index.js';
import {createCustomerSmsTestTransport, createCustomerSmsAdapter} from '../server/customer-auth-sms.js';
import {provisionAdmin} from '../server/bootstrap-admin.js';
import {hashOpaqueCredential, generateOpaqueCredential} from '../server/customer-auth-credentials.js';

const db = new PGlite({extensions: {pgcrypto}});
await db.exec('create extension if not exists pgcrypto');
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create role kimia_app nosuperuser nobypassrls;
  grant usage, create on schema public to kimia_app;
  set role kimia_app;
`);
for (const name of [
  '001_initial_schema.sql',
  '002_admin_booking.sql',
  '003_booking_tracking.sql',
  '005_self_hosted_admin.sql',
  '006_customer_auth_v1.sql',
  '007_customer_referrals.sql',
]) {
  await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
}
await db.exec('reset role');
await db.exec('set role kimia_app');

const pool = {
  async query(sql, values = []) {
    if (!values.length && (sql.match(/;/g) || []).length > 1) {
      await db.exec(sql);
      return {rows: []};
    }
    return db.query(sql, values);
  },
  async connect() {
    return {
      async query(sql, values = []) {
        if (/^begin$/i.test(sql.trim())) return db.query('begin');
        if (/^commit$/i.test(sql.trim())) return db.query('commit');
        if (/^rollback$/i.test(sql.trim())) return db.query('rollback');
        if (/pg_advisory_(?:xact_)?lock/i.test(sql)) return {rows: [{}]};
        if (!values.length && (sql.match(/;/g) || []).length > 1) {
          await db.exec(sql);
          return {rows: []};
        }
        return db.query(sql, values);
      },
      release() {},
    };
  },
  async end() {},
};

await provisionAdmin(pool, 'owner@example.test', 'a sufficiently long test password');

const tempDir = await mkdtemp(path.join(tmpdir(), 'kimia-auth-r1-'));
const uploadDir = path.join(tempDir, 'uploads');
const env = {
  DATABASE_URL: 'postgresql://kimia_app@localhost/kimia_test_r1',
  PUBLIC_BASE_URL: 'https://kbkimiabeauty.ir',
  NODE_ENV: 'test',
};

async function listen(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, base: `http://127.0.0.1:${server.address().port}`};
}

function assertInlineScriptsParse(html, pageName) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length, `${pageName} page must include its interaction script.`);
  for (const [index, match] of scripts.entries()) {
    assert.doesNotThrow(() => new Script(match[1]), `${pageName} inline script ${index + 1} must parse.`);
  }
}

// Missing transport: preview admin must not be reported ready.
const noSmsHandler = await createStandaloneHandler({
  pool,
  env: {
    ...env,
    AUTH_CUSTOMER_ENABLED: 'true',
    AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  },
  uploadDir,
  allowedHosts: ['127.0.0.1', 'localhost', 'kbkimiabeauty.ir'],
});
const noSmsServer = await listen(noSmsHandler);
const noSmsLogin = await fetch(noSmsServer.base + '/api/admin-auth/login', {
  method: 'POST',
  headers: {origin: noSmsServer.base, 'content-type': 'application/json'},
  body: JSON.stringify({email: 'owner@example.test', password: 'a sufficiently long test password'}),
});
assert.equal(noSmsLogin.status, 200);
const adminCookie = noSmsLogin.headers.get('set-cookie')?.split(';')[0];
const noSmsStatus = await fetch(noSmsServer.base + '/api/auth/status', {
  headers: {cookie: adminCookie},
});
assert.equal(noSmsStatus.status, 200);
assert.deepEqual(await noSmsStatus.json(), {enabled: false, reason: 'missing_configuration'});
const noSmsReferralAdmin = await fetch(noSmsServer.base + '/api/admin/customer-referrals', {
  headers: {cookie: adminCookie},
});
assert.equal(noSmsReferralAdmin.status, 200);
assert.deepEqual((await noSmsReferralAdmin.json()).customers, []);
await new Promise(resolve => noSmsServer.server.close(resolve));

const secret = 'r'.repeat(32);
const testTransport = createCustomerSmsTestTransport({runtimeMode: 'test'});
const testSmsAdapter = createCustomerSmsAdapter({
  transport: testTransport,
  runtimeMode: 'test',
  timeoutMs: 50,
});

const malformedTransportHandler = await createStandaloneHandler({
  pool,
  env: {
    ...env,
    AUTH_CUSTOMER_ENABLED: 'true',
    AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  },
  uploadDir,
  allowedHosts: ['127.0.0.1', 'localhost', 'kbkimiabeauty.ir'],
  smsAdapter: {},
  hashSecret: secret,
});
const malformedTransportServer = await listen(malformedTransportHandler);
const malformedAdminLogin = await fetch(malformedTransportServer.base + '/api/admin-auth/login', {
  method: 'POST',
  headers: {origin: malformedTransportServer.base, 'content-type': 'application/json'},
  body: JSON.stringify({email: 'owner@example.test', password: 'a sufficiently long test password'}),
});
const malformedAdminCookie = malformedAdminLogin.headers.get('set-cookie')?.split(';')[0];
const malformedStatus = await fetch(malformedTransportServer.base + '/api/auth/status', {
  headers: {cookie: malformedAdminCookie},
});
assert.equal(malformedStatus.status, 200);
assert.deepEqual(await malformedStatus.json(), {enabled: false, reason: 'missing_configuration'});
await new Promise(resolve => malformedTransportServer.server.close(resolve));

const missingSecretHandler = await createStandaloneHandler({
  pool,
  env: {
    ...env,
    AUTH_CUSTOMER_ENABLED: 'true',
    AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  },
  uploadDir,
  allowedHosts: ['127.0.0.1', 'localhost', 'kbkimiabeauty.ir'],
  smsAdapter: testSmsAdapter,
  hashSecret: null,
});
const missingSecretServer = await listen(missingSecretHandler);
const missingSecretLogin = await fetch(missingSecretServer.base + '/api/admin-auth/login', {
  method: 'POST',
  headers: {origin: missingSecretServer.base, 'content-type': 'application/json'},
  body: JSON.stringify({email: 'owner@example.test', password: 'a sufficiently long test password'}),
});
const missingSecretCookie = missingSecretLogin.headers.get('set-cookie')?.split(';')[0];
const missingSecretStatus = await fetch(missingSecretServer.base + '/api/auth/status', {
  headers: {cookie: missingSecretCookie},
});
assert.equal(missingSecretStatus.status, 200);
assert.deepEqual(await missingSecretStatus.json(), {enabled: false, reason: 'missing_configuration'});
await new Promise(resolve => missingSecretServer.server.close(resolve));


// Explicit test transport composition through createStandaloneHandler.
const handler = await createStandaloneHandler({
  pool,
  env: {
    ...env,
    AUTH_CUSTOMER_ENABLED: 'true',
    AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  },
  uploadDir,
  allowedHosts: ['127.0.0.1', 'localhost', 'kbkimiabeauty.ir'],
  smsAdapter: testSmsAdapter,
  hashSecret: secret,
});
const synthetic = await listen(handler);

const login = await fetch(synthetic.base + '/api/admin-auth/login', {
  method: 'POST',
  headers: {origin: synthetic.base, 'content-type': 'application/json'},
  body: JSON.stringify({email: 'owner@example.test', password: 'a sufficiently long test password'}),
});
assert.equal(login.status, 200);
const adminCookieReady = login.headers.get('set-cookie')?.split(';')[0];
const status = await fetch(synthetic.base + '/api/auth/status', {
  headers: {cookie: adminCookieReady},
});
assert.equal(status.status, 200);
assert.deepEqual(await status.json(), {enabled: true});
const customerLoginPage = await fetch(synthetic.base + '/login', {
  headers: {cookie: adminCookieReady},
});
assert.equal(customerLoginPage.status, 200);
const loginMarkup = await customerLoginPage.text();
assertInlineScriptsParse(loginMarkup, 'customer login');
assert.equal(customerLoginPage.headers.get('cache-control'), 'no-store');
assert.equal(customerLoginPage.headers.get('x-robots-tag'), 'noindex, nofollow');
assert.match(customerLoginPage.headers.get('content-security-policy'), /font-src 'self'/);
assert.match(loginMarkup, /ارسال مجدد کد/);
assert.match(loginMarkup, /اصلاح شمارهٔ همراه/);
assert.doesNotMatch(loginMarkup, /access_token|session_token|temp_token/i);
const missingProofPage = await fetch(synthetic.base + '/register', {
  headers: {cookie: adminCookieReady},
  redirect: 'manual',
});
assert.equal(missingProofPage.status, 302);
assert.equal(missingProofPage.headers.get('location'), '/login');
const expiredProofRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at,created_at)
   values ('+989311111112',$1,now()-interval '1 second',now()-interval '16 minutes')`,
  [hashOpaqueCredential(expiredProofRaw)],
);
const expiredProofPage = await fetch(synthetic.base + '/register', {
  headers: {cookie: `${adminCookieReady}; kimia_customer_registration=${expiredProofRaw}`},
  redirect: 'manual',
});
assert.equal(expiredProofPage.status, 302);
assert.equal(expiredProofPage.headers.get('location'), '/login');
assert.match(expiredProofPage.headers.get('set-cookie'), /kimia_customer_registration=;/);
const databaseExpiredProofPool = {
  ...pool,
  async query(sql, values = []) {
    const result = await pool.query(sql, values);
    if (/expires_at\s*>\s*now\(\)\)\s+as unexpired/i.test(sql)) {
      return {...result, rows: result.rows.map(row => ({...row, unexpired: false}))};
    }
    return result;
  },
};
const databaseExpiredProofHandler = await createStandaloneHandler({
  pool: databaseExpiredProofPool,
  env: {...env, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  uploadDir,
  allowedHosts: ['127.0.0.1', 'localhost', 'kbkimiabeauty.ir'],
  smsAdapter: testSmsAdapter,
  hashSecret: secret,
});
const databaseExpiredProofServer = await listen(databaseExpiredProofHandler);
const originalDateNow = Date.now;
Date.now = () => originalDateNow() - 24 * 60 * 60 * 1000;
try {
  const skewedClockProofPage = await fetch(databaseExpiredProofServer.base + '/register', {
    headers: {cookie: `${adminCookieReady}; kimia_customer_registration=${expiredProofRaw}`},
    redirect: 'manual',
  });
  assert.equal(skewedClockProofPage.status, 302);
  assert.equal(skewedClockProofPage.headers.get('location'), '/login');
} finally {
  Date.now = originalDateNow;
  await new Promise(resolve => databaseExpiredProofServer.server.close(resolve));
}

const forbiddenStatus = await fetch(synthetic.base + '/api/auth/status');
assert.equal(forbiddenStatus.status, 200);
assert.deepEqual(await forbiddenStatus.json(), {enabled: false, reason: 'feature_disabled'});
const forgedAdminReferral = await fetch(synthetic.base + '/api/admin/customer-referrals', {
  headers: {'oai-authenticated-user-id': 'forged', 'x-kimia-admin-id': 'forged'},
});
assert.equal(forgedAdminReferral.status, 401);

const expiredOtpSend = await fetch(synthetic.base + '/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({phone: '+989311111112'}),
});
assert.equal(expiredOtpSend.status, 202);
const expiredOtpCode = testTransport.getOutbox().find(entry => entry.phone === '+989311111112').code;
await db.query(
  `update public.kimia_customer_otp_challenges
      set expires_at=now()-interval '1 second',created_at=now()-interval '10 minutes'
    where phone_e164='+989311111112'`,
);
const expiredOtpVerify = await fetch(synthetic.base + '/api/auth/otp/verify', {
  method: 'POST',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({phone: '+989311111112', code: expiredOtpCode}),
});
assert.equal(expiredOtpVerify.status, 410);
assert.equal((await expiredOtpVerify.json()).code, 'otp_expired');

const oldAccessRaw = 'A'.repeat(43);
const oldProofRaw = 'P'.repeat(43);
const previousAccount = (await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989222222220','مشتری','پیشین') returning id`,
)).rows[0].id;
const otherDeviceRaw = 'O'.repeat(43);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989222222220',$2,now()+interval '30 days')`,
  [previousAccount, hashOpaqueCredential(oldAccessRaw)],
);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989222222220',$2,now()+interval '30 days')`,
  [previousAccount, hashOpaqueCredential(otherDeviceRaw)],
);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
   values ('+989222222220',$1,now()+interval '15 minutes')`,
  [hashOpaqueCredential(oldProofRaw)],
);

const send = await fetch(synthetic.base + '/api/auth/otp/send', {
  method: 'POST',
  headers: {
    origin: synthetic.base,
    'content-type': 'application/json',
    cookie: `${adminCookieReady}; kimia_customer_session=${oldAccessRaw}; kimia_customer_registration=${oldProofRaw}`,
    'cf-connecting-ip': '127.0.0.1',
  },
  body: JSON.stringify({phone: '۰۹۳۰۷۸۹۷۸۲۵'}),
});
assert.equal(send.status, 202);
const code = testTransport.getOutbox().find(entry => entry.phone === '+989307897825').code;
const resendLimited = await fetch(synthetic.base + '/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({phone: '+989307897825'}),
});
assert.equal(resendLimited.status, 429);
assert.ok(Number(resendLimited.headers.get('retry-after')) > 0);

const verify = await fetch(synthetic.base + '/api/auth/otp/verify', {
  method: 'POST',
  headers: {
    origin: synthetic.base,
    'content-type': 'application/json',
    cookie: `${adminCookieReady}; kimia_customer_session=${oldAccessRaw}; kimia_customer_registration=${oldProofRaw}`,
  },
  body: JSON.stringify({phone: '+989307897825', code}),
});
assert.equal(verify.status, 200);
assert.equal(verify.headers.get('cache-control'), 'no-store');
assert.match(verify.headers.get('set-cookie'), /HttpOnly/);
const proofCookie = verify.headers.get('set-cookie')?.split(';')[0];
assert.match(proofCookie, /^kimia_customer_registration=/);
const registrationPage = await fetch(synthetic.base + '/register', {
  headers: {cookie: `${adminCookieReady}; ${proofCookie}`},
});
assert.equal(registrationPage.status, 200);
const registrationMarkup = await registrationPage.text();
assert.match(registrationMarkup, /راه آشنایی با سایت/);
assertInlineScriptsParse(registrationMarkup, 'customer registration');
assert.match(verify.headers.get('set-cookie'), /kimia_customer_session=;/);
const verifySetCookies = verify.headers.getSetCookie?.() || verify.headers.raw?.()['set-cookie'] || [];
assert.ok(verifySetCookies.some(value => value.startsWith('kimia_customer_registration=')));
assert.ok(verifySetCookies.some(value => value.startsWith('kimia_customer_session=;')));
assert.ok(verifySetCookies.find(value => value.startsWith('kimia_customer_registration='))?.includes('Max-Age=900'));
assert.ok(verifySetCookies.find(value => value.startsWith('kimia_customer_session=;'))?.includes('Max-Age=0'));
assert.doesNotMatch(JSON.stringify(await verify.json()), /token|secret|hash|[0-9]{6}/i);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(oldAccessRaw)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is not null and used_at is null as revoked from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(oldProofRaw)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(otherDeviceRaw)],
)).rows[0].active, true);

const registrationOldAccessRaw = 'R'.repeat(43);
const registrationOtherDeviceRaw = 'T'.repeat(43);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989222222220',$2,now()+interval '30 days')`,
  [previousAccount, hashOpaqueCredential(registrationOldAccessRaw)],
);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989222222220',$2,now()+interval '30 days')`,
  [previousAccount, hashOpaqueCredential(registrationOtherDeviceRaw)],
);
const register = await fetch(synthetic.base + '/api/auth/register', {
  method: 'POST',
  headers: {
    origin: synthetic.base,
    'content-type': 'application/json',
    cookie: `${adminCookieReady}; ${proofCookie}; kimia_customer_session=${registrationOldAccessRaw}`,
  },
  body: JSON.stringify({
    first_name: 'نام',
    last_name: 'خانوادگی',
    marketing: false,
    referral: {
      discovery_channel: 'personal_referral',
      same_referrer: true,
      site_referrer: {status: 'pending', kind: 'name', value: 'معرف اعلام‌شده'},
      salon_referrer: {status: 'pending', kind: 'name', value: 'معرف اعلام‌شده'},
    },
  }),
});
assert.equal(register.status, 201);
const registerSetCookies = register.headers.getSetCookie?.() || [];
const setCookies = registerSetCookies.join(', ') || register.headers.get('set-cookie');
assert.match(setCookies, /kimia_customer_session=/);
assert.ok(registerSetCookies.some(value => value.startsWith('kimia_customer_session=')));
assert.ok(registerSetCookies.some(value => value.startsWith('kimia_customer_registration=;')));
assert.ok(registerSetCookies.find(value => value.startsWith('kimia_customer_session='))?.includes('Max-Age=2592000'));
assert.ok(registerSetCookies.find(value => value.startsWith('kimia_customer_registration=;'))?.includes('Max-Age=0'));
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(registrationOldAccessRaw)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(registrationOtherDeviceRaw)],
)).rows[0].active, true);
assert.equal((await db.query(
  'select used_at is not null as used,revoked_at is null as no_revoke from public.kimia_customer_registration_proofs where phone_e164=$1',
  ['+989307897825'],
)).rows[0].used, true);

const accessCookie = registerSetCookies.find(value => value.startsWith('kimia_customer_session='))?.split(';')[0];
assert.ok(accessCookie);
const accountPage = await fetch(synthetic.base + '/account', {
  headers: {cookie: `${adminCookieReady}; ${accessCookie}`},
});
assert.equal(accountPage.status, 200);
const accountMarkup = await accountPage.text();
assert.match(accountMarkup, /حساب من/);
assertInlineScriptsParse(accountMarkup, 'customer account');
const customerId = (await db.query(
  `select id from public.kimia_customer_accounts where phone_e164='+989307897825'`,
)).rows[0].id;
const customerDeclaration = (await db.query(
  `select site_declaration_status,site_declaration_kind,site_declaration_value,
          salon_declaration_status,salon_declaration_value,
          same_referrer_declared,site_verification_status
     from public.kimia_customer_referrals where customer_account_id=$1`,
  [customerId],
)).rows[0];
assert.deepEqual(customerDeclaration, {
  site_declaration_status: 'pending',
  site_declaration_kind: 'name',
  site_declaration_value: 'معرف اعلام‌شده',
  salon_declaration_status: 'pending',
  salon_declaration_value: 'معرف اعلام‌شده',
  same_referrer_declared: true,
  site_verification_status: 'not_reviewed',
});

const existingCustomerId = (await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989311111111','پریناز','قدیمی') returning id`,
)).rows[0].id;
const existingCustomerEdit = await fetch(synthetic.base + `/api/admin/customer-referrals/${existingCustomerId}`, {
  method: 'PUT',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({
    discovery_channel: 'instagram',
    site_referrer: {status: 'unknown'},
    salon_referrer: {status: 'none'},
  }),
});
assert.equal(existingCustomerEdit.status, 200);
assert.equal((await existingCustomerEdit.json()).referral.site.status, 'unknown');

const anonymousReferrals = await fetch(synthetic.base + '/api/admin/customer-referrals');
assert.equal(anonymousReferrals.status, 401);
const customerOnlyReferrals = await fetch(synthetic.base + '/api/admin/customer-referrals', {
  headers: {cookie: accessCookie},
});
assert.equal(customerOnlyReferrals.status, 401);
let referralsResponse = await fetch(synthetic.base + '/api/admin/customer-referrals?search=نام', {
  headers: {cookie: adminCookieReady},
});
assert.equal(referralsResponse.status, 200);
let referralList = await referralsResponse.json();
assert.equal(referralList.customers.length, 1);
assert.equal(referralList.customers[0].id, customerId);
assert.equal(referralList.customers[0].site_declaration_status, 'pending');
assert.equal(referralList.customers[0].site_verification_status, 'not_reviewed');

const invalidReferralOrigin = await fetch(synthetic.base + `/api/admin/customer-referrals/${customerId}`, {
  method: 'PUT',
  headers: {'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({discovery_channel: 'search', site_referrer: {status: 'none'}, salon_referrer: {status: 'none'}}),
});
assert.equal(invalidReferralOrigin.status, 403);
const invalidSameReferral = await fetch(synthetic.base + `/api/admin/customer-referrals/${customerId}`, {
  method: 'PUT',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({
    discovery_channel: 'search',
    site_referrer: {status: 'unknown'},
    salon_referrer: {same_as_site: true},
  }),
});
assert.equal(invalidSameReferral.status, 400);

referralsResponse = await fetch(synthetic.base + `/api/admin/customer-referrals/${customerId}`, {
  method: 'PUT',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({
    discovery_channel: 'personal_referral',
    site_referrer: {
      status: 'confirmed',
      name: 'معرف بیرونی',
      person_kind: 'external',
      introduced_on: '2026-02-01',
    },
    salon_referrer: {same_as_site: true, introduced_on: '2026-02-03'},
    change_reason: 'بررسی اولیه',
  }),
});
assert.equal(referralsResponse.status, 200);
const firstReview = await referralsResponse.json();
assert.equal(firstReview.referral.site.status, 'confirmed');
assert.equal(firstReview.referral.site.person.kind, 'external');
assert.equal(firstReview.referral.salon.person.id, firstReview.referral.site.person.id);
assert.equal(firstReview.referral.customer_declaration.site.status, 'pending');
assert.equal(firstReview.referral.recorded_by_admin_id !== null, true);

referralsResponse = await fetch(synthetic.base + `/api/admin/customer-referrals/${customerId}`, {
  method: 'PUT',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: adminCookieReady},
  body: JSON.stringify({
    discovery_channel: 'personal_referral',
    site_referrer: {status: 'confirmed', name: 'معرف هم‌نام', person_kind: 'external'},
    salon_referrer: {status: 'confirmed', name: 'معرف هم‌نام', person_kind: 'external'},
    change_reason: 'دو شخص هم‌نام با معرفی جداگانه',
  }),
});
assert.equal(referralsResponse.status, 200);
const corrected = await referralsResponse.json();
assert.notEqual(corrected.referral.site.person.id, corrected.referral.salon.person.id);
assert.equal(corrected.referral.site.person.name, corrected.referral.salon.person.name);
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_referral_history where customer_account_id=$1',
  [customerId],
)).rows[0].count, 2);
const referralHistory = await fetch(synthetic.base + `/api/admin/customer-referrals/${customerId}/history`, {
  headers: {cookie: adminCookieReady},
});
assert.equal(referralHistory.status, 200);
assert.equal((await referralHistory.json()).history.length, 2);

const accountExistsPhone = '+989322222221';
const accountExistsId = (await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ($1,'مشتری','پیشین') returning id`,
  [accountExistsPhone],
)).rows[0].id;
const accountExistsAccessRaw = generateOpaqueCredential();
const accountExistsOtherDeviceRaw = generateOpaqueCredential();
const accountExistsProofRaw = generateOpaqueCredential();
for (const raw of [accountExistsAccessRaw, accountExistsOtherDeviceRaw]) {
  await db.query(
    `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
     values ($1,$2,$3,now()+interval '30 days')`,
    [accountExistsId, accountExistsPhone, hashOpaqueCredential(raw)],
  );
}
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
   values ($1,$2,now()+interval '15 minutes')`,
  [accountExistsPhone, hashOpaqueCredential(accountExistsProofRaw)],
);
const cleanupFailPool = {
  ...pool,
  async connect() {
    const client = await pool.connect();
    return {
      ...client,
      async query(sql, values = []) {
        if (/update public\.kimia_customer_access_sessions set revoked_at/i.test(sql)) {
          throw new Error('injected cleanup failure');
        }
        return client.query(sql, values);
      },
    };
  },
};
const cleanupFailHandler = await createStandaloneHandler({
  pool: cleanupFailPool,
  env: {...env, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  uploadDir,
  allowedHosts: ['127.0.0.1', 'localhost', 'kbkimiabeauty.ir'],
  smsAdapter: testSmsAdapter,
  hashSecret: secret,
});
const cleanupFailServer = await listen(cleanupFailHandler);
const cleanupFailure = await fetch(cleanupFailServer.base + '/api/auth/register', {
  method: 'POST',
  headers: {
    origin: cleanupFailServer.base,
    'content-type': 'application/json',
    cookie: `${adminCookieReady}; kimia_customer_session=${accountExistsAccessRaw}; kimia_customer_registration=${accountExistsProofRaw}`,
  },
  body: JSON.stringify({first_name: 'نام', last_name: 'خانوادگی'}),
});
assert.equal(cleanupFailure.status, 503);
assert.deepEqual(cleanupFailure.headers.getSetCookie?.() || [], []);
assert.equal((await db.query(
  'select used_at is null and revoked_at is null as unchanged from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(accountExistsProofRaw)],
)).rows[0].unchanged, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(accountExistsAccessRaw)],
)).rows[0].active, true);
await new Promise(resolve => cleanupFailServer.server.close(resolve));

const accountExists = await fetch(synthetic.base + '/api/auth/register', {
  method: 'POST',
  headers: {
    origin: synthetic.base,
    'content-type': 'application/json',
    cookie: `${adminCookieReady}; kimia_customer_session=${accountExistsAccessRaw}; kimia_customer_registration=${accountExistsProofRaw}`,
  },
  body: JSON.stringify({first_name: 'نام', last_name: 'خانوادگی'}),
});
assert.equal(accountExists.status, 409);
assert.equal((await accountExists.json()).recovery_action, 'login');
const accountExistsCookies = accountExists.headers.getSetCookie?.() || [];
assert.equal(accountExistsCookies.length, 2);
assert.ok(accountExistsCookies.every(value => value.includes('Path=/') && value.includes('HttpOnly') &&
  value.includes('SameSite=Lax') && value.includes('Max-Age=0')));
assert.ok(accountExistsCookies.some(value => value.startsWith('kimia_customer_session=;')));
assert.ok(accountExistsCookies.some(value => value.startsWith('kimia_customer_registration=;')));
assert.equal((await db.query(
  'select used_at is not null and revoked_at is null as consumed from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(accountExistsProofRaw)],
)).rows[0].consumed, true);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(accountExistsAccessRaw)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(accountExistsOtherDeviceRaw)],
)).rows[0].active, true);

const me = await fetch(synthetic.base + '/api/auth/me', {
  headers: {cookie: `${adminCookieReady}; ${accessCookie}`},
});
assert.equal(me.status, 200);
assert.deepEqual(await me.json(), {
  authenticated: true,
  first_name: 'نام',
  last_name: 'خانوادگی',
  phone_e164: '+989307897825',
  marketing: false,
});

const previousAccessRaw = accessCookie.slice('kimia_customer_session='.length);
const previousAccessHash = hashOpaqueCredential(previousAccessRaw);
const returningOldProofRaw = 'W'.repeat(43);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
   values ('+989311111111',$1,now()+interval '15 minutes')`,
  [hashOpaqueCredential(returningOldProofRaw)],
);
const returningSend = await fetch(synthetic.base + '/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: `${adminCookieReady}; ${accessCookie}; kimia_customer_registration=${returningOldProofRaw}`},
  body: JSON.stringify({phone: '+989311111111'}),
});
assert.equal(returningSend.status, 202);
const returningCode = testTransport.getOutbox()[testTransport.getOutbox().length - 1].code;
const wrongCode = (returningCode[0] === '0' ? '1' : '0') + returningCode.slice(1);
const wrongReturningVerify = await fetch(synthetic.base + '/api/auth/otp/verify', {
  method: 'POST',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: `${adminCookieReady}; ${accessCookie}; kimia_customer_registration=${returningOldProofRaw}`},
  body: JSON.stringify({phone: '+989311111111', code: wrongCode}),
});
assert.equal(wrongReturningVerify.status, 401);
assert.equal((await wrongReturningVerify.json()).remaining_attempts, 4);
const returningVerify = await fetch(synthetic.base + '/api/auth/otp/verify', {
  method: 'POST',
  headers: {origin: synthetic.base, 'content-type': 'application/json', cookie: `${adminCookieReady}; ${accessCookie}; kimia_customer_registration=${returningOldProofRaw}`},
  body: JSON.stringify({phone: '+989311111111', code: returningCode}),
});
assert.equal(returningVerify.status, 200);
assert.equal((await returningVerify.clone().json()).is_new_user, false);
const returningCookies = returningVerify.headers.getSetCookie?.() || [];
const returningAccessCookie = returningCookies.find(value => value.startsWith('kimia_customer_session='))?.split(';')[0];
assert.ok(returningAccessCookie);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [previousAccessHash],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is not null and used_at is null as revoked from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(returningOldProofRaw)],
)).rows[0].revoked, true);
const returningMe = await fetch(synthetic.base + '/api/auth/me', {
  headers: {cookie: `${adminCookieReady}; ${returningAccessCookie}`},
});
assert.equal(returningMe.status, 200);
assert.equal((await returningMe.json()).phone_e164, '+989311111111');

const logout = await fetch(synthetic.base + '/api/auth/logout', {
  method: 'POST',
  headers: {
    origin: synthetic.base,
    'content-type': 'application/json',
    cookie: `${adminCookieReady}; ${returningAccessCookie}`,
  },
  body: '{}',
});
assert.equal(logout.status, 200);
assert.match(logout.headers.get('set-cookie'), /kimia_customer_session=;/);
const signedOutAccountPage = await fetch(synthetic.base + '/account', {
  headers: {cookie: `${adminCookieReady}; ${returningAccessCookie}`},
  redirect: 'manual',
});
assert.equal(signedOutAccountPage.status, 302);
assert.equal(signedOutAccountPage.headers.get('location'), '/login');

const expiredAccessRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at,created_at)
   values ($1,'+989311111111',$2,now()-interval '1 second',now()-interval '31 days')`,
  [existingCustomerId, hashOpaqueCredential(expiredAccessRaw)],
);
const expiredAccessMe = await fetch(synthetic.base + '/api/auth/me', {
  headers: {cookie: `${adminCookieReady}; kimia_customer_session=${expiredAccessRaw}`},
});
assert.equal(expiredAccessMe.status, 401);
const expiredAccountPage = await fetch(synthetic.base + '/account', {
  headers: {cookie: `${adminCookieReady}; kimia_customer_session=${expiredAccessRaw}`},
  redirect: 'manual',
});
assert.equal(expiredAccountPage.status, 302);
assert.equal(expiredAccountPage.headers.get('location'), '/login');
assert.match(expiredAccountPage.headers.get('set-cookie'), /kimia_customer_session=;/);

// Missing customer schema is incomplete configuration, not an infrastructure outage.
await db.exec('alter table public.kimia_customer_send_events rename to kimia_customer_send_events_fixture_hidden');
try {
  const missingSchema = await fetch(synthetic.base + '/api/auth/status', {
    headers: {cookie: adminCookieReady},
  });
  assert.equal(missingSchema.status, 200);
  assert.deepEqual(await missingSchema.json(), {enabled: false, reason: 'missing_configuration'});
} finally {
  await db.exec('alter table public.kimia_customer_send_events_fixture_hidden rename to kimia_customer_send_events');
}

// Inject failures only; all successful queries continue through the real owner-role fixture.
for (const failureKind of ['schema', 'admin']) {
  const failingPool = {
    ...pool,
    async query(sql, values = []) {
      if ((failureKind === 'schema' && /from pg_tables/i.test(sql)) ||
          (failureKind === 'admin' && /from public\.kimia_admin_sessions/i.test(sql))) {
        throw new Error('synthetic confidential database failure');
      }
      return pool.query(sql, values);
    },
  };
  const failingHandler = await createStandaloneHandler({
    pool: failingPool,
    env: {...env, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
    uploadDir,
    smsAdapter: testSmsAdapter,
    hashSecret: secret,
  });
  const failingServer = await listen(failingHandler);
  try {
    const unavailable = await fetch(failingServer.base + '/api/auth/status', {
      headers: {cookie: adminCookieReady},
    });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, 'auth_unavailable');
    if (failureKind === 'admin') {
      const page = await fetch(failingServer.base + '/login', {
        headers: {cookie: adminCookieReady},
      });
      assert.equal(page.status, 503);
      assert.doesNotMatch(await page.text(), /synthetic|confidential|database failure/i);
    }
  } finally {
    await new Promise(resolve => failingServer.server.close(resolve));
  }
}

await new Promise(resolve => synthetic.server.close(resolve));
await rm(tempDir, {recursive: true, force: true});
await db.close();

console.log('Standalone customer flow/referral integration passed: genuine admin, explicit test SMS, new/returning sessions, recovery, admin referral history and honest readiness.');
