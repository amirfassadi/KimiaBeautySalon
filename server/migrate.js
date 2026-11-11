import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {postgresConfig} from './postgres-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = [
  '001_initial_schema.sql',
  '002_admin_booking.sql',
  '003_booking_tracking.sql',
  '005_self_hosted_admin.sql',
];
const TRACKING_TABLE = 'public.kimia_schema_migrations';
const ADVISORY_LOCK_NAME = 'kimia:self-hosted:migrations:v1';
const APPLICATION_TABLES = [
  'service_categories', 'services', 'staff_members', 'business_hours',
  'booking_requests', 'appointments', 'gallery_items', 'booking_rate_limits',
  'site_settings', 'admin_audit', 'kimia_admins', 'kimia_admin_sessions',
  'kimia_admin_login_limits', 'customer_accounts', 'customer_otp_challenges',
  'customer_sessions', 'customer_auth_rate_limits',
];
const APPLICATION_FUNCTIONS = [
  'create_booking_request', 'create_booking_v2', 'manage_booking', 'lookup_booking',
  'create_customer_otp', 'revoke_customer_otp', 'verify_customer_otp', 'register_customer',
];

async function exists(client, sql, values) {
  const result = await client.query(sql, values);
  return Boolean(result.rows[0]?.present);
}

async function migrationMarkers(client) {
  const v1Tables = ['service_categories', 'services', 'staff_members', 'business_hours', 'booking_requests', 'appointments', 'gallery_items', 'booking_rate_limits'];
  let presentTables = 0;
  for (const table of v1Tables) {
    if (await exists(client, 'select to_regclass($1) is not null as present', [`public.${table}`])) presentTables += 1;
  }
  if (presentTables === 0) return [false, false, false];
  if (presentTables !== v1Tables.length) return [true, false, false];
  const v1Function = await exists(client, "select to_regprocedure('public.create_booking_request(text,text,text,text,text,text)') is not null as present");
  if (!v1Function) return [false, false, false];

  const v2Tables = await exists(client, "select to_regclass('public.site_settings') is not null and to_regclass('public.admin_audit') is not null as present");
  const v2Columns = await exists(client, `select
    (select count(*)=5 from information_schema.columns where table_schema='public' and
      ((table_name='services' and column_name in ('details_fa','seo_title','seo_description')) or
       (table_name='gallery_items' and column_name='consent_confirmed') or
       (table_name='booking_requests' and column_name='request_key'))) as present`);
  const v2Functions = await exists(client, "select to_regprocedure('public.create_booking_v2(text,text,text,text,text,text,uuid,boolean,timestamptz)') is not null and to_regprocedure('public.manage_booking(uuid,text,text,uuid,timestamptz,timestamptz)') is not null as present");
  const v2 = v2Tables && v2Columns && v2Functions;
  if (!v2) return [true, false, false];

  const v3 = await exists(client, "select to_regprocedure('public.lookup_booking(text,text,text)') is not null as present");
  return [true, true, v3];
}

async function applicationObjectsExist(client) {
  return exists(client, `select
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname = any($1::text[])
         and c.relkind in ('r','p','v','m','S')
    ) or exists (
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname = any($2::text[])
    ) as present`, [APPLICATION_TABLES, APPLICATION_FUNCTIONS]);
}

async function migrationChecksum(name) {
  const source = await readFile(path.join(ROOT, 'db', 'migrations', name));
  return createHash('sha256').update(source).digest('hex');
}

async function checkRequiredRoles(client) {
  const result = await client.query(
    `select role_name from (values ('anon'),('authenticated'),('service_role')) as required(role_name)
     where not exists (select 1 from pg_roles where rolname=role_name)`,
  );
  if (result.rows.length) throw new Error(`Missing PostgreSQL roles required by migrations: ${result.rows.map(row => row.role_name).join(', ')}`);
}

async function checkApplicationRole(client) {
  const result = await client.query(
    'select current_user as role_name, rolsuper from pg_roles where rolname=current_user',
  );
  const role = result.rows[0];
  if (!role || role.rolsuper || role.role_name === 'postgres') {
    throw new Error('Run migrations as the dedicated non-superuser application database role, not postgres.');
  }
}

async function checkAdoptionOwnership(client) {
  const tables = await exists(client, `select count(*)=10 as present
    from pg_tables where schemaname='public' and tablename = any($1::text[]) and tableowner=current_user`,
    [['service_categories','services','staff_members','business_hours','booking_requests','appointments','gallery_items','booking_rate_limits','site_settings','admin_audit']]);
  const functions = await exists(client, `select count(*)=3 as present
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any($1::text[])
      and p.proowner=(select oid from pg_roles where rolname=current_user)`,
    [['create_booking_v2','lookup_booking','manage_booking']]);
  if (!tables || !functions) {
    throw new Error('Existing schema is not owned by the connected application role. Do not change ownership blindly; restore to a dedicated database or obtain an approved ownership plan.');
  }
}

