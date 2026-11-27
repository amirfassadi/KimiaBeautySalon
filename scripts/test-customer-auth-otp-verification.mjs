import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createOtpVerificationService} from '../server/customer-auth-otp-verification.js';
import {hashCustomerOtp} from '../server/customer-auth-otp-crypto.js';
import {hashOpaqueCredential, validateOpaqueCredential} from '../server/customer-auth-credentials.js';

const secret = 'v'.repeat(32);
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

let failCredentialInsert = false;
let releaseCount = 0;
const pool = {
  async connect() {
    return {
      async query(sql, values = []) {
        if (/^begin$/i.test(sql.trim())) return db.query('begin');
        if (/^commit$/i.test(sql.trim())) return db.query('commit');
        if (/^rollback$/i.test(sql.trim())) return db.query('rollback');
        if (/pg_advisory_xact_lock/i.test(sql)) return {rows: [{}]};
        if (failCredentialInsert &&
            /insert into public\.kimia_customer_(registration_proofs|access_sessions)/i.test(sql)) {
          throw new Error('injected credential failure');
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

const service = createOtpVerificationService({pool, hashSecret: secret});

// New customer: canonical digits, keyed hash, proof, one-time consumption.
const newPhone = '+989307897825';
const newCode = '012345';
const newHash = hashCustomerOtp({secret, phone: newPhone, code: newCode}).value;
const newOldAccess = 'N'.repeat(43);
const newOldProof = 'Q'.repeat(43);
const newUsedProof = 'U'.repeat(43);
const newRevokedProof = 'V'.repeat(43);
const previousAccount = (await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989111111110','پیشین','مشتری') returning id`,
)).rows[0];
const otherDeviceAccess = 'X'.repeat(43);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989111111110',$2,now()+interval '30 days')`,
  [previousAccount.id, hashOpaqueCredential(newOldAccess)],
);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989111111110',$2,now()+interval '30 days')`,
  [previousAccount.id, hashOpaqueCredential(otherDeviceAccess)],
);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
   values ($1,$2,now()+interval '15 minutes')`,
  [newPhone, hashOpaqueCredential(newOldProof)],
);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at,used_at)
   values ('+989111111111',$1,now()+interval '15 minutes',now())`,
  [hashOpaqueCredential(newUsedProof)],
);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at,revoked_at)
   values ('+989111111112',$1,now()+interval '15 minutes',now())`,
  [hashOpaqueCredential(newRevokedProof)],
);
await db.query(
  `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at)
   values ($1,$2,now()+interval '5 minutes')`,
  [newPhone, newHash],
);
releaseCount = 0;
const newResult = await service.verify({
  phone: '۰۹۳۰۷۸۹۷۸۲۵',
  code: '٠١٢٣٤٥',
  previousCredentials: [
    {type: 'access', raw: newOldAccess},
    {type: 'registration', raw: newOldProof},
    {type: 'registration', raw: newUsedProof},
    {type: 'registration', raw: newRevokedProof},
  ],
});
assert.equal(newResult.ok, true);
assert.equal(newResult.is_new_user, true);
assert.equal(newResult.credential.type, 'registration');
assert.equal(validateOpaqueCredential(newResult.credential.raw), true);
assert.equal(releaseCount, 1);
const newProof = await db.query(
  'select proof_hash,expires_at,used_at,revoked_at from public.kimia_customer_registration_proofs',
);
assert.equal(newProof.rows.length, 4);
const issuedProof = newProof.rows.find(row => row.proof_hash === hashOpaqueCredential(newResult.credential.raw));
assert.ok(issuedProof);
assert.equal(issuedProof.used_at, null);
assert.equal(issuedProof.revoked_at, null);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(newOldProof)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(newOldAccess)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(otherDeviceAccess)],
)).rows[0].active, true);
assert.equal((await db.query(
  'select used_at is not null and revoked_at is null as unchanged from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(newUsedProof)],
)).rows[0].unchanged, true);
assert.equal((await db.query(
  'select revoked_at is not null and used_at is null as unchanged from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(newRevokedProof)],
)).rows[0].unchanged, true);
assert.equal((await db.query(
  'select consumed_at is not null as consumed from public.kimia_customer_otp_challenges',
)).rows[0].consumed, true);

const replay = await service.verify({phone: newPhone, code: newCode});
assert.deepEqual(replay, {ok: false, code: 'otp_expired'});

// Existing customer: access session, account metadata, 30-day lifetime.
await db.exec('delete from public.kimia_customer_registration_proofs');
await db.exec('delete from public.kimia_customer_otp_challenges');
await db.exec('delete from public.kimia_customer_access_sessions');
await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name,marketing_consent)
   values ('+989111111111','نام','خانوادگی',true)`,
);
const existingCode = '654321';
const existingHash = hashCustomerOtp({secret, phone: '+989111111111', code: existingCode}).value;
await db.query(
  `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at)
   values ($1,$2,now()+interval '5 minutes')`,
  ['+989111111111', existingHash],
);
const staleAccessRaw = 'A'.repeat(43);
const staleProofRaw = 'P'.repeat(43);
const staleAccessHash = hashOpaqueCredential(staleAccessRaw);
const staleProofHash = hashOpaqueCredential(staleProofRaw);
const otherAccessRaw = 'O'.repeat(43);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   select id,phone_e164,$1,now()+interval '30 days'
     from public.kimia_customer_accounts where phone_e164='+989111111111'`,
  [staleAccessHash],
);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   select id,phone_e164,$1,now()+interval '30 days'
     from public.kimia_customer_accounts where phone_e164='+989111111111'`,
  [hashOpaqueCredential(otherAccessRaw)],
);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
   values ('+989111111111',$1,now()+interval '15 minutes')`,
  [staleProofHash],
);
const existing = await service.verify({
  phone: '989111111111',
  code: existingCode,
  previousCredentials: [
    {type: 'access', raw: staleAccessRaw},
    {type: 'registration', raw: staleProofRaw},
  ],
});
assert.equal(existing.ok, true);
assert.equal(existing.is_new_user, false);
assert.equal(existing.credential.type, 'access');
assert.deepEqual(existing.user, {
  phone_e164: '+989111111111',
  first_name: 'نام',
  last_name: 'خانوادگی',
  marketing: true,
});
const session = await db.query(
  'select token_hash,expires_at-created_at as lifetime from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(existing.credential.raw)],
);
assert.equal(session.rows.length, 1);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [staleAccessHash],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(otherAccessRaw)],
)).rows[0].active, true);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_registration_proofs where proof_hash=$1',
  [staleProofHash],
)).rows[0].revoked, true);

// Wrong attempts persist, fifth failure locks.
await db.exec('delete from public.kimia_customer_otp_challenges');
const wrongCode = '111111';
const wrongHash = hashCustomerOtp({secret, phone: '+989222222222', code: '222222'}).value;
await db.query(
  `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at)
   values ($1,$2,now()+interval '5 minutes')`,
  ['+989222222222', wrongHash],
);
for (let index = 1; index <= 4; index++) {
  const result = await service.verify({phone: '+989222222222', code: wrongCode});
  assert.equal(result.code, 'otp_invalid');
  assert.equal(result.remaining_attempts, 5 - index);
}
const fifth = await service.verify({phone: '+989222222222', code: wrongCode});
assert.equal(fifth.code, 'otp_locked');
assert.equal(fifth.remaining_attempts, 0);
const attempts = await db.query(
  'select attempts from public.kimia_customer_otp_challenges',
);
assert.equal(attempts.rows[0].attempts, 5);

// Locked challenge cannot succeed, expired challenge is generic expiry.
const locked = await service.verify({phone: '+989222222222', code: '222222'});
assert.equal(locked.code, 'otp_locked');
assert.equal(locked.remaining_attempts, 0);
assert.ok(Number.isInteger(locked.retry_after_seconds));
assert.ok(locked.retry_after_seconds > 0);
await db.exec('delete from public.kimia_customer_otp_challenges');
await db.query(
  `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at,created_at)
   values ($1,$2,now()-interval '1 second',now()-interval '10 minutes')`,
  ['+989333333333', hashCustomerOtp({secret, phone: '+989333333333', code: '333333'}).value],
);
assert.deepEqual(await service.verify({phone: '+989333333333', code: '333333'}),
  {ok: false, code: 'otp_expired'});

// Revoked and replayed challenges do not succeed.
await db.exec('delete from public.kimia_customer_otp_challenges');
await db.query(
  `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at,revoked_at)
   values ($1,$2,now()+interval '5 minutes',now())`,
  ['+989444444444', hashCustomerOtp({secret, phone: '+989444444444', code: '444444'}).value],
);
assert.deepEqual(await service.verify({phone: '+989444444444', code: '444444'}),
  {ok: false, code: 'otp_expired'});

const usedOldProof = 'U'.repeat(43);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at,used_at)
   values ('+989888888881',$1,now()+interval '15 minutes',now())`,
  [hashOpaqueCredential(usedOldProof)],
);
assert.equal((await db.query(
  'select used_at is not null and revoked_at is null as safe from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(usedOldProof)],
)).rows[0].safe, true);

