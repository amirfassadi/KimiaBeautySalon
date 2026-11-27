import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createCustomerAuthHttp} from '../server/customer-auth-http.js';
import {generateOpaqueCredential, hashOpaqueCredential} from '../server/customer-auth-credentials.js';

const db = new PGlite({extensions: {pgcrypto}});
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create role kimia_app nosuperuser nobypassrls;
  grant usage, create on schema public to kimia_app;
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

const pool = {
  async query(sql, values = []) {
    return db.query(sql, values);
  },
  async connect() {
    return {
      async query(sql, values = []) {
        if (/^begin$/i.test(sql.trim())) return db.query('begin');
        if (/^commit$/i.test(sql.trim())) return db.query('commit');
        if (/^rollback$/i.test(sql.trim())) return db.query('rollback');
        return db.query(sql, values);
      },
      release() {},
    };
  },
};

const account = (await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989307897825','نام','خانوادگی') returning id`,
)).rows[0];
const accessRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989307897825',$2,now()+interval '30 days')`,
  [account.id, hashOpaqueCredential(accessRaw)],
);

const baseEnv = {NODE_ENV: 'test'};
const sendService = {
  async send({phone, trustedIp}) {
    return {ok: true, code: 'otp_sent', retry_after_seconds: 60};
  },
};
const verificationService = {
  async verify({phone, code}) {
    return {
      ok: true,
      is_new_user: true,
      credential: {type: 'registration', raw: generateOpaqueCredential()},
    };
  },
};
const registrationService = {
  async register({profile, registrationCredential}) {
    return {
      ok: true,
      credential: {type: 'access', raw: generateOpaqueCredential()},
    };
  },
};

const disabled = createCustomerAuthHttp({
  pool,
  env: {...baseEnv},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => null,
});
let response = await disabled.handle(new Request('https://kimia.test/api/auth/status'));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), {enabled: false, reason: 'feature_disabled'});

response = await disabled.handle(new Request('https://kimia.test/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.1'},
  body: JSON.stringify({phone: '09307897825'}),
}));
assert.equal(response.status, 404);

const backendNoPreview = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => null,
});
response = await backendNoPreview.handle(new Request('https://kimia.test/api/auth/status'));
assert.deepEqual(await response.json(), {enabled: false, reason: 'missing_configuration'});

const restricted = createCustomerAuthHttp({
  pool,
  env: {
    ...baseEnv,
    AUTH_CUSTOMER_ENABLED: 'true',
    AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  },
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => null,
});
response = await restricted.handle(new Request('https://kimia.test/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.1'},
  body: JSON.stringify({phone: '09307897825'}),
}));
assert.equal(response.status, 404);

const authorized = createCustomerAuthHttp({
  pool,
  env: {
    ...baseEnv,
    AUTH_CUSTOMER_ENABLED: 'true',
    AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  },
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => ({ok: true}),
});

response = await authorized.handle(new Request('https://kimia.test/api/auth/status'));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), {enabled: true});

response = await authorized.handle(new Request('https://kimia.test/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.1'},
  body: JSON.stringify({phone: '09307897825'}),
}));
assert.equal(response.status, 202);
const sent = await response.json();
assert.deepEqual(sent, {ok: true, code: 'otp_sent', retry_after_seconds: 60});
assert.equal(response.headers.get('retry-after'), '60');
assert.doesNotMatch(JSON.stringify(sent), /012345|secret|reservation|token/i);
assert.equal(Object.hasOwn(sent, 'message'), false);

response = await authorized.handle(new Request('https://kimia.test/api/auth/me', {method: 'POST'}));
assert.equal(response.status, 405);
assert.equal(response.headers.get('allow'), 'GET');
assert.equal((await response.json()).code, 'method_not_allowed');
response = await authorized.handle(new Request('https://kimia.test/api/auth/logout', {method: 'GET'}));
assert.equal(response.status, 405);
assert.equal(response.headers.get('allow'), 'POST');
response = await authorized.handle(new Request('https://kimia.test/api/auth/legacy', {method: 'POST'}));
assert.equal(response.status, 404);

const accessCountBeforeMalformedLogout = (await db.query(
  'select count(*)::int as count from public.kimia_customer_access_sessions',
)).rows[0].count;
response = await authorized.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'text/plain'},
  body: 'not-json',
}));
assert.equal(response.status, 415);
const unsupportedBody = await response.json();
assert.equal(unsupportedBody.code, 'unsupported_media_type');
assert.match(unsupportedBody.message, /باید JSON باشد/);
response = await authorized.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json'},
  body: '{',
}));
assert.equal(response.status, 400);
assert.equal((await response.json()).code, 'invalid_json');
response = await authorized.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json', 'content-length': '4097'},
  body: '{}',
}));
assert.equal(response.status, 413);
assert.equal((await response.json()).code, 'request_too_large');
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_access_sessions',
)).rows[0].count, accessCountBeforeMalformedLogout);

