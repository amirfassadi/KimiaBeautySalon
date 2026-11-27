import assert from 'node:assert/strict';
import {createHmac, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {
  generateOtpCode,
  hashCustomerOtp,
  OTP_HMAC_DOMAIN,
} from '../server/customer-auth-otp-crypto.js';
import {createCustomerOtpSendService} from '../server/customer-auth-otp-send.js';
import {createCustomerOtpStore} from '../server/customer-auth-otp-store.js';
import {createCustomerSmsAdapter, createCustomerSmsTestTransport} from '../server/customer-auth-sms.js';

const secret = 's'.repeat(32);
assert.equal(generateOtpCode(() => 0), '000000');
assert.equal(generateOtpCode(() => 7), '000007');
assert.equal(generateOtpCode(() => 999999), '999999');
assert.throws(() => generateOtpCode(() => -1), /invalid/);
assert.throws(() => generateOtpCode(() => 1_000_000), /invalid/);

const hashVector = createHmac(
  'sha256',
  Buffer.from(secret, 'utf8'),
).update(
  Buffer.from(`${OTP_HMAC_DOMAIN}\nphone=+989307897825\ncode=012345`, 'utf8'),
).digest('hex');
assert.deepEqual(hashCustomerOtp({
  secret,
  phone: '+989307897825',
  code: '012345',
}), {ok: true, value: hashVector});
assert.equal(hashCustomerOtp({
  secret,
  phone: '+989307897825',
  code: '012346',
}).value !== hashVector, true);
assert.equal(hashCustomerOtp({
  secret: 't'.repeat(32),
  phone: '+989307897825',
  code: '012345',
}).value !== hashVector, true);
assert.equal(hashCustomerOtp({
  secret,
  phone: '+989111111111',
  code: '012345',
}).value !== hashVector, true);
assert.deepEqual(hashCustomerOtp({
  secret: 'short',
  phone: '+989307897825',
  code: '012345',
}), {ok: false, code: 'invalid_otp_hash_input'});

const weakSecrets = [undefined, null, '', 'short', Buffer.alloc(31)];
for (const weakSecret of weakSecrets) {
  let reserved = false;
  let sent = false;
  const blocked = createCustomerOtpSendService({
    store: {reserve: async () => { reserved = true; }, revoke: async () => {}},
    smsAdapter: {send: async () => { sent = true; }},
    hashSecret: weakSecret,
  });
  assert.deepEqual(await blocked.send({
    phone: '09307897825',
    trustedIp: '127.0.0.1',
  }), {ok: false, code: 'auth_unavailable'});
  assert.equal(reserved, false);
  assert.equal(sent, false);
}

for (const [phone, trustedIp] of [
  [null, '127.0.0.1'],
  ['0930789782', '127.0.0.1'],
  ['09307897825', null],
  ['09307897825', 'bad-ip'],
]) {
  let reserved = false;
  const service = createCustomerOtpSendService({
    store: {reserve: async () => { reserved = true; }, revoke: async () => {}},
    smsAdapter: {send: async () => ({ok: true, accepted: true})},
    hashSecret: secret,
  });
  const result = await service.send({phone, trustedIp});
  assert.ok(['invalid_phone', 'invalid_ip'].includes(result.code));
  assert.equal(reserved, false);
}

let invalidReservationSmsCalls = 0;
for (const invalidReservationId of [undefined, null, '', 'not-a-uuid', '00000000-0000-0000-0000-000000000001']) {
  const invalidReservation = createCustomerOtpSendService({
    store: {
      async reserve() {
        return {ok: true, reservation_id: invalidReservationId};
      },
      async revoke() {
        throw new Error('must not revoke a malformed reservation');
      },
    },
    smsAdapter: {
      async send() {
        invalidReservationSmsCalls++;
        return {ok: true, accepted: true};
      },
    },
    hashSecret: secret,
    codeGenerator: () => '123456',
  });
  assert.deepEqual(await invalidReservation.send({
    phone: '09307897825',
    trustedIp: '127.0.0.1',
  }), {ok: false, code: 'auth_unavailable'});
}
assert.equal(invalidReservationSmsCalls, 0);

for (const revokeMode of ['success', 'failure', 'throw']) {
  const cancellationController = new AbortController();
  let smsCalled = false;
  const cancellationDuringReserve = createCustomerOtpSendService({
    store: {
      async reserve() {
        cancellationController.abort();
        await Promise.resolve();
        return {ok: true, reservation_id: '00000000-0000-4000-8000-000000000010'};
      },
      async revoke() {
        if (revokeMode === 'throw') throw new Error('synthetic revoke secret');
        if (revokeMode === 'failure') return {ok: false, code: 'auth_unavailable'};
        return {ok: true, revoked: true};
      },
    },
    smsAdapter: {
      async send() {
        smsCalled = true;
        return {ok: true, accepted: true};
      },
    },
    hashSecret: secret,
    codeGenerator: () => '123456',
  });
  assert.deepEqual(await cancellationDuringReserve.send({
    phone: '09307897825',
    trustedIp: '127.0.0.1',
    signal: cancellationController.signal,
  }), revokeMode === 'success'
    ? {ok: false, code: 'sms_unavailable'}
    : {ok: false, code: 'auth_unavailable'});
  assert.equal(smsCalled, false);
}

let authConfigRevokedId = null;
const authConfigFailure = createCustomerOtpSendService({
  store: {
    async reserve() {
      return {ok: true, reservation_id: '00000000-0000-4000-8000-000000000011'};
    },
    async revoke(id) {
      authConfigRevokedId = id;
      return {ok: true, revoked: true};
    },
  },
  smsAdapter: {
    async send() {
      return {ok: false, code: 'auth_unavailable'};
    },
  },
  hashSecret: secret,
  codeGenerator: () => '123456',
});
assert.deepEqual(await authConfigFailure.send({
  phone: '09307897825',
  trustedIp: '127.0.0.1',
}), {ok: false, code: 'auth_unavailable'});
assert.equal(authConfigRevokedId, '00000000-0000-4000-8000-000000000011');

let reserveCount = 0;
let sendCount = 0;
const rateStore = {
  async reserve() {
    reserveCount++;
    return {ok: false, code: 'rate_limited', retry_after_seconds: 42};
  },
  async revoke() {
    throw new Error('must not revoke a denied reservation');
  },
};
const rateService = createCustomerOtpSendService({
  store: rateStore,
  smsAdapter: {send: async () => { sendCount++; return {ok: true, accepted: true}; }},
  hashSecret: secret,
  codeGenerator: () => '012345',
});
assert.deepEqual(await rateService.send({
  phone: '09307897825',
  trustedIp: '127.0.0.1',
}), {ok: false, code: 'rate_limited', retry_after_seconds: 42});
assert.equal(reserveCount, 1);
assert.equal(sendCount, 0);

const ordering = [];
const successService = createCustomerOtpSendService({
  store: {
    async reserve({phone, trustedIp, codeHash}) {
      ordering.push(['reserve', phone, trustedIp, codeHash.length]);
      return {ok: true, reservation_id: '00000000-0000-4000-8000-000000000001'};
    },
    async revoke() {
      ordering.push(['revoke']);
      return {ok: true, revoked: true};
    },
  },
  smsAdapter: {
    async send({phone, code, signal}) {
      ordering.push(['send', phone, code, signal instanceof AbortSignal]);
      return {ok: true, accepted: true};
    },
  },
  hashSecret: secret,
  codeGenerator: () => '000007',
});
assert.deepEqual(await successService.send({
  phone: ' ۰۹۳۰۷۸۹۷۸۲۵ ',
  trustedIp: '127.0.0.1',
}), {ok: true, code: 'otp_sent', retry_after_seconds: 60});
assert.deepEqual(ordering[0], ['reserve', '+989307897825', '127.0.0.1', 64]);
assert.equal(ordering[1][0], 'send');
assert.equal(ordering[1][1], '+989307897825');
assert.equal(ordering[1][2], '000007');
assert.doesNotMatch(JSON.stringify(await successService.send({
  phone: '09307897825',
  trustedIp: '127.0.0.1',
})), /000007|reservation|secret|[a-f0-9]{64}/i);

for (const smsResult of [
  null,
  false,
  {},
  {ok: false, accepted: true},
  {ok: true, accepted: false},
  {ok: true, accepted: 'true'},
]) {
  let revokedId = null;
  const failed = createCustomerOtpSendService({
    store: {
      async reserve() {
        return {ok: true, reservation_id: '00000000-0000-4000-8000-000000000002'};
      },
      async revoke(id) {
        revokedId = id;
        return {ok: true, revoked: true};
      },
    },
    smsAdapter: {async send() { return smsResult; }},
    hashSecret: secret,
    codeGenerator: () => '123456',
  });
  const result = await failed.send({phone: '09307897825', trustedIp: '127.0.0.1'});
  assert.deepEqual(result, {ok: false, code: 'sms_unavailable'});
  assert.equal(revokedId, '00000000-0000-4000-8000-000000000002');
  assert.doesNotMatch(JSON.stringify(result), /123456|secret|provider|token/i);
}

let thrownRevokedId = null;
const thrownService = createCustomerOtpSendService({
  store: {
    async reserve() {
      return {ok: true, reservation_id: '00000000-0000-4000-8000-000000000003'};
    },
    async revoke(id) {
      thrownRevokedId = id;
      return {ok: true, revoked: true};
    },
  },
  smsAdapter: {
    async send() {
      throw new Error('synthetic-secret-provider-token');
    },
  },
  hashSecret: secret,
  codeGenerator: () => '123456',
});
assert.deepEqual(await thrownService.send({phone: '09307897825', trustedIp: '127.0.0.1'}),
  {ok: false, code: 'sms_unavailable'});
assert.equal(thrownRevokedId, '00000000-0000-4000-8000-000000000003');

const revokeFailure = createCustomerOtpSendService({
  store: {
    async reserve() {
      return {ok: true, reservation_id: '00000000-0000-4000-8000-000000000004'};
    },
    async revoke() {
      return {ok: false, code: 'auth_unavailable'};
    },
  },
  smsAdapter: {async send() { return {ok: false, accepted: false}; }},
  hashSecret: secret,
  codeGenerator: () => '123456',
});
assert.deepEqual(await revokeFailure.send({phone: '09307897825', trustedIp: '127.0.0.1'}),
  {ok: false, code: 'auth_unavailable'});

const alreadyAborted = new AbortController();
alreadyAborted.abort();
let cancelledReserve = false;
const cancellationService = createCustomerOtpSendService({
  store: {
    async reserve() { cancelledReserve = true; },
    async revoke() {},
  },
  smsAdapter: {async send() { throw new Error('must not send'); }},
  hashSecret: secret,
  codeGenerator: () => '123456',
});
assert.deepEqual(await cancellationService.send({
  phone: '09307897825',
  trustedIp: '127.0.0.1',
  signal: alreadyAborted.signal,
}), {ok: false, code: 'sms_unavailable'});
assert.equal(cancelledReserve, false);

let cancelledRevokedId = null;
const lateController = new AbortController();
const cancellationAfterReserve = createCustomerOtpSendService({
  store: {
    async reserve() {
      return {ok: true, reservation_id: '00000000-0000-4000-8000-000000000005'};
    },
    async revoke(id) {
      cancelledRevokedId = id;
      return {ok: true, revoked: true};
    },
  },
  smsAdapter: {
    async send({signal}) {
      lateController.abort();
      return signal.aborted ? {ok: true, accepted: true} : {ok: true, accepted: true};
    },
  },
  hashSecret: secret,
  codeGenerator: () => '123456',
});
assert.deepEqual(await cancellationAfterReserve.send({
  phone: '09307897825',
  trustedIp: '127.0.0.1',
  signal: lateController.signal,
}), {ok: false, code: 'sms_unavailable'});
assert.equal(cancelledRevokedId, '00000000-0000-4000-8000-000000000005');

// Disposable owner-role PGlite integration with the real store and test SMS transport.
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
]) {
  await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
}
await db.exec('set role kimia_app');
await db.exec(await readFile(new URL('../db/migrations/006_customer_auth_v1.sql', import.meta.url), 'utf8'));
await db.exec('reset role');
await db.exec('set role kimia_app');

