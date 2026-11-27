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
  '006_customer_auth_v1.sql',
  '007_customer_referrals.sql',
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
const CUSTOMER_TABLES = [
  'kimia_customer_accounts',
  'kimia_customer_otp_challenges',
  'kimia_customer_registration_proofs',
  'kimia_customer_access_sessions',
  'kimia_customer_send_events',
];
const LEGACY_CUSTOMER_FUNCTIONS = [
  'create_customer_otp',
  'revoke_customer_otp',
  'verify_customer_otp',
  'register_customer',
];
const REFERRAL_TABLES = [
  'kimia_referral_people',
  'kimia_customer_referrals',
  'kimia_customer_referral_history',
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

async function customerObjectInventory(client) {
  return exists(client, `select exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname = any($1::text[])
  ) as present`, [[...CUSTOMER_TABLES, ...REFERRAL_TABLES]]);
}

async function referralObjectInventory(client) {
  return exists(client, `select exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname = any($1::text[])
  ) as present`, [REFERRAL_TABLES]);
}

async function validateReferralSchema(client) {
  const completeTables = await exists(client, `select count(*)=3 as present
    from pg_tables
   where schemaname='public'
     and tablename = any($1::text[])
     and tableowner=current_user`, [REFERRAL_TABLES]);
  if (!completeTables) {
    throw new Error('Customer-referral schema is missing, partial or owned by the wrong role. Review migration 007 before proceeding.');
  }
  const rls = await exists(client, `select count(*)=3 as present
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity`, [REFERRAL_TABLES]);
  if (!rls) {
    throw new Error('Customer-referral schema is missing required row-level security settings. Review migration 007 before proceeding.');
  }
  const columns = await exists(client, `select
    (select count(*)=5 from information_schema.columns
      where table_schema='public' and table_name='kimia_referral_people'
        and ((column_name='id' and data_type='uuid' and is_nullable='NO')
          or (column_name='display_name' and data_type='text' and is_nullable='NO')
          or (column_name='person_kind' and data_type='text' and is_nullable='NO')
          or (column_name='created_by_admin_id' and data_type='uuid' and is_nullable='NO')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO')))
    and (select count(*)=21 from information_schema.columns
      where table_schema='public' and table_name='kimia_customer_referrals'
        and ((column_name='customer_account_id' and data_type='uuid' and is_nullable='NO')
          or (column_name='site_discovery_channel' and data_type='text' and is_nullable='NO')
          or (column_name='site_declaration_status' and data_type='text' and is_nullable='NO')
          or (column_name='site_declaration_kind' and data_type='text' and is_nullable='YES')
          or (column_name='site_declaration_value' and data_type='text' and is_nullable='YES')
          or (column_name='salon_declaration_status' and data_type='text' and is_nullable='NO')
          or (column_name='salon_declaration_kind' and data_type='text' and is_nullable='YES')
          or (column_name='salon_declaration_value' and data_type='text' and is_nullable='YES')
          or (column_name='same_referrer_declared' and data_type='boolean' and is_nullable='NO')
          or (column_name='declaration_recorded_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='site_verification_status' and data_type='text' and is_nullable='NO')
          or (column_name='site_referrer_person_id' and data_type='uuid' and is_nullable='YES')
          or (column_name='site_introduced_on' and data_type='date' and is_nullable='YES')
          or (column_name='salon_verification_status' and data_type='text' and is_nullable='NO')
          or (column_name='salon_referrer_person_id' and data_type='uuid' and is_nullable='YES')
          or (column_name='salon_introduced_on' and data_type='date' and is_nullable='YES')
          or (column_name='same_referrer_confirmed' and data_type='boolean' and is_nullable='NO')
          or (column_name='recorded_by_admin_id' and data_type='uuid' and is_nullable='YES')
          or (column_name='recorded_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO')
          or (column_name='updated_at' and data_type='timestamp with time zone' and is_nullable='NO')))
    and (select count(*)=8 from information_schema.columns
      where table_schema='public' and table_name='kimia_customer_referral_history'
        and ((column_name='id' and data_type='uuid' and is_nullable='NO')
          or (column_name='customer_account_id' and data_type='uuid' and is_nullable='NO')
          or (column_name='event_type' and data_type='text' and is_nullable='NO')
          or (column_name='actor_admin_id' and data_type='uuid' and is_nullable='NO')
          or (column_name='change_reason' and data_type='text' and is_nullable='YES')
          or (column_name='previous_state' and data_type='jsonb' and is_nullable='YES')
          or (column_name='new_state' and data_type='jsonb' and is_nullable='NO')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO'))) as present`);
  if (!columns) {
    throw new Error('Customer-referral schema is missing essential columns. Review migration 007 before proceeding.');
  }
  const privileges = await exists(client, `select not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     where n.nspname='public'
       and c.relname=any($1::text[])
       and (
         acl.grantee=0
         or acl.grantee in (
           select oid from pg_roles
            where rolname in ('anon','authenticated','service_role')
         )
       )
  ) as present`, [REFERRAL_TABLES]);
  if (!privileges) {
    throw new Error('Customer-referral table privileges were found for a legacy API role. Review migration 007 before proceeding.');
  }
}

async function legacyCustomerFunctionInventory(client) {
  return exists(client, `select exists (
    select 1
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=any($1::text[])
  ) as present`, [LEGACY_CUSTOMER_FUNCTIONS]);
}

async function validateCustomerSchema(client) {
  const completeTables = await exists(client, `select count(*)=5 as present
    from pg_tables
   where schemaname='public'
     and tablename = any($1::text[])
     and tableowner=current_user`, [CUSTOMER_TABLES]);
  if (!completeTables) {
    throw new Error('Customer-auth schema is missing, partial or owned by the wrong role. Review migration 006 before proceeding.');
  }

  const rls = await exists(client, `select count(*)=5 as present
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname=any($1::text[]) and c.relrowsecurity`, [CUSTOMER_TABLES]);
  if (!rls) {
    throw new Error('Customer-auth schema is missing required row-level security settings. Review migration 006 before proceeding.');
  }

  const columns = await exists(client, `select
    (select count(*)=8 from information_schema.columns
      where table_schema='public' and table_name='kimia_customer_accounts'
        and ((column_name='id' and data_type='uuid' and is_nullable='NO')
          or (column_name='phone_e164' and data_type='text' and is_nullable='NO')
          or (column_name='first_name' and data_type='text' and is_nullable='NO')
          or (column_name='last_name' and data_type='text' and is_nullable='NO')
          or (column_name='marketing_consent' and data_type='boolean' and is_nullable='NO')
          or (column_name='marketing_consent_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO')
          or (column_name='updated_at' and data_type='timestamp with time zone' and is_nullable='NO')))
    and (select count(*)=8 from information_schema.columns
      where table_schema='public' and table_name='kimia_customer_otp_challenges'
        and ((column_name='id' and data_type='uuid' and is_nullable='NO')
          or (column_name='phone_e164' and data_type='text' and is_nullable='NO')
          or (column_name='code_hash' and data_type='character' and character_maximum_length=64 and is_nullable='NO')
          or (column_name='expires_at' and data_type='timestamp with time zone' and is_nullable='NO')
          or (column_name='attempts' and data_type='smallint' and is_nullable='NO')
          or (column_name='consumed_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='revoked_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO')))
    and (select count(*)=7 from information_schema.columns
      where table_schema='public' and table_name='kimia_customer_registration_proofs'
        and ((column_name='id' and data_type='uuid' and is_nullable='NO')
          or (column_name='phone_e164' and data_type='text' and is_nullable='NO')
          or (column_name='proof_hash' and data_type='character' and character_maximum_length=64 and is_nullable='NO')
          or (column_name='expires_at' and data_type='timestamp with time zone' and is_nullable='NO')
          or (column_name='used_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='revoked_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO')))
    and (select count(*)=7 from information_schema.columns
      where table_schema='public' and table_name='kimia_customer_access_sessions'
        and ((column_name='id' and data_type='uuid' and is_nullable='NO')
          or (column_name='account_id' and data_type='uuid' and is_nullable='NO')
          or (column_name='phone_e164' and data_type='text' and is_nullable='NO')
          or (column_name='token_hash' and data_type='character' and character_maximum_length=64 and is_nullable='NO')
          or (column_name='expires_at' and data_type='timestamp with time zone' and is_nullable='NO')
          or (column_name='revoked_at' and data_type='timestamp with time zone' and is_nullable='YES')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO')))
    and (select count(*)=5 from information_schema.columns
      where table_schema='public' and table_name='kimia_customer_send_events'
        and ((column_name='id' and data_type='uuid' and is_nullable='NO')
          or (column_name='key_type' and data_type='text' and is_nullable='NO')
          or (column_name='key_hash' and data_type='character' and character_maximum_length=64 and is_nullable='NO')
          or (column_name='phone_e164' and data_type='text' and is_nullable='YES')
          or (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO'))) as present`);
  if (!columns) {
    throw new Error('Customer-auth schema is missing essential columns. Review migration 006 before proceeding.');
  }

  const constraints = await exists(client, `select
    exists (
      select 1 from pg_constraint c
      where c.conrelid='public.kimia_customer_accounts'::regclass
        and c.contype='u'
        and c.conkey = array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='phone_e164')]::smallint[]
    )
    and exists (
      select 1 from pg_constraint c
      where c.conrelid='public.kimia_customer_registration_proofs'::regclass
        and c.contype='u'
        and c.conkey = array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='proof_hash')]::smallint[]
    )
    and exists (
      select 1 from pg_constraint c
      where c.conrelid='public.kimia_customer_access_sessions'::regclass
        and c.contype='u'
        and c.conkey = array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='token_hash')]::smallint[]
    )
    and exists (
      select 1 from pg_constraint c
      where c.conrelid='public.kimia_customer_access_sessions'::regclass
        and c.contype='f'
        and c.confrelid='public.kimia_customer_accounts'::regclass
        and c.conkey = array[
          (select attnum from pg_attribute where attrelid=c.conrelid and attname='account_id'),
          (select attnum from pg_attribute where attrelid=c.conrelid and attname='phone_e164')
        ]::smallint[]
        and c.confkey = array[
          (select attnum from pg_attribute where attrelid=c.confrelid and attname='id'),
          (select attnum from pg_attribute where attrelid=c.confrelid and attname='phone_e164')
        ]::smallint[]
    ) as present`);
  if (!constraints) {
    throw new Error('Customer-auth credential uniqueness or account relationship constraints are missing. Review migration 006 before proceeding.');
  }

  const privilege = await exists(client, `select not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     where n.nspname='public'
       and c.relname=any($1::text[])
       and (
         acl.grantee=0
         or acl.grantee in (
           select oid from pg_roles
            where rolname in ('anon','authenticated','service_role')
         )
       )
  ) as present`, [CUSTOMER_TABLES]);
  if (!privilege) {
    throw new Error('Customer-auth table privileges were found for a legacy API role. Review migration 006 before proceeding.');
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
    if (await legacyCustomerFunctionInventory(client)) {
      throw new Error('Historical migration 004 customer-auth functions detected. Migration 004 is out of scope; stop and review the database before proceeding.');
    }

    const trackingExists = await exists(client, `select to_regclass('${TRACKING_TABLE}') is not null as present`);
    const customerObjectsExist = await customerObjectInventory(client);
    let preflightRecorded = null;
    if (trackingExists) {
      await validateMigrationTracking(client);
      const appliedRows = await client.query(`select version,checksum from ${TRACKING_TABLE}`);
      preflightRecorded = new Map(appliedRows.rows.map(row => [row.version, row.checksum.trim()]));
      validateAppliedMigrations(preflightRecorded);
      if (preflightRecorded.has('006_customer_auth_v1.sql')) {
        await validateCustomerSchema(client);
      } else if (customerObjectsExist) {
        throw new Error('Untracked customer-auth/referral schema detected. Migrations 006–007 must not be adopted or recorded automatically.');
      }
      if (preflightRecorded.has('007_customer_referrals.sql')) {
        await validateReferralSchema(client);
      } else if (await referralObjectInventory(client)) {
        throw new Error('Untracked customer-referral schema detected. Migration 007 must not be adopted or recorded automatically.');
      }
    } else if (customerObjectsExist) {
      throw new Error('Untracked customer-auth/referral schema detected. Migrations 006–007 must not be adopted or recorded automatically.');
    }

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
