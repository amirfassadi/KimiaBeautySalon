import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {runMigrations} from '../server/migrate.js';

const migrationNames = [
  '001_initial_schema.sql',
  '002_admin_booking.sql',
  '003_booking_tracking.sql',
  '005_self_hosted_admin.sql',
  '006_customer_auth_v1.sql',
  '007_customer_referrals.sql',
];
const checksum = async name => createHash('sha256')
  .update(await readFile(new URL('../db/migrations/' + name, import.meta.url)))
  .digest('hex');

async function createOwnerDb() {
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
  const pool = {
    async query(sql, values = []) {
      if (/pg_advisory_(?:un)?lock/.test(sql)) return {rows: [{pg_advisory_lock: null, pg_advisory_unlock: true}]};
      if (!values.length && (sql.match(/;/g) || []).length > 1) {
        await db.exec(sql);
        return {rows: []};
      }
      return db.query(sql, values);
    },
    async connect() {
      return {
        query: async (sql, values = []) => {
          if (/pg_advisory_(?:un)?lock/.test(sql)) return {rows: [{pg_advisory_lock: null, pg_advisory_unlock: true}]};
          if (!values.length && (sql.match(/;/g) || []).length > 1) {
            await db.exec(sql);
            return {rows: []};
          }
          return db.query(sql, values);
        },
        release() {},
      };
    },
  };
  return {db, pool};
}

async function createHistory(db, names) {
  await db.exec(`
    create table public.kimia_schema_migrations(
      version text primary key,
      checksum char(64) not null,
      applied_at timestamptz not null default now()
    )
  `);
  for (const name of names) {
    await db.query(
      'insert into public.kimia_schema_migrations(version,checksum) values($1,$2)',
      [name, await checksum(name)],
    );
  }
}

async function objectInventory(db) {
  return (await db.query(`
    select c.relname as name, pg_get_userbyid(c.relowner) as owner,
           c.relkind::text as kind
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and (c.relname like 'kimia_customer_%' or c.relname='customer_accounts'
            or c.relname='customer_otp_challenges'
            or c.relname='customer_sessions'
            or c.relname='customer_auth_rate_limits')
     order by c.relname
  `)).rows;
}

async function rejectionSnapshot(db) {
  const objects = await db.query(`
    select c.relname as name, pg_get_userbyid(c.relowner) as owner,
           c.relkind::text as kind
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and (c.relname like 'kimia_customer_%'
            or c.relname like 'customer_%'
            or c.relname='revoke_customer_otp'
            or c.relname='kimia_schema_migrations')
     order by c.relname
  `);
  let history = {rows: []};
  if ((await db.query("select to_regclass('public.kimia_schema_migrations') is not null as exists")).rows[0].exists) {
    history = await db.query('select version,checksum from public.kimia_schema_migrations order by version');
  }
  return {objects: objects.rows, history: history.rows};
}

// Fresh install and repeat run.
{
  const {db, pool} = await createOwnerDb();
  const first = await runMigrations(pool);
  assert.deepEqual(first, migrationNames);
  assert.deepEqual(await runMigrations(pool), first);
  assert.equal((await db.query('select count(*)::int as count from public.kimia_schema_migrations')).rows[0].count, 6);
  await db.close();
}

// Valid four-version upgrade preserves existing content and 005 admin data.
{
  const {db, pool} = await createOwnerDb();
  for (const name of migrationNames.slice(0, 4).filter(name => name !== '006_customer_auth_v1.sql')) {
    await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
  }
  await db.query("update public.site_settings set content=$1 where id=true", [{name: 'existing-content'}]);
  const admin = (await db.query(
    `insert into public.kimia_admins(email,password_hash)
     values ('existing-admin@example.test',$1) returning id`,
    ['9'.repeat(64)],
  )).rows[0];
  await db.query(
    `insert into public.kimia_admin_sessions(token_hash,admin_id,expires_at)
     values ($1,$2,now()+interval '8 hours')`,
    ['8'.repeat(64), admin.id],
  );
  await createHistory(db, migrationNames.slice(0, 4).filter(name => name !== '006_customer_auth_v1.sql'));
  const result = await runMigrations(pool);
  assert.deepEqual(result, migrationNames);
  assert.equal((await db.query("select content->>'name' as name from public.site_settings")).rows[0].name, 'existing-content');
  assert.equal((await db.query("select count(*)::int as count from public.kimia_admins where email='existing-admin@example.test'")).rows[0].count, 1);
  assert.equal((await db.query("select count(*)::int as count from public.kimia_admin_sessions where token_hash=$1", ['8'.repeat(64)])).rows[0].count, 1);
  assert.deepEqual(await runMigrations(pool), migrationNames);
  assert.equal((await db.query("select count(*)::int as count from public.kimia_admin_sessions where token_hash=$1", ['8'.repeat(64)])).rows[0].count, 1);
  await db.close();
}

