import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({extensions: {pgcrypto}});
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');

for (const name of [
  '001_initial_schema.sql',
  '002_admin_booking.sql',
  '003_booking_tracking.sql',
  '005_self_hosted_admin.sql',
]) {
  await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
}

await db.exec(`
  create role kimia_test_owner nosuperuser nobypassrls;
  grant usage, create on schema public to kimia_test_owner;
  grant references on public.kimia_admins to kimia_test_owner;
`);

const schema006 = await readFile(new URL('../db/migrations/006_customer_auth_v1.sql', import.meta.url), 'utf8');
const schema007 = await readFile(new URL('../db/migrations/007_customer_referrals.sql', import.meta.url), 'utf8');
await db.exec('set role kimia_test_owner');
await db.exec('begin');
await db.exec(schema006);
await db.exec(schema007);
await db.exec('commit');
await db.exec('reset role');
const testAdminId = (await db.query(
  `insert into public.kimia_admins(email,password_hash)
   values ('referral-owner@example.test',$1) returning id`,
  ['1'.repeat(64)],
)).rows[0].id;

assert.equal((await db.query("select to_regclass('public.customer_accounts') is not null as exists")).rows[0].exists, false);
assert.equal((await db.query("select to_regclass('public.customer_otp_challenges') is not null as exists")).rows[0].exists, false);
assert.equal((await db.query("select to_regclass('public.kimia_customer_accounts') is not null as exists")).rows[0].exists, true);
assert.equal((await db.query("select count(*)::int as count from public.service_categories")).rows[0].count >= 1, true);

const owner = await db.query(`
  select r.rolname, r.rolsuper, r.rolbypassrls
  from pg_roles r
  where r.rolname = 'kimia_test_owner'
`);
assert.deepEqual(owner.rows[0], {rolname: 'kimia_test_owner', rolsuper: false, rolbypassrls: false});

for (const table of [
  'kimia_customer_accounts',
  'kimia_customer_otp_challenges',
  'kimia_customer_registration_proofs',
  'kimia_customer_access_sessions',
  'kimia_customer_send_events',
  'kimia_referral_people',
  'kimia_customer_referrals',
  'kimia_customer_referral_history',
]) {
  const ownership = await db.query(
    `select pg_get_userbyid(c.relowner) as owner,
            c.relrowsecurity as rls_enabled
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=$1`,
    [table],
  );
  assert.equal(ownership.rows[0].owner, 'kimia_test_owner');
  assert.equal(ownership.rows[0].rls_enabled, true);
}

await db.exec('set role kimia_test_owner');
const account = (await db.query(
  `insert into public.kimia_customer_accounts
   (phone_e164,first_name,last_name,marketing_consent,marketing_consent_at)
   values ('+989307897825','نام','خانوادگی',true,now()) returning id`,
)).rows[0];
await db.query(
  `insert into public.kimia_customer_referrals
     (customer_account_id,site_discovery_channel,
      site_declaration_status,site_declaration_kind,site_declaration_value,
      salon_declaration_status,salon_declaration_kind,salon_declaration_value,
      same_referrer_declared,declaration_recorded_at)
   values ($1,'instagram','pending','name','معرف اعلام‌شده',
      'none',null,null,false,now())`,
  [account.id],
);
const declaredReferral = (await db.query(
  `select site_declaration_status,site_declaration_value,
          site_verification_status,site_referrer_person_id,
          salon_declaration_status,salon_verification_status
     from public.kimia_customer_referrals where customer_account_id=$1`,
  [account.id],
)).rows[0];
assert.deepEqual(declaredReferral, {
  site_declaration_status: 'pending',
  site_declaration_value: 'معرف اعلام‌شده',
  site_verification_status: 'not_reviewed',
  site_referrer_person_id: null,
  salon_declaration_status: 'none',
  salon_verification_status: 'not_reviewed',
});
const namedPerson = (await db.query(
  `insert into public.kimia_referral_people(display_name,person_kind,created_by_admin_id)
   values ('نام یکسان','external',$1) returning id`,
  [testAdminId],
)).rows[0].id;
const secondNamedPerson = (await db.query(
  `insert into public.kimia_referral_people(display_name,person_kind,created_by_admin_id)
   values ('نام یکسان','external',$1) returning id`,
  [testAdminId],
)).rows[0].id;
assert.notEqual(namedPerson, secondNamedPerson);
await assert.rejects(db.query(
  `update public.kimia_customer_referrals
      set site_verification_status='confirmed'
    where customer_account_id=$1`,
  [account.id],
), /violates check constraint/);
const omittedConsent = (await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989111111111','نام','خانوادگی') returning marketing_consent, marketing_consent_at`,
)).rows[0];
assert.equal(omittedConsent.marketing_consent, false);
assert.equal(omittedConsent.marketing_consent_at, null);

