import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createCustomerRegistrationService} from '../server/customer-auth-registration.js';
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
]) {
  await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
}
await db.exec('grant references on public.kimia_admins to kimia_app');
await db.exec('set role kimia_app');
await db.exec(await readFile(new URL('../db/migrations/006_customer_auth_v1.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../db/migrations/007_customer_referrals.sql', import.meta.url), 'utf8'));
await db.exec('reset role');
await db.exec('set role kimia_app');

let failAccessInsert = false;
let releaseCount = 0;
let failUniqueConstraint = null;
const pool = {
  async connect() {
    return {
      async query(sql, values = []) {
        if (/^begin$/i.test(sql.trim())) return db.query('begin');
        if (/^commit$/i.test(sql.trim())) return db.query('commit');
        if (/^rollback$/i.test(sql.trim())) return db.query('rollback');
        if (/pg_advisory_xact_lock/i.test(sql)) return {rows: [{}]};
        if (failUniqueConstraint === 'kimia_customer_accounts_phone_e164_key' &&
            /insert into public\.kimia_customer_accounts/i.test(sql)) {
          const error = new Error('synthetic account phone collision');
          error.code = '23505';
          error.constraint = failUniqueConstraint;
          throw error;
        }
        if (failUniqueConstraint === 'kimia_customer_access_sessions_token_hash_key' &&
            /insert into public\.kimia_customer_access_sessions/i.test(sql)) {
          const error = new Error('synthetic unique failure');
          error.code = '23505';
          error.constraint = failUniqueConstraint;
          throw error;
        }
        if (failAccessInsert &&
            /insert into public\.kimia_customer_access_sessions/i.test(sql)) {
          throw new Error('injected access session failure');
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

const service = createCustomerRegistrationService({pool});

async function addProof(phone, options = {}) {
  const raw = generateOpaqueCredential();
  const hash = hashOpaqueCredential(raw);
  await db.query(
    `insert into public.kimia_customer_registration_proofs
       (phone_e164,proof_hash,expires_at,created_at,used_at,revoked_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      phone,
      hash,
      options.expired ? new Date(Date.now() - 1000).toISOString() : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      new Date(Date.now() - 60 * 1000).toISOString(),
      options.used ? new Date().toISOString() : null,
      options.revoked ? new Date().toISOString() : null,
    ],
  );
  return raw;
}

// Default marketing consent and valid profile create account and access session.
const raw1 = await addProof('+989307897825');
const registered = await service.register({
  profile: {first_name: '  نام\u200cخانوادگی  ', last_name: '  محمدی  '},
  registrationCredential: raw1,
});
assert.equal(registered.ok, true);
assert.equal(registered.user.phone_e164, '+989307897825');
assert.equal(registered.user.marketing, false);
assert.equal(registered.credential.type, 'access');
assert.equal((await db.query(
  'select marketing_consent,marketing_consent_at from public.kimia_customer_accounts where phone_e164=$1',
  ['+989307897825'],
)).rows[0].marketing_consent, false);
assert.equal((await db.query(
  'select marketing_consent_at from public.kimia_customer_accounts where phone_e164=$1',
  ['+989307897825'],
)).rows[0].marketing_consent_at, null);
const defaultReferral = (await db.query(
  `select site_discovery_channel,site_declaration_status,salon_declaration_status,
          site_verification_status,salon_verification_status,recorded_by_admin_id
     from public.kimia_customer_referrals
    where customer_account_id=(select id from public.kimia_customer_accounts where phone_e164=$1)`,
  ['+989307897825'],
)).rows[0];
assert.deepEqual(defaultReferral, {
  site_discovery_channel: 'not_reported',
  site_declaration_status: 'not_reported',
  salon_declaration_status: 'not_reported',
  site_verification_status: 'not_reviewed',
  salon_verification_status: 'not_reviewed',
  recorded_by_admin_id: null,
});

const referralProof = await addProof('+989333333331');
const referralRegistration = await service.register({
  profile: {
    first_name: 'نرگس',
    last_name: 'رضایی',
    referral: {
      discovery_channel: 'personal_referral',
      same_referrer: true,
      site_referrer: {status: 'pending', kind: 'name', value: 'شخص معرف'},
      salon_referrer: {status: 'pending', kind: 'name', value: 'شخص معرف'},
    },
  },
  registrationCredential: referralProof,
});
assert.equal(referralRegistration.ok, true);
const declaration = (await db.query(
  `select site_discovery_channel,site_declaration_status,site_declaration_kind,
          site_declaration_value,salon_declaration_status,salon_declaration_value,
          same_referrer_declared,declaration_recorded_at,
          site_verification_status,site_referrer_person_id
     from public.kimia_customer_referrals
    where customer_account_id=(select id from public.kimia_customer_accounts where phone_e164=$1)`,
  ['+989333333331'],
)).rows[0];
assert.equal(declaration.site_discovery_channel, 'personal_referral');
assert.equal(declaration.site_declaration_status, 'pending');
assert.equal(declaration.site_declaration_kind, 'name');
assert.equal(declaration.site_declaration_value, 'شخص معرف');
assert.equal(declaration.salon_declaration_status, 'pending');
assert.equal(declaration.salon_declaration_value, 'شخص معرف');
assert.equal(declaration.same_referrer_declared, true);
assert.ok(declaration.declaration_recorded_at);
assert.equal(declaration.site_verification_status, 'not_reviewed');
assert.equal(declaration.site_referrer_person_id, null);
assert.equal((await db.query('select count(*)::int as count from public.kimia_referral_people')).rows[0].count, 0);

// Replay of the used proof is rejected.
assert.deepEqual(await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی'},
  registrationCredential: raw1,
}), {ok: false, code: 'registration_proof_missing'});

// Explicit marketing and previous access replacement.
const raw2 = await addProof('+989111111111');
const oldRaw = generateOpaqueCredential();
const explicitOtherRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989222222222','قبلی','کاربر')`,
);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   select id,'+989222222222',$1,now()+interval '30 days'
     from public.kimia_customer_accounts where phone_e164='+989222222222'`,
  [hashOpaqueCredential(oldRaw)],
);
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   select id,'+989222222222',$1,now()+interval '30 days'
     from public.kimia_customer_accounts where phone_e164='+989222222222'`,
  [hashOpaqueCredential(explicitOtherRaw)],
);
const explicit = await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی', marketing: true},
  registrationCredential: raw2,
  previousCredential: {type: 'access', raw: oldRaw},
});
assert.equal(explicit.ok, true);
assert.equal(explicit.user.marketing, true);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(oldRaw)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(explicitOtherRaw)],
)).rows[0].active, true);
assert.equal((await db.query(
  'select marketing_consent_at is not null as consented from public.kimia_customer_accounts where phone_e164=$1',
  ['+989111111111'],
)).rows[0].consented, true);