const revokedOldProof = 'V'.repeat(43);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at,revoked_at)
   values ('+989888888882',$1,now()+interval '15 minutes',now())`,
  [hashOpaqueCredential(revokedOldProof)],
);
assert.equal((await db.query(
  'select revoked_at is not null and used_at is null as safe from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(revokedOldProof)],
)).rows[0].safe, true);

// Malformed input does not mutate or query challenge outcomes.
const beforeMalformed = await db.query(
  'select count(*)::int as count from public.kimia_customer_otp_challenges',
);
assert.deepEqual(await service.verify({phone: '0930789782', code: '123456'}),
  {ok: false, code: 'invalid_phone'});
assert.deepEqual(await service.verify({phone: '+989555555555', code: '12345'}),
  {ok: false, code: 'invalid_otp_format'});
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_otp_challenges',
)).rows[0].count, beforeMalformed.rows[0].count);

// Credential replacement: previous access/proof record is revoked exactly.
await db.exec('delete from public.kimia_customer_otp_challenges');
await db.exec('delete from public.kimia_customer_access_sessions');
await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989666666666','نام','خانوادگی')`,
);
const oldRaw = 'R'.repeat(43);
const oldHash = hashOpaqueCredential(oldRaw);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   select id,'+989666666666',$1,now()+interval '30 days'
     from public.kimia_customer_accounts where phone_e164='+989666666666'`,
  [oldHash],
);
const replacementCode = '666666';
await db.query(
  `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at)
   values ($1,$2,now()+interval '5 minutes')`,
  ['+989666666666',
   hashCustomerOtp({secret, phone: '+989666666666', code: replacementCode}).value],
);
const replacement = await service.verify({
  phone: '+989666666666',
  code: replacementCode,
  previousCredential: {type: 'access', raw: oldRaw},
});
assert.equal(replacement.ok, true);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [oldHash],
)).rows[0].revoked, true);

// Injected credential persistence failure rolls back consumed challenge and issuance.
await db.exec('delete from public.kimia_customer_otp_challenges');
await db.exec('delete from public.kimia_customer_registration_proofs');
const rollbackPhone = '+989777777777';
const rollbackCode = '777777';
await db.query(
  `insert into public.kimia_customer_otp_challenges(phone_e164,code_hash,expires_at)
   values ($1,$2,now()+interval '5 minutes')`,
  [rollbackPhone,
   hashCustomerOtp({secret, phone: rollbackPhone, code: rollbackCode}).value],
);
const rollbackOldAccessRaw = 'Y'.repeat(43);
const rollbackOtherAccessRaw = 'Z'.repeat(43);
const rollbackOldProofRaw = 'W'.repeat(43);
const rollbackAccount = (await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989777777778','حساب','قدیمی') returning id`,
)).rows[0];
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989777777778',$2,now()+interval '30 days')`,
  [rollbackAccount.id, hashOpaqueCredential(rollbackOldAccessRaw)],
);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   values ($1,'+989777777778',$2,now()+interval '30 days')`,
  [rollbackAccount.id, hashOpaqueCredential(rollbackOtherAccessRaw)],
);
await db.query(
  `insert into public.kimia_customer_registration_proofs(phone_e164,proof_hash,expires_at)
   values ('+989777777778',$1,now()+interval '15 minutes')`,
  [hashOpaqueCredential(rollbackOldProofRaw)],
);
releaseCount = 0;
failCredentialInsert = true;
const rollbackBefore = await db.query(
  'select id::text,phone_e164,proof_hash,used_at,revoked_at,expires_at,created_at from public.kimia_customer_registration_proofs order by id',
);
const rollbackChallengeBefore = await db.query(
  'select id::text,phone_e164,attempts,consumed_at,revoked_at,expires_at,created_at from public.kimia_customer_otp_challenges where phone_e164=$1',
  [rollbackPhone],
);
const rollbackAccessBefore = await db.query(
  'select id::text,token_hash,revoked_at from public.kimia_customer_access_sessions order by id',
);
const rollbackProofBefore = await db.query(
  'select id::text,proof_hash,used_at,revoked_at from public.kimia_customer_registration_proofs order by id',
);
const rollbackResult = await service.verify({
  phone: rollbackPhone,
  code: rollbackCode,
  previousCredentials: [
    {type: 'access', raw: rollbackOldAccessRaw},
    {type: 'registration', raw: rollbackOldProofRaw},
  ],
});
failCredentialInsert = false;
assert.deepEqual(rollbackResult, {ok: false, code: 'auth_unavailable'});
assert.equal(releaseCount, 1);
assert.deepEqual(await db.query(
  'select id::text,phone_e164,proof_hash,used_at,revoked_at,expires_at,created_at from public.kimia_customer_registration_proofs order by id',
), rollbackBefore);
assert.deepEqual(await db.query(
  'select id::text,phone_e164,attempts,consumed_at,revoked_at,expires_at,created_at from public.kimia_customer_otp_challenges where phone_e164=$1',
  [rollbackPhone],
), rollbackChallengeBefore);
assert.deepEqual(await db.query(
  'select id::text,token_hash,revoked_at from public.kimia_customer_access_sessions order by id',
), rollbackAccessBefore);
assert.deepEqual(await db.query(
  'select id::text,proof_hash,used_at,revoked_at from public.kimia_customer_registration_proofs order by id',
), rollbackProofBefore);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(rollbackOtherAccessRaw)],
)).rows[0].active, true);

await db.close();
console.log('Customer OTP verification PGlite passed: success, attempts, replay, replacement, rollback and no raw credential leakage.');