await assert.rejects(db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('09307897825','نام','خانوادگی')`,
), /violates check constraint/);
await assert.rejects(db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989307897825','نام','خانوادگی')`,
), /duplicate key/);
await assert.rejects(db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989222222222','ا','خانوادگی')`,
), /violates check constraint/);
await assert.rejects(db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989222222222','نام','خ')`,
), /violates check constraint/);

await db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989333333333',$1,$2)`,
  ['ن'.repeat(80), 'خ'.repeat(100)],
);
await assert.rejects(db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989444444444',$1,'خانوادگی')`,
  ['ن'.repeat(81)],
), /violates check constraint/);
await assert.rejects(db.query(
  `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
   values ('+989555555555','نام',$1)`,
  ['خ'.repeat(101)],
), /violates check constraint/);
await assert.rejects(db.query(
  `insert into public.kimia_customer_accounts
   (phone_e164,first_name,last_name,marketing_consent,marketing_consent_at)
   values ('+989666666666','نام','خانوادگی',false,now())`,
), /violates check constraint/);

await db.query(
  `insert into public.kimia_customer_otp_challenges
   (phone_e164,code_hash,expires_at) values ('+989307897825',$1,now()+interval '5 minutes')`,
  ['a'.repeat(64)],
);
await assert.rejects(db.query(
  `insert into public.kimia_customer_otp_challenges
   (phone_e164,code_hash,expires_at) values ('+989307897825','raw-otp',now()+interval '5 minutes')`,
), /violates check constraint/);

const proof = (await db.query(
  `insert into public.kimia_customer_registration_proofs
   (phone_e164,proof_hash,expires_at) values ('+989111111111',$1,now()+interval '15 minutes') returning id,proof_hash`,
  ['b'.repeat(64)],
)).rows[0];
await assert.rejects(db.query(
  `insert into public.kimia_customer_registration_proofs
   (phone_e164,proof_hash,expires_at) values ('+989777777777',$1,now()+interval '15 minutes')`,
  ['b'.repeat(64)],
), /duplicate key/);

await db.query(
  `insert into public.kimia_customer_access_sessions
   (account_id,phone_e164,token_hash,expires_at) values ($1,'+989307897825',$2,now()+interval '30 days')`,
  [account.id, 'c'.repeat(64)],
);
await assert.rejects(db.query(
  `insert into public.kimia_customer_access_sessions
   (account_id,phone_e164,token_hash,expires_at) values ($1,'+989307897825',$2,now()+interval '30 days')`,
  [account.id, 'c'.repeat(64)],
), /duplicate key/);
await assert.rejects(db.query(
  `insert into public.kimia_customer_access_sessions
   (account_id,phone_e164,token_hash,expires_at) values ($1,'+989111111111',$2,now()+interval '30 days')`,
  [account.id, 'd'.repeat(64)],
), /violates foreign key constraint|violates check constraint/);
await assert.rejects(db.query(
  `insert into public.kimia_customer_access_sessions
   (account_id,phone_e164,token_hash,expires_at) values ($1,'+989307897825','short',now()+interval '30 days')`,
  [account.id],
), /violates check constraint/);

await db.query(
  `insert into public.kimia_customer_send_events(key_type,key_hash,phone_e164)
   values ('phone',$1,'+989307897825')`,
  ['e'.repeat(64)],
);
await db.query(
  `insert into public.kimia_customer_send_events(key_type,key_hash)
   values ('trusted_ip',$1)`,
  ['f'.repeat(64)],
);
await db.exec('reset role');

for (const table of [
  'kimia_customer_accounts',
  'kimia_customer_otp_challenges',
  'kimia_customer_registration_proofs',
  'kimia_customer_access_sessions',
  'kimia_customer_send_events',
  'kimia_referral_people',
  'kimia_customer_referrals',
  'kimia_customer_referral_history',
]) {
  await db.exec('set role anon');
  await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
  await db.exec('reset role');
  await db.exec('set role authenticated');
  await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
  await db.exec('reset role');
  await db.exec('set role service_role');
  await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
  await db.exec('reset role');
}

assert.ok(proof.id);
await db.close();

console.log('Customer auth/referral schema PGlite check passed: owner/RLS boundaries, pending declarations, distinct people, consent and role denial verified.');