// Identity fields are rejected and do not alter proof or account state.
for (const profile of [
  {first_name: 'نام', last_name: 'خانوادگی', phone: '+989333333333'},
  {first_name: 'نام', last_name: 'خانوادگی', account_id: 'account'},
  {first_name: 'نام', last_name: 'خانوادگی', registrationCredential: 'raw'},
  {first_name: 'نام', last_name: 'خانوادگی', marketing: 'true'},
  {first_name: 'ا', last_name: 'خانوادگی'},
]) {
  const identityProof = await addProof('+989333333333');
  assert.deepEqual(await service.register({
    profile,
    registrationCredential: identityProof,
  }), {ok: false, code: 'invalid_profile'});
  assert.equal((await db.query(
    'select used_at,revoked_at from public.kimia_customer_registration_proofs where proof_hash=$1',
    [hashOpaqueCredential(identityProof)],
  )).rows[0].used_at, null);
}

// Missing, consumed, revoked and expired proofs.
assert.deepEqual(await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی'},
  registrationCredential: 'x'.repeat(43),
}), {ok: false, code: 'registration_proof_missing'});

const consumedRaw = await addProof('+989444444444', {used: true});
assert.deepEqual(await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی'},
  registrationCredential: consumedRaw,
}), {ok: false, code: 'registration_proof_missing'});

const revokedRaw = await addProof('+989555555555', {revoked: true});
assert.deepEqual(await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی'},
  registrationCredential: revokedRaw,
}), {ok: false, code: 'registration_proof_missing'});

const expiredRaw = await addProof('+989666666666', {expired: true});
assert.deepEqual(await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی'},
  registrationCredential: expiredRaw,
}), {ok: false, code: 'registration_expired'});