// Legacy 004 remnants remain rejected.
{
  const {db, pool} = await createOwnerDb();
  await db.exec('create table public.customer_accounts(id uuid)');
  await assert.rejects(runMigrations(pool), /Migration 004 is out of scope/);
  await db.close();
}

// Untracked 006 objects reject with and without adoption before mutation.
for (const adoptExisting of [false, true]) {
  const {db, pool} = await createOwnerDb();
  await db.exec('create table public.kimia_customer_accounts(id uuid)');
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool, {adoptExisting}), /Untracked customer-auth\/referral schema detected/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  assert.equal((await db.query("select to_regclass('public.kimia_schema_migrations') is not null as exists")).rows[0].exists, false);
  await db.close();
}

// Tracked 006 with missing and partial customer schema fails before history/DDL changes.
for (const partial of [false, true]) {
  const {db, pool} = await createOwnerDb();
  for (const name of migrationNames.slice(0, 4).filter(name => name !== '006_customer_auth_v1.sql')) {
    await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
  }
  await createHistory(db, migrationNames);
  if (partial) await db.exec('create table public.kimia_customer_accounts(id uuid)');
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /Customer-auth schema is missing|partial|essential columns/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

// Wrong owner of a complete 006 schema fails closed.
{
  const {db, pool} = await createOwnerDb();
  for (const name of migrationNames.slice(0, 4).filter(name => name !== '006_customer_auth_v1.sql')) {
    await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
  }
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../db/migrations/006_customer_auth_v1.sql', import.meta.url), 'utf8'));
  await db.exec('set role kimia_app');
  await createHistory(db, migrationNames);
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /owned by the wrong role|missing, partial or owned by the wrong role/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

// Exact key semantics and essential types/nullability reject tampering.
{
  const {db, pool} = await createOwnerDb();
  const first = await runMigrations(pool);
  assert.deepEqual(first, migrationNames);
  await db.exec('alter table public.kimia_customer_accounts drop constraint kimia_customer_accounts_phone_e164_key');
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /credential uniqueness|account relationship|essential columns|missing, partial/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

{
  const {db, pool} = await createOwnerDb();
  await runMigrations(pool);
  await db.exec('alter table public.kimia_customer_otp_challenges alter column attempts type integer');
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /essential columns|missing, partial/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

{
  const {db, pool} = await createOwnerDb();
  await runMigrations(pool);
  await db.exec('alter table public.kimia_customer_registration_proofs alter column proof_hash drop not null');
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /essential columns|missing, partial/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

{
  const {db, pool} = await createOwnerDb();
  await runMigrations(pool);
  await db.exec('alter table public.kimia_customer_access_sessions drop constraint kimia_customer_access_sessions_account_id_phone_e164_fkey');
  await db.exec(`
    alter table public.kimia_customer_access_sessions
      add constraint mismatched_customer_session_fk
      foreign key (account_id) references public.kimia_customer_accounts(id)
  `);
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /credential uniqueness|account relationship|missing, partial/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

{
  const {db, pool} = await createOwnerDb();
  await runMigrations(pool);
  await db.exec('alter table public.kimia_customer_access_sessions drop constraint kimia_customer_access_sessions_token_hash_key');
  await db.exec(`
    alter table public.kimia_customer_access_sessions
      add constraint composite_token_unique unique (token_hash, account_id)
  `);
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /credential uniqueness|account relationship|missing, partial/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

// An orphan historical 004 function is rejected in a valid four-version baseline.
{
  const {db, pool} = await createOwnerDb();
  for (const name of migrationNames.slice(0, 4).filter(name => name !== '006_customer_auth_v1.sql')) {
    await db.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
  }
  await createHistory(db, migrationNames.slice(0, 4).filter(name => name !== '006_customer_auth_v1.sql'));
  await db.exec(`
    create function public.revoke_customer_otp(uuid)
    returns void language sql as 'select 1';
  `);
  const before = await rejectionSnapshot(db);
  await assert.rejects(runMigrations(pool), /Historical migration 004 customer-auth functions detected/);
  assert.deepEqual(await rejectionSnapshot(db), before);
  await db.close();
}

// Recorded 006 checksum mismatch is rejected.
{
  const {db, pool} = await createOwnerDb();
  const first = await runMigrations(pool);
  assert.deepEqual(first, migrationNames);
  await db.query(
    "update public.kimia_schema_migrations set checksum=$1 where version='006_customer_auth_v1.sql'",
    ['1'.repeat(64)],
  );
  await assert.rejects(runMigrations(pool), /Applied migration checksum differs/);
  await db.close();
}

console.log('Migration 006 runner PGlite checks passed: fresh, four-version upgrade, repeat, legacy/untracked/partial/wrong-owner and checksum rejection.');