const limited = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService: {async send() { return {ok: false, code: 'rate_limited', retry_after_seconds: 42}; }},
  verificationService,
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => ({ok: true}),
});
response = await limited.handle(new Request('https://kimia.test/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json'},
  body: JSON.stringify({phone: '09307897825'}),
}));
assert.equal(response.status, 429);
assert.equal(response.headers.get('retry-after'), '42');
assert.equal((await response.json()).retry_after_seconds, 42);

const locked = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService: {async verify() {
    return {ok: false, code: 'otp_locked', remaining_attempts: 0, retry_after_seconds: 180};
  }},
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => ({ok: true}),
});
response = await locked.handle(new Request('https://kimia.test/api/auth/otp/verify', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json'},
  body: JSON.stringify({phone: '09307897825', code: '111111'}),
}));
assert.equal(response.status, 423);
assert.equal(response.headers.get('retry-after'), '180');
assert.equal((await response.json()).retry_after_seconds, 180);

response = await authorized.handle(new Request('https://kimia.test/api/auth/otp/verify', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json'},
  body: JSON.stringify({phone: '09307897825', code: '123456'}),
}));
assert.equal(response.status, 200);
assert.equal(response.headers.getSetCookie?.().length >= 1, true);
const verifyCookies = response.headers.getSetCookie?.() || [];
assert.ok(verifyCookies.some(value => value.startsWith('kimia_customer_registration=')));
assert.ok(verifyCookies.some(value => value.startsWith('kimia_customer_session=;')));

response = await authorized.handle(new Request('https://kimia.test/api/auth/me', {
  headers: {cookie: `kimia_customer_session=${accessRaw}`},
}));
assert.equal(response.status, 200);
const me = await response.json();
assert.deepEqual(me, {
  authenticated: true,
  first_name: 'نام',
  last_name: 'خانوادگی',
  phone_e164: '+989307897825',
  marketing: false,
});

const missingReadiness = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => ({ok: false, reason: 'missing_configuration'}),
});
const missingReadinessStatus = await missingReadiness.handle(
  new Request('https://kimia.test/api/auth/status'),
);
assert.equal(missingReadinessStatus.status, 200);
assert.deepEqual(await missingReadinessStatus.json(), {enabled: false, reason: 'missing_configuration'});

const noReadinessCallback = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
});
const noCallbackStatus = await noReadinessCallback.handle(
  new Request('https://kimia.test/api/auth/status'),
);
assert.equal(noCallbackStatus.status, 200);
assert.deepEqual(await noCallbackStatus.json(), {enabled: false, reason: 'missing_configuration'});

const outageReadiness = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => { throw new Error('synthetic database outage'); },
});
const outageStatus = await outageReadiness.handle(
  new Request('https://kimia.test/api/auth/status'),
);
assert.equal(outageStatus.status, 503);
assert.doesNotMatch(await outageStatus.clone().text(), /synthetic|database|secret/i);

const adminOutage = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => { throw new Error('synthetic admin lookup outage'); },
  readiness: async () => ({ok: true}),
});
const adminOutageStatus = await adminOutage.handle(
  new Request('https://kimia.test/api/auth/status'),
);
assert.equal(adminOutageStatus.status, 503);
assert.doesNotMatch(await adminOutageStatus.clone().text(), /synthetic|lookup|database/i);

const otherRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989307897825',$2,now()+interval '30 days')`,
  [account.id, hashOpaqueCredential(otherRaw)],
);
response = await authorized.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {
    origin: 'https://kimia.test',
    'content-type': 'application/json',
    cookie: `kimia_customer_session=${accessRaw}`,
  },
  body: '{}',
}));
assert.equal(response.status, 200);
const logoutCookies = response.headers.getSetCookie?.() || [];
assert.equal(logoutCookies.length, 2);
assert.ok(logoutCookies.some(value => value.startsWith('kimia_customer_session=;')));
assert.ok(logoutCookies.some(value => value.startsWith('kimia_customer_registration=;')));
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(accessRaw)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(otherRaw)],
)).rows[0].active, true);

response = await authorized.handle(new Request('https://kimia.test/api/auth/me', {
  headers: {cookie: `kimia_customer_session=${accessRaw}`},
}));
assert.equal(response.status, 401);
response = await authorized.handle(new Request('https://kimia.test/api/auth/me', {
  headers: {cookie: `kimia_customer_session=${otherRaw}`},
}));
assert.equal(response.status, 200);

response = await authorized.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json'},
  body: '{}',
}));
assert.equal(response.status, 200);

const proofRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
   values ('+989307897825',$1,now()+interval '15 minutes')`,
  [hashOpaqueCredential(proofRaw)],
);
response = await authorized.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {
    origin: 'https://kimia.test',
    'content-type': 'application/json',
    cookie: `kimia_customer_registration=${proofRaw}`,
  },
  body: '{}',
}));
assert.equal(response.status, 200);

response = await authorized.handle(new Request('https://kimia.test/api/auth/register', {
  method: 'POST',
  headers: {
    origin: 'https://kimia.test',
    'content-type': 'application/json',
    cookie: `kimia_customer_registration=${generateOpaqueCredential()}`,
  },
  body: JSON.stringify({first_name: 'نام', last_name: 'خانوادگی', marketing: false}),
}));
assert.equal(response.status, 201);
const cookies = response.headers.getSetCookie?.() || [];
assert.equal(cookies.length, 2, 'Registration success must emit access and proof-clear cookies separately.');
assert.ok(cookies.some(value => value.startsWith('kimia_customer_session=')));
assert.ok(cookies.some(value => value.startsWith('kimia_customer_registration=;')));

const accountExistsService = createCustomerAuthHttp({
  pool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService: {
    async register() {
      return {ok: false, code: 'account_exists', recovery_action: 'login'};
    },
  },
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => ({ok: true}),
});
response = await accountExistsService.handle(new Request('https://kimia.test/api/auth/register', {
  method: 'POST',
  headers: {
    origin: 'https://kimia.test',
    'content-type': 'application/json',
    cookie: `kimia_customer_registration=${generateOpaqueCredential()}; kimia_customer_session=${generateOpaqueCredential()}`,
  },
  body: JSON.stringify({first_name: 'نام', last_name: 'خانوادگی'}),
}));
assert.equal(response.status, 409);
const recoveryCookies = response.headers.getSetCookie?.() || [];
assert.equal(recoveryCookies.length, 2);
assert.ok(recoveryCookies.some(value => value.startsWith('kimia_customer_session=;')));
assert.ok(recoveryCookies.some(value => value.startsWith('kimia_customer_registration=;')));

const cleanupFailurePool = {
  async connect() {
    return {
      async query() {
        throw new Error('synthetic cleanup failure');
      },
      release() {},
    };
  },
};
const cleanupFailure = createCustomerAuthHttp({
  pool: cleanupFailurePool,
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => ({ok: true}),
});
response = await cleanupFailure.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {
    origin: 'https://kimia.test',
    'content-type': 'application/json',
    cookie: `kimia_customer_session=${generateOpaqueCredential()}; kimia_customer_registration=${generateOpaqueCredential()}`,
  },
  body: '{}',
}));
assert.equal(response.status, 503);
assert.equal(response.headers.getSetCookie?.().length || 0, 0);

const nonTransactional = createCustomerAuthHttp({
  pool: {async query() { throw new Error('transaction must not fall back'); }},
  env: {...baseEnv, AUTH_CUSTOMER_ENABLED: 'true', AUTH_CUSTOMER_PREVIEW_ENABLED: 'true'},
  sendService,
  verificationService,
  registrationService,
  adminSession: async () => ({id: 'admin-id'}),
  readiness: async () => ({ok: true}),
});
response = await nonTransactional.handle(new Request('https://kimia.test/api/auth/logout', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'application/json'},
  body: '{}',
}));
assert.equal(response.status, 503);
assert.equal(response.headers.getSetCookie?.().length || 0, 0);

const malformed = await authorized.handle(new Request('https://kimia.test/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: 'https://kimia.test', 'content-type': 'text/plain', 'cf-connecting-ip': '127.0.0.1'},
  body: 'phone=09307897825',
}));
assert.equal(malformed.status, 415);
assert.equal(malformed.headers.get('cache-control'), 'no-store');

const crossOrigin = await authorized.handle(new Request('https://kimia.test/api/auth/otp/send', {
  method: 'POST',
  headers: {origin: 'https://attacker.test', 'content-type': 'application/json', 'cf-connecting-ip': '127.0.0.1'},
  body: JSON.stringify({phone: '09307897825'}),
}));
assert.equal(crossOrigin.status, 403);

// Exercise separate Set-Cookie headers through an actual Node HTTP response adapter.
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const request = new Request(`http://127.0.0.1:${incoming.socket.localPort}${incoming.url}`, {
    method: incoming.method,
    headers: incoming.headers,
    ...(incoming.method === 'POST' ? {body} : {}),
  });
  const httpResponse = await authorized.handle(request);
  if (typeof httpResponse.headers.getSetCookie === 'function') {
    outgoing.setHeader('set-cookie', httpResponse.headers.getSetCookie());
  }
  outgoing.writeHead(httpResponse.status, {
    'content-type': httpResponse.headers.get('content-type'),
  });
  outgoing.end(await httpResponse.text());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise((resolve, reject) => {
  const request = httpRequest({
    hostname: '127.0.0.1',
    port,
    path: '/api/auth/register',
    method: 'POST',
    headers: {
      origin: `http://127.0.0.1:${port}`,
      'content-type': 'application/json',
      cookie: `kimia_customer_registration=${generateOpaqueCredential()}`,
    },
  }, response => {
    assert.equal(response.statusCode, 201);
    assert.equal(Array.isArray(response.headers['set-cookie']), true);
    assert.equal(response.headers['set-cookie'].length, 2);
    response.resume();
    response.on('end', resolve);
  });
  request.on('error', reject);
  request.end(JSON.stringify({first_name: 'نام', last_name: 'خانوادگی'}));
});
await new Promise(resolve => server.close(resolve));

await db.close();
console.log('Customer auth HTTP PGlite check passed: gates, preview, cookies, /me and request protections.');
