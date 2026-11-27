import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {
  createCustomerOtpStore,
  normalizeTrustedClientIp,
  OTP_RESERVATION_POLICY,
} from '../server/customer-auth-otp-store.js';

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

const sha = value => createHash('sha256').update(value).digest('hex');
const phoneKey = phone => sha(`kimia:otp:phone:${phone}`);
const ipKey = ip => sha(`kimia:otp:trusted_ip:${ip}`);
let releaseCount = 0;
let failChallengeInsert = false;
let failIpEventInsert = false;
let lockDelayMs = 0;
let postLockTime = null;
const lockUsage = [];

const pool = {
  async connect() {
    return {
      async query(sql, values = []) {
        if (/^begin$/i.test(sql.trim())) return db.query('begin');
        if (/^commit$/i.test(sql.trim())) return db.query('commit');
        if (/^rollback$/i.test(sql.trim())) return db.query('rollback');
        const lock = /^select pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)$/i.exec(sql.trim());
        if (lock) {
          lockUsage.push(values[0]);
          if (values[0].includes(':ip:') && lockDelayMs) {
            await new Promise(resolve => setTimeout(resolve, lockDelayMs));
            postLockTime = (await db.query('select clock_timestamp() as lock_finished_at')).rows[0].lock_finished_at;
          }
          return {rows: [{}]};
        }
        if (/select clock_timestamp\(\)/i.test(sql)) {
          return db.query(sql, values);
        }
        if (failChallengeInsert &&
            /insert into public\.kimia_customer_otp_challenges/i.test(sql)) {
          throw new Error('injected persistence failure');
        }
        if (failIpEventInsert &&
            /insert into public\.kimia_customer_send_events/i.test(sql) &&
            /trusted_ip/i.test(sql)) {
          throw new Error('injected IP event failure');
        }
        if (!values.length && (sql.match(/;/g) || []).length > 1) {
          await db.exec(sql);
          return {rows: []};
        }
        return db.query(sql, values);
      },
      release() {
        releaseCount++;
      },
    };
  },
};

assert.equal(normalizeTrustedClientIp('::ffff:127.0.0.1'), '127.0.0.1');
assert.equal(normalizeTrustedClientIp('0:0:0:0:0:ffff:7f00:1'), '127.0.0.1');
assert.equal(normalizeTrustedClientIp('::ffff:c000:201'), '192.0.2.1');
assert.equal(normalizeTrustedClientIp('0:0:0:0::ffff:c000:201'), '192.0.2.1');
assert.equal(normalizeTrustedClientIp('0:0:0:0:0:ffff:c000:201'), '192.0.2.1');
assert.equal(normalizeTrustedClientIp('0:0:0:0:0:ffff:192.0.2.1'), '192.0.2.1');
assert.equal(normalizeTrustedClientIp('2001:0DB8:0:0:0:0:0:1'), '2001:db8:0:0:0:0:0:1');
assert.equal(normalizeTrustedClientIp('not-an-ip'), null);

const store = createCustomerOtpStore({pool});
const phone = '+989307897825';
const ip = '127.0.0.1';
const firstHash = 'a'.repeat(64);

assert.deepEqual(await store.reserve({phone: '0930789782', trustedIp: ip, codeHash: firstHash}), {
  ok: false,
  code: 'invalid_phone',
});
assert.deepEqual(await store.reserve({phone, trustedIp: 'bad-ip', codeHash: firstHash}), {
  ok: false,
  code: 'invalid_ip',
});
assert.deepEqual(await store.reserve({phone, trustedIp: ip, codeHash: 'not-a-hash'}), {
  ok: false,
  code: 'invalid_code_hash',
});

lockDelayMs = 150;
const first = await store.reserve({phone: '09307897825', trustedIp: '::ffff:127.0.0.1', codeHash: firstHash});
lockDelayMs = 0;
assert.equal(first.ok, true);
assert.ok(postLockTime !== null);
assert.ok(Date.parse(first.created_at) >= new Date(postLockTime).getTime(),
  'Reservation time must be sampled after lock wait, not at transaction start.');
assert.match(first.reservation_id, /^[0-9a-f-]{36}$/);
assert.equal(typeof first.expires_at, 'string');
assert.equal(Object.hasOwn(first, 'code_hash'), false);
assert.equal(Date.parse(first.expires_at) - Date.parse(first.created_at), 5 * 60 * 1000);
assert.match(lockUsage[0], /kimia_customer_otp:phone:/);
assert.match(lockUsage[1], /kimia_customer_otp:ip:/);

const challengeCount = await db.query(
  'select count(*)::int as count from public.kimia_customer_otp_challenges',
);
assert.equal(challengeCount.rows[0].count, 1);
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
)).rows[0].count, 2);