// Account exists: stale proof is consumed/revoked and no session is issued.
await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989777777777','موجود','کاربر')`,
);
const existsRaw = await addProof('+989777777777');
const staleAccessRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   select id,'+989777777777',$1,now()+interval '30 days'
     from public.kimia_customer_accounts where phone_e164='+989777777777'`,
  [hashOpaqueCredential(staleAccessRaw)],
);
const otherDeviceRaw = generateOpaqueCredential();
await db.query(
  `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
   select id,'+989777777777',$1,now()+interval '30 days'
     from public.kimia_customer_accounts where phone_e164='+989777777777'`,
  [hashOpaqueCredential(otherDeviceRaw)],
);
const existsProofHash = hashOpaqueCredential(existsRaw);
assert.deepEqual(await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی'},
  registrationCredential: existsRaw,
  previousCredentials: [{type: 'access', raw: staleAccessRaw}],
}), {ok: false, code: 'account_exists', recovery_action: 'login'});
assert.equal((await db.query(
  'select used_at is not null as consumed from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(existsRaw)],
)).rows[0].consumed, true);
assert.equal((await db.query(
  'select used_at is not null as used,revoked_at is null as no_revoke from public.kimia_customer_registration_proofs where proof_hash=$1',
  [existsProofHash],
)).rows[0].used, true);
assert.equal((await db.query(
  'select revoked_at is not null as revoked from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(staleAccessRaw)],
)).rows[0].revoked, true);
assert.equal((await db.query(
  'select revoked_at is null as active from public.kimia_customer_access_sessions where token_hash=$1',
  [hashOpaqueCredential(otherDeviceRaw)],
)).rows[0].active, true);

// Account-phone and unrelated access-token unique failures roll back real cleanup.
async function seedOldCredentials(phone) {
  const oldAccess = generateOpaqueCredential();
  const otherAccess = generateOpaqueCredential();
  const oldProof = await addProof(phone);
  const accountPhone = phone === '+989999999991' ? '+989999999992' : '+989999999993';
  const account = (await db.query(
    `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
     values ($1,'پیشین','مشتری') returning id`,
    [accountPhone],
  )).rows[0];
  for (const raw of [oldAccess, otherAccess]) {
    await db.query(
      `insert into public.kimia_customer_access_sessions(account_id,phone_e164,token_hash,expires_at)
       values ($1,$2,$3,now()+interval '30 days')`,
      [account.id, accountPhone, hashOpaqueCredential(raw)],
    );
  }
  const oldProofForSession = await addProof(accountPhone);
  return {oldAccess, otherAccess, oldProof, oldProofForSession, accountPhone};
}

for (const [phone, uniqueConstraint] of [
  ['+989999999991', 'kimia_customer_accounts_phone_e164_key'],
  ['+989999999994', 'kimia_customer_access_sessions_token_hash_key'],
]) {
  const credentials = await seedOldCredentials(phone);
  const beforeAccess = await db.query(
    'select id::text,token_hash,revoked_at from public.kimia_customer_access_sessions where phone_e164=$1 order by id',
    [credentials.accountPhone],
  );
  const beforeOldProof = await db.query(
    'select id::text,proof_hash,used_at,revoked_at from public.kimia_customer_registration_proofs where proof_hash=$1',
    [hashOpaqueCredential(credentials.oldProofForSession)],
  );
  const beforeTargetProof = await db.query(
    'select id::text,proof_hash,used_at,revoked_at from public.kimia_customer_registration_proofs where proof_hash=$1',
    [hashOpaqueCredential(credentials.oldProof)],
  );
  releaseCount = 0;
  failUniqueConstraint = uniqueConstraint;
  const uniqueFailure = await service.register({
    profile: {first_name: 'نام', last_name: 'خانوادگی'},
    registrationCredential: credentials.oldProof,
    previousCredentials: [
      {type: 'access', raw: credentials.oldAccess},
      {type: 'registration', raw: credentials.oldProofForSession},
    ],
  });
  failUniqueConstraint = null;
  assert.deepEqual(uniqueFailure, {ok: false, code: 'auth_unavailable'});
  assert.equal(releaseCount, 1);
  assert.deepEqual(await db.query(
    'select id::text,token_hash,revoked_at from public.kimia_customer_access_sessions where phone_e164=$1 order by id',
    [credentials.accountPhone],
  ), beforeAccess);
  assert.deepEqual(await db.query(
    'select id::text,proof_hash,used_at,revoked_at from public.kimia_customer_registration_proofs where proof_hash=$1',
    [hashOpaqueCredential(credentials.oldProofForSession)],
  ), beforeOldProof);
  assert.deepEqual(await db.query(
    'select id::text,proof_hash,used_at,revoked_at from public.kimia_customer_registration_proofs where proof_hash=$1',
    [hashOpaqueCredential(credentials.oldProof)],
  ), beforeTargetProof);
  assert.equal((await db.query(
    'select count(*)::int as count from public.kimia_customer_accounts where phone_e164=$1',
    [phone],
  )).rows[0].count, 0);
}

// Rollback after account insertion: injected access-session failure rolls back account and proof.
await db.exec('delete from public.kimia_customer_registration_proofs');
await db.exec('delete from public.kimia_customer_accounts where phone_e164='+ "'+989888888888'");
const rollbackRaw = await addProof('+989888888888');
releaseCount = 0;
failAccessInsert = true;
const rollbackResult = await service.register({
  profile: {first_name: 'نام', last_name: 'خانوادگی', marketing: false},
  registrationCredential: rollbackRaw,
});
failAccessInsert = false;
assert.deepEqual(rollbackResult, {ok: false, code: 'auth_unavailable'});
assert.equal(releaseCount, 1);
assert.equal((await db.query(
  'select count(*)::int as count from public.kimia_customer_accounts where phone_e164=$1',
  ['+989888888888'],
)).rows[0].count, 0);
assert.equal((await db.query(
  'select used_at is null and revoked_at is null as intact from public.kimia_customer_registration_proofs where proof_hash=$1',
  [hashOpaqueCredential(rollbackRaw)],
)).rows[0].intact, true);

await db.close();
console.log('Customer registration PGlite passed: proof identity, profile consent, account_exists recovery, replay and rollback.');