let ownerReleaseCount = 0;
const ownerPool = {
  async connect() {
    return {
      async query(sql, values = []) {
        if (/^begin$/i.test(sql.trim())) return db.query('begin');
        if (/^commit$/i.test(sql.trim())) return db.query('commit');
        if (/^rollback$/i.test(sql.trim())) return db.query('rollback');
        if (/pg_advisory_xact_lock/i.test(sql)) return {rows: [{}]};
        if (!values.length && (sql.match(/;/g) || []).length > 1) {
          await db.exec(sql);
          return {rows: []};
        }
        return db.query(sql, values);
      },
      release() {
        ownerReleaseCount++;
      },
    };
  },
};
const realStore = createCustomerOtpStore({pool: ownerPool});
const testTransport = createCustomerSmsTestTransport({runtimeMode: 'test'});
const testTransportSend = testTransport.send.bind(testTransport);
testTransport.send = async input => {
  assert.ok(ownerReleaseCount >= 1, 'SMS must run only after the store releases its client');
  return testTransportSend(input);
};
const testAdapter = createCustomerSmsAdapter({
  transport: testTransport,
  runtimeMode: 'test',
  timeoutMs: 50,
});
const realComposed = createCustomerOtpSendService({
  store: realStore,
  smsAdapter: testAdapter,
  hashSecret: secret,
  codeGenerator: () => '012345',
});
assert.deepEqual(await realComposed.send({phone: '09307897825', trustedIp: '127.0.0.1'}),
  {ok: true, code: 'otp_sent', retry_after_seconds: 60});