const oldChallenge = await db.query(
  'select id,code_hash,revoked_at from public.kimia_customer_otp_challenges where phone_e164=$1',
  [phone],
);
const cooldown = await store.reserve({phone: '+989307897825', trustedIp: ip, codeHash: 'b'.repeat(64)});
assert.equal(cooldown.ok, false);
assert.equal(cooldown.code, 'rate_limited');
assert.ok(Number.isInteger(cooldown.retry_after_seconds) && cooldown.retry_after_seconds > 0);
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
)).rows[0].count, 2);
assert.deepEqual((await db.query(
  'select id,revoked_at from public.kimia_customer_otp_challenges where phone_e164=$1',
  [phone],
)).rows, [{id: oldChallenge.rows[0].id, revoked_at: oldChallenge.rows[0].revoked_at}]);

// Phone limit across canonical and distinct phone/IP data.
await db.exec('delete from public.kimia_customer_send_events');
await db.exec('delete from public.kimia_customer_otp_challenges');
for (let index = 0; index < 3; index++) {
  await db.query(
    `insert into public.kimia_customer_send_events(key_type,key_hash,phone_e164,created_at)
     values ('phone',$1,$2,now()-interval '10 seconds')`,
    [phoneKey(phone), phone],
  );
}
const phoneLimit = await store.reserve({phone, trustedIp: ip, codeHash: 'c'.repeat(64)});
assert.equal(phoneLimit.code, 'rate_limited');
assert.ok(phoneLimit.retry_after_seconds > 1000);

// IP limit with five distinct phones/IP event history.
await db.exec('delete from public.kimia_customer_send_events');
await db.exec('delete from public.kimia_customer_otp_challenges');
for (let index = 0; index < 5; index++) {
  await db.query(
    `insert into public.kimia_customer_send_events(key_type,key_hash,created_at)
     values ('trusted_ip',$1,now()-interval '20 seconds')`,
    [ipKey(ip)],
  );
}
const ipLimit = await store.reserve({
  phone: '+989111111111',
  trustedIp: ip,
  codeHash: 'd'.repeat(64),
});
assert.equal(ipLimit.code, 'rate_limited');
assert.ok(ipLimit.retry_after_seconds > 1000);

await db.exec('delete from public.kimia_customer_send_events');
await db.exec('delete from public.kimia_customer_otp_challenges');
for (let index = 0; index < 5; index++) {
  await db.query(
    `insert into public.kimia_customer_send_events(key_type,key_hash,created_at)
     values ('trusted_ip',$1,now()-interval '20 seconds')`,
    [ipKey('192.0.2.1')],
  );
}
for (const mappedIp of ['192.0.2.1', '::ffff:c000:201', '0:0:0:0::ffff:c000:201', '0:0:0:0:0:ffff:c000:201', '0:0:0:0:0:ffff:192.0.2.1']) {
  const aliasLimit = await store.reserve({
    phone: `+989${String(300000000 + mappedIp.length).slice(-9)}`,
    trustedIp: mappedIp,
    codeHash: 'b'.repeat(64),
  });
  assert.equal(aliasLimit.code, 'rate_limited');
}

// Combined limits return the maximum blocking retry.
await db.exec('delete from public.kimia_customer_send_events');
await db.exec('delete from public.kimia_customer_otp_challenges');
for (let index = 0; index < 3; index++) {
  await db.query(
    `insert into public.kimia_customer_send_events(key_type,key_hash,phone_e164,created_at)
     values ('phone',$1,$2,now()-interval '30 minutes')`,
    [phoneKey(phone), phone],
  );
}
for (let index = 0; index < 5; index++) {
  await db.query(
    `insert into public.kimia_customer_send_events(key_type,key_hash,created_at)
     values ('trusted_ip',$1,now()-interval '50 minutes')`,
    [ipKey(ip)],
  );
}
const combined = await store.reserve({phone, trustedIp: ip, codeHash: 'e'.repeat(64)});
assert.equal(combined.code, 'rate_limited');
assert.ok(combined.retry_after_seconds >= 600 && combined.retry_after_seconds <= 3600);

// Strict aged-window boundaries and replacement after cooldown preserve the old challenge.
await db.exec('delete from public.kimia_customer_send_events');
await db.exec('delete from public.kimia_customer_otp_challenges');
const oldReservation = await db.query(
  `insert into public.kimia_customer_otp_challenges
     (phone_e164,code_hash,expires_at,attempts,created_at)
   values ($1,$2,now()+interval '5 minutes',0,now())
   returning id`,
  [phone, 'f'.repeat(64)],
);
const oldId = oldReservation.rows[0].id;
for (let index = 0; index < 3; index++) {
  await db.query(
    `insert into public.kimia_customer_send_events(key_type,key_hash,phone_e164,created_at)
     values ('phone',$1,$2,now()-interval '61 minutes')`,
    [phoneKey(phone), phone],
  );
}
await db.query(
  `insert into public.kimia_customer_send_events(key_type,key_hash,created_at)
   values ('trusted_ip',$1,now()-interval '61 minutes')`,
  [ipKey(ip)],
);
const replacement = await store.reserve({phone, trustedIp: ip, codeHash: 'f'.repeat(64)});
assert.equal(replacement.ok, true);