async function validateMigrationTracking(client) {
  const columns = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='kimia_schema_migrations'`,
  );
  const required = new Set(['version', 'checksum', 'applied_at']);
  for (const {column_name: name} of columns.rows) required.delete(name);
  if (required.size) {
    throw new Error('Migration tracking table has an unsupported shape. Back up and review it before proceeding.');
  }
}

function validateAppliedMigrations(applied) {
  if (applied.has('004_customer_auth.sql')) {
    throw new Error('Migration 004 is out of scope; customer authentication must remain disabled.');
  }
  for (const name of applied.keys()) {
    if (!MIGRATIONS.includes(name)) {
      throw new Error(`Unknown migration is recorded in the tracking table: ${name}`);
    }
  }
  const expected = MIGRATIONS.slice(0, applied.size);
  if (expected.length !== applied.size || expected.some(name => !applied.has(name))) {
    throw new Error('Recorded migrations are out of order or incomplete. Review the database before proceeding.');
  }
}

export async function runMigrations(pool, {adoptExisting = false} = {}) {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [ADVISORY_LOCK_NAME]);
    locked = true;
    await checkApplicationRole(client);
    await checkRequiredRoles(client);
    if (await exists(client, `select
      to_regclass('public.customer_accounts') is not null or
      to_regclass('public.customer_otp_challenges') is not null or
      to_regclass('public.customer_sessions') is not null or
      to_regclass('public.customer_auth_rate_limits') is not null as present`)) {
      throw new Error('Customer-auth schema detected. Migration 004 is out of scope; stop and review the database before proceeding.');
    }

    const trackingExists = await exists(client, `select to_regclass('${TRACKING_TABLE}') is not null as present`);
    const schemaObjectsExist = await applicationObjectsExist(client);
    let markers = [false, false, false];
    if (trackingExists) {
      await validateMigrationTracking(client);
      markers = await migrationMarkers(client);
      const appliedRows = await client.query(`select version,checksum from ${TRACKING_TABLE}`);
      const recorded = new Map(appliedRows.rows.map(row => [row.version, row.checksum.trim()]));
      validateAppliedMigrations(recorded);
      if (recorded.size === 0) {
        throw new Error('An empty migration history already exists. Review the database before proceeding; fresh installation requires no application objects.');
      }
      if ((recorded.has('001_initial_schema.sql') && !markers[0]) ||
          (recorded.has('002_admin_booking.sql') && !markers[1]) ||
          (recorded.has('003_booking_tracking.sql') && !markers[2])) {
        throw new Error('Migration history does not match the complete schema recorded for that version. Review the database before proceeding.');
      }
    } else {
      markers = await migrationMarkers(client);
      if (schemaObjectsExist) {
        if (!adoptExisting || !markers.every(Boolean)) {
          throw new Error('Untracked or incomplete application schema objects exist. Back up and verify the schema; only a complete 001-003 schema may be explicitly adopted.');
        }
        await checkAdoptionOwnership(client);
      } else if (adoptExisting) {
        throw new Error('--adopt-existing was requested, but the expected 001-003 schema was not found.');
      }

      await client.query(`create table ${TRACKING_TABLE} (
        version text primary key,
        checksum char(64) not null,
        applied_at timestamptz not null default now()
      )`);
      if (schemaObjectsExist && markers.every(Boolean)) {
        for (const name of MIGRATIONS.slice(0, 3)) {
          await client.query(`insert into ${TRACKING_TABLE}(version,checksum) values($1,$2)`, [name, await migrationChecksum(name)]);
        }
      }
    }

    const appliedRows = await client.query(`select version,checksum from ${TRACKING_TABLE}`);
    const applied = new Map(appliedRows.rows.map(row => [row.version, row.checksum.trim()]));
    validateAppliedMigrations(applied);
    if (applied.size === 0 && markers.some(Boolean)) {
      throw new Error('Untracked application tables exist beside an empty migration history. Review the database before proceeding.');
    }
    if ((applied.has('001_initial_schema.sql') && !markers[0]) ||
        (applied.has('002_admin_booking.sql') && !markers[1]) ||
        (applied.has('003_booking_tracking.sql') && !markers[2])) {
      throw new Error('Migration tracking does not match the existing schema. Review the database before proceeding.');
    }
    for (const name of MIGRATIONS) {
      const checksum = await migrationChecksum(name);
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new Error(`Applied migration checksum differs from the repository file: ${name}`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(await readFile(path.join(ROOT, 'db', 'migrations', name), 'utf8'));
        await client.query(`insert into ${TRACKING_TABLE}(version,checksum) values($1,$2)`, [name, checksum]);
        await client.query('commit');
        applied.set(name, checksum);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
    return [...applied.keys()].sort();
  } finally {
    if (locked) {
      try { await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [ADVISORY_LOCK_NAME]); } catch {}
    }
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {Pool} = await import('pg');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required; no migration was run.');
    process.exitCode = 2;
  } else {
    const pool = new Pool(postgresConfig(process.env, {max: 1, application_name: 'kimia-migrations'}));
    try {
      const versions = await runMigrations(pool, {adoptExisting: process.argv.includes('--adopt-existing')});
      console.log(`Self-hosted schema versions verified/applied: ${versions.join(', ')}`);
    } catch (error) {
      console.error(`Migration runner stopped safely (${error.code || 'migration_error'}). ${error.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