const persisted = await db.query(
  'select phone_e164,code_hash,attempts,consumed_at,revoked_at from public.kimia_customer_otp_challenges',
);
assert.equal(persisted.rows.length, 1);
assert.equal(persisted.rows[0].phone_e164, '+989307897825');
assert.equal(persisted.rows[0].code_hash, hashVector);
assert.equal(persisted.rows[0].attempts, 0);
assert.equal(persisted.rows[0].consumed_at, null);
assert.equal(persisted.rows[0].revoked_at, null);
assert.doesNotMatch(persisted.rows[0].code_hash, /012345/);
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
)).rows[0].count, 2);

const failingTransport = createCustomerSmsAdapter({
  transport: {async send() { return {ok: false, accepted: false}; }},
  runtimeMode: 'test',
  timeoutMs: 50,
});
const failingComposed = createCustomerOtpSendService({
  store: realStore,
  smsAdapter: failingTransport,
  hashSecret: secret,
  codeGenerator: () => '654321',
});
await db.query(
  `update public.kimia_customer_send_events
      set created_at=now()-interval '61 seconds'
    where key_type='phone'`,
);
const beforeFailEvents = await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
);
assert.deepEqual(await failingComposed.send({phone: '09307897825', trustedIp: '127.0.0.1'}),
  {ok: false, code: 'sms_unavailable'});
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
)).rows[0].count, beforeFailEvents.rows[0].count + 2);
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_otp_challenges where revoked_at is not null',
)).rows[0].count, 2);

await db.close();

const envSnapshot = JSON.stringify(process.env);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('OTP send test must not make external requests');
};
try {
  assert.equal(typeof createCustomerOtpSendService, 'function');
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(JSON.stringify(process.env), envSnapshot);

console.log('Customer OTP send service passed: secure generation, keyed hashes, reserve→send ordering, revocation and quota preservation.');