const challenges = await db.query(
  `select id,consumed_at,revoked_at
     from public.kimia_customer_otp_challenges
    where phone_e164=$1
    order by created_at desc`,
  [phone],
);
assert.equal(challenges.rows.length, 2);
const oldRow = challenges.rows.find(row => row.id === oldId);
assert.ok(oldRow.revoked_at);
const newRow = challenges.rows.find(row => row.id === replacement.reservation_id);
assert.equal(newRow.revoked_at, null);

// Revoking the old ID is a no-op and leaves the new challenge and event counts unchanged.
const eventCountBeforeOldRevoke = await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
);
assert.deepEqual(await store.revoke(oldId), {ok: true, revoked: false});
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
)).rows[0].count, eventCountBeforeOldRevoke.rows[0].count);
assert.equal((await db.query(
  'select revoked_at from public.kimia_customer_otp_challenges where id=$1',
  [replacement.reservation_id],
)).rows[0].revoked_at, null);

// Exact-ID revocation and idempotent reuse.
const revoke = await store.revoke(replacement.reservation_id);
assert.deepEqual(revoke, {ok: true, revoked: true});
assert.deepEqual(await store.revoke(replacement.reservation_id), {ok: true, revoked: false});
assert.deepEqual(await store.revoke(randomUUID()), {ok: true, revoked: false});

// A new store sees persistent events and challenges.
await db.exec('delete from public.kimia_customer_send_events');
await db.exec('delete from public.kimia_customer_otp_challenges');
const recreated = createCustomerOtpStore({pool});
const persisted = await recreated.reserve({phone, trustedIp: ip, codeHash: '1'.repeat(64)});
assert.equal(persisted.ok, true);
const recreatedAgain = createCustomerOtpStore({pool});
const persistedCooldown = await recreatedAgain.reserve({phone, trustedIp: ip, codeHash: '2'.repeat(64)});
assert.equal(persistedCooldown.code, 'rate_limited');

const consumed = await recreated.reserve({phone: '+989333333333', trustedIp: ip, codeHash: '4'.repeat(64)});
assert.equal(consumed.ok, true);
await db.query(
  'update public.kimia_customer_otp_challenges set consumed_at=now() where id=$1',
  [consumed.reservation_id],
);
const beforeConsumedEventCount = await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
);
assert.deepEqual(await recreated.revoke(consumed.reservation_id), {ok: true, revoked: false});
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_send_events',
)).rows[0].count, beforeConsumedEventCount.rows[0].count);

releaseCount = 0;
assert.equal((await recreated.reserve({phone, trustedIp: ip, codeHash: '5'.repeat(64)})).ok, false);
assert.equal(releaseCount, 1);

// Transaction failure after replacement and first event insertion rolls back all writes.
await db.exec('delete from public.kimia_customer_send_events');
await db.exec('delete from public.kimia_customer_otp_challenges');
const rollbackOld = await db.query(
  `insert into public.kimia_customer_otp_challenges
     (phone_e164,code_hash,expires_at,attempts,created_at)
   values ($1,$2,now()+interval '5 minutes',0,now())
   returning id`,
  ['+989222222222', '9'.repeat(64)],
);
await db.query(
  `insert into public.kimia_customer_send_events(key_type,key_hash,phone_e164,created_at)
   values ('phone',$1,$2,now()-interval '61 minutes')`,
  [phoneKey('+989222222222'), '+989222222222'],
);
releaseCount = 0;
failIpEventInsert = true;
const beforeChallenges = await db.query(
  'select id::text,phone_e164,code_hash,attempts,consumed_at,revoked_at,created_at,expires_at from public.kimia_customer_otp_challenges order by id',
);
const beforeEvents = await db.query(
  'select id::text,key_type,key_hash,phone_e164,created_at from public.kimia_customer_send_events order by id',
);
const failed = await store.reserve({phone: '+989222222222', trustedIp: '192.0.2.1', codeHash: '3'.repeat(64)});
failIpEventInsert = false;
assert.deepEqual(failed, {ok: false, code: 'auth_unavailable'});
assert.equal(releaseCount, 1);
assert.deepEqual(await db.query(
  'select id::text,phone_e164,code_hash,attempts,consumed_at,revoked_at,created_at,expires_at from public.kimia_customer_otp_challenges order by id',
), beforeChallenges);
assert.deepEqual(await db.query(
  'select id::text,key_type,key_hash,phone_e164,created_at from public.kimia_customer_send_events order by id',
), beforeEvents);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_otp_challenges where id=$1',
  [rollbackOld.rows[0].id],
)).rows[0].active, true);

assert.ok(lockUsage.length >= 4);
assert.equal(lockUsage.slice(-2).length, 2);

await db.close();

console.log('Customer OTP store PGlite passed: reservations, rolling limits, cooldown, replacement, revocation, persistence and rollback.');
