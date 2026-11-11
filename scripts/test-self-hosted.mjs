import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer, request as httpRequest} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {runMigrations} from '../server/migrate.js';
import {createPostgresAdapter, adapterInternals} from '../server/postgres-adapter.js';
import {provisionAdmin} from '../server/bootstrap-admin.js';
import {createStandaloneHandler} from '../server/index.js';

function makePool(db) {
  const client = {
    async query(sql, values = []) {
      if (/pg_advisory_(?:un)?lock/.test(sql)) return {rows: [{pg_advisory_lock: null, pg_advisory_unlock: true}]};
      if (/select current_user as role_name/.test(sql)) return {rows: [{role_name: 'kimia_app', rolsuper: false}]};
      if (/count\(\)=10 as present/.test(sql) || /count\(\)=3 as present/.test(sql)) return {rows: [{present: true}]};
      if (!values.length && (sql.match(/;/g) || []).length > 1) {
        await db.exec(sql);
        return {rows: []};
      }
      return db.query(sql, values);
    },
    release() {},
  };
  return {query: client.query, connect: async () => client};
}

const db = new PGlite({extensions: {pgcrypto}});
const pool = makePool(db);
await db.exec('create role anon; create role authenticated; create role service_role;');
const versions = await runMigrations(pool);
assert.deepEqual(versions.sort(), [
  '001_initial_schema.sql',
  '002_admin_booking.sql',
  '003_booking_tracking.sql',
  '005_self_hosted_admin.sql',
].sort());
await runMigrations(pool);
assert.equal((await db.query('select count(*)::int as count from public.kimia_schema_migrations')).rows[0].count, 4);
assert.equal((await db.query("select to_regclass('public.customer_accounts') is not null as exists")).rows[0].exists, false);

const existingDb = new PGlite({extensions: {pgcrypto}});
await existingDb.exec('create role anon; create role authenticated; create role service_role;');
for (const name of ['001_initial_schema.sql', '002_admin_booking.sql', '003_booking_tracking.sql']) {
  await existingDb.exec(await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8'));
}
await existingDb.query("update public.site_settings set content=$1 where id=true", [{name: 'دادهٔ قبلی'}]);
const existingPool = makePool(existingDb);
await assert.rejects(runMigrations(existingPool), /Untracked or incomplete application schema objects exist/);
assert.equal((await existingDb.query("select to_regclass('public.kimia_schema_migrations') is not null as exists")).rows[0].exists, false);
assert.deepEqual(await runMigrations(existingPool, {adoptExisting: true}), [
  '001_initial_schema.sql', '002_admin_booking.sql', '003_booking_tracking.sql', '005_self_hosted_admin.sql',
]);
assert.equal((await existingDb.query('select content->>\'name\' as name from public.site_settings')).rows[0].name, 'دادهٔ قبلی');
await existingDb.close();

const partialDb = new PGlite();
await partialDb.exec('create role anon; create role authenticated; create role service_role; create table public.services(id integer);');
await assert.rejects(runMigrations(makePool(partialDb)), /Untracked or incomplete application schema objects exist/);
assert.equal((await partialDb.query("select to_regclass('public.kimia_schema_migrations') is not null as exists")).rows[0].exists, false);
await partialDb.close();

const missingFunctionDb = new PGlite({extensions: {pgcrypto}});
await missingFunctionDb.exec('create role anon; create role authenticated; create role service_role;');
await missingFunctionDb.exec(await readFile(new URL('../db/migrations/001_initial_schema.sql', import.meta.url), 'utf8'));
await missingFunctionDb.query(
  "insert into public.services(category_id,slug,name_fa) select id,'preserved-service','دادهٔ باقی‌مانده' from public.service_categories where slug='nails'",
);
await missingFunctionDb.exec('drop function public.create_booking_request(text,text,text,text,text,text)');
const objectInventory = async () => (await missingFunctionDb.query(`
  select 'relation' as kind, c.relname as name, c.relkind as detail
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p','v','m','S')
  union all
  select 'function', p.oid::regprocedure::text, 'f'
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
  order by 1,2,3
`)).rows;
const objectsBeforeRejection = await objectInventory();
const serviceBeforeRejection = await missingFunctionDb.query(
  "select id::text,name_fa from public.services where slug='preserved-service'",
);
await assert.rejects(
  runMigrations(makePool(missingFunctionDb)),
  /Untracked or incomplete application schema objects exist/,
);
assert.equal(
  (await missingFunctionDb.query("select to_regclass('public.kimia_schema_migrations') is not null as exists")).rows[0].exists,
  false,
  'Rejected partial schema must not create migration history.',
);
assert.deepEqual(
  await objectInventory(),
  objectsBeforeRejection,
  'Rejected partial schema must not create database objects.',
);
assert.deepEqual(
  await missingFunctionDb.query("select id::text,name_fa from public.services where slug='preserved-service'"),
  serviceBeforeRejection,
  'Rejected partial schema must preserve existing data.',
);
assert.equal(
  (await missingFunctionDb.query("select to_regprocedure('public.create_booking_request(text,text,text,text,text,text)') is not null as exists")).rows[0].exists,
  false,
);
await missingFunctionDb.close();

const outOfOrderDb = new PGlite();
await outOfOrderDb.exec(`create role anon; create role authenticated; create role service_role;
  create table public.kimia_schema_migrations(version text primary key, checksum char(64) not null, applied_at timestamptz not null default now());
  insert into public.kimia_schema_migrations(version, checksum) values('002_admin_booking.sql', repeat('0', 64));`);
await assert.rejects(runMigrations(makePool(outOfOrderDb)), /out of order or incomplete/);
await outOfOrderDb.close();

const emptyHistoryDb = new PGlite();
await emptyHistoryDb.exec(`create role anon; create role authenticated; create role service_role;
  create table public.kimia_schema_migrations(version text primary key, checksum char(64) not null, applied_at timestamptz not null default now());`);
await assert.rejects(runMigrations(makePool(emptyHistoryDb)), /An empty migration history already exists/);
assert.equal((await emptyHistoryDb.query("select count(*)::int as count from public.kimia_schema_migrations")).rows[0].count, 0);
assert.equal((await emptyHistoryDb.query("select to_regclass('public.services') is not null as exists")).rows[0].exists, false);
await emptyHistoryDb.close();

const customerAuthDb = new PGlite();
await customerAuthDb.exec('create role anon; create role authenticated; create role service_role; create table public.customer_accounts(id uuid);');
await assert.rejects(runMigrations(makePool(customerAuthDb)), /Migration 004 is out of scope/);
assert.equal((await customerAuthDb.query("select to_regclass('public.kimia_schema_migrations') is not null as exists")).rows[0].exists, false);
await customerAuthDb.close();

const adapter = createPostgresAdapter(pool);
const category = (await db.query("select id from public.service_categories where slug='nails'")).rows[0];
const created = (await adapter('services', {method: 'POST', body: {
  category_id: category.id, slug: 'test-service', name_fa: 'خدمت آزمون', description_fa: 'شرح', sort_order: 2, is_active: true,
}}))[0];
assert.ok(created.id);
assert.equal((await adapter('services?is_active=eq.true&select=*&order=sort_order.asc')).some(row => row.slug === 'test-service'), true);
await adapter(`services?id=eq.${created.id}`, {method: 'PATCH', body: {name_fa: 'خدمت پایگاه داده'}});
assert.equal((await db.query('select name_fa from public.services where id=$1', [created.id])).rows[0].name_fa, 'خدمت پایگاه داده');
await assert.rejects(adapter('services?is_active=eq.true;drop table services', {method: 'GET'}));
assert.throws(() => adapterInternals.parseOrder('services', 'id.asc;drop table services'), /order/);

const tempDir = await mkdtemp(path.join(tmpdir(), 'kimia-self-hosted-'));
const uploadDir = path.join(tempDir, 'uploads');
const runtimeEnv = {
  DATABASE_URL: 'postgresql://kimia_app@localhost/kimia_test',
  PUBLIC_BASE_URL: 'https://kbkimiabeauty.ir',
  NODE_ENV: 'production',
};
let handler = await createStandaloneHandler({
  pool, env: runtimeEnv, uploadDir,
  allowedHosts: ['127.0.0.1', 'localhost', 'kbkimiabeauty.ir', 'www.kbkimiabeauty.ir'],
});
let server = createServer(handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const origin = base;
const call = (pathName, options = {}) => fetch(base + pathName, options);
const callWithHost = (pathName, host) => new Promise((resolve, reject) => {
  const request = httpRequest({hostname: '127.0.0.1', port: address.port, path: pathName, headers: {host}}, response => {
    resolve({status: response.statusCode, headers: response.headers});
  });
  request.on('error', reject);
  request.end();
});
const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];

try {
let response = await callWithHost('/redirect-check', 'www.kbkimiabeauty.ir');
assert.equal(response.status, 308);
assert.equal(response.headers.location, 'https://kbkimiabeauty.ir/redirect-check');
response = await call('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true, database_ready: true, booking_enabled: false, customer_auth_enabled: false});
  response = await call('/api/bookings', {method: 'POST'});
  assert.equal(response.status, 404);
  response = await call('/api/auth/register', {method: 'POST'});
  assert.equal(response.status, 404);

  response = await call('/admin', {redirect: 'manual'});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/admin/login');
  response = await call('/api/admin/session', {
    headers: {'oai-authenticated-user-id': 'attacker', 'oai-authenticated-user-email': 'owner@example.test'},
  });
  assert.equal(response.status, 401, 'Caller-supplied Sites identity headers must not authenticate.');

  const login = async (email, password, requestOrigin = origin) => call('/api/admin-auth/login', {
    method: 'POST',
    headers: {origin: requestOrigin, 'content-type': 'application/json'},
    body: JSON.stringify({email, password}),
  });
  response = await login('owner@example.test', 'wrong password', 'https://attacker.example');
  assert.equal(response.status, 403, 'Cross-origin login must be rejected.');
  response = await login('owner@example.test', 'wrong password');
  assert.equal(response.status, 401, 'Invalid credentials must fail.');
  for (let attempt = 0; attempt < 5; attempt++) await login('limited@example.test', 'wrong password');
  response = await login('limited@example.test', 'wrong password');
  assert.equal(response.status, 429, 'Repeated failed logins must be throttled.');
  const parallelAttempts = await Promise.all(Array.from({length: 8}, () => login('burst@example.test', 'wrong password')));
  assert.equal(parallelAttempts.filter(result => result.status === 401).length, 5);
  assert.equal(parallelAttempts.filter(result => result.status === 429).length, 3,
    'Concurrent login attempts must be atomically throttled.');

  await provisionAdmin(pool, 'owner@example.test', 'a sufficiently long test password');
  response = await login('owner@example.test', 'a sufficiently long test password');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.deepEqual(await response.json(), {ok: true}, 'Session token must not be returned in the response.');
  let cookie = cookieFrom(response);

  response = await call('/api/admin/session', {headers: {cookie}});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {ok: true, database_ready: true, uploads_ready: true, auth_mode: 'standalone'});
  response = await call('/api/admin/settings', {
    method: 'PUT',
    headers: {cookie, origin: 'https://attacker.example', 'content-type': 'application/json'},
    body: JSON.stringify({name: 'نامی که نباید ذخیره شود'}),
  });
  assert.equal(response.status, 403, 'Cross-site admin mutation must be rejected.');

  const image = Buffer.from('RIFF0000WEBPtest-image');
  response = await call('/api/admin/upload', {method: 'POST', headers: {cookie, origin, 'content-type': 'image/webp'}, body: image});
  assert.equal(response.status, 201);
  const imageUrl = (await response.json()).image_url;
  response = await call(imageUrl);
  assert.equal(response.status, 404, 'Unpublished uploaded images must remain private.');

  response = await call('/api/admin/gallery_items', {
    method: 'POST',
    headers: {cookie, origin, 'content-type': 'application/json'},
    body: JSON.stringify({image_url: imageUrl, alt_text_fa: 'تصویر آزمون', caption_fa: 'نمونه آزمایشی', is_published: true, consent_confirmed: true, sort_order: 1}),
  });
  assert.equal(response.status, 201);
  response = await call(imageUrl);
  assert.equal(response.status, 200, 'Published image with consent must be public.');

  response = await call(`/api/admin/gallery_items`, {
    method: 'PUT',
    headers: {cookie, origin, 'content-type': 'application/json'},
    body: JSON.stringify({id: (await db.query('select id from public.gallery_items where image_url=$1', [imageUrl])).rows[0].id, is_published: false, consent_confirmed: true}),
  });
  assert.equal(response.status, 200);
  response = await call(imageUrl);
  assert.equal(response.status, 404, 'Unpublishing must remove public access.');

  const settings = {
    name: 'نام مدیرتی آزمون', phone: '+989111111111', address: 'نشانی آزمون',
    hero_title: 'عنوان آزمون', hero_description: 'متن آزمون',
    public_base_url: 'https://panel.example.test',
  };
  response = await call('/api/admin/settings', {
    method: 'PUT', headers: {cookie, origin, 'content-type': 'application/json'}, body: JSON.stringify(settings),
  });
  assert.equal(response.status, 200);
  let html = await (await call('/')).text();
  assert.match(html, /عنوان آزمون/);
  assert.match(html, /متن آزمون/);

  const serviceBody = {category_id: category.id, slug: 'standalone-service', name_fa: 'خدمت مستقل', description_fa: 'شرح مستقل', details_fa: 'جزئیات مستقل', sort_order: 1, is_active: true, seo_title: 'عنوان سئو', seo_description: 'شرح سئو'};
  response = await call('/api/admin/services', {method: 'POST', headers: {cookie, origin, 'content-type': 'application/json'}, body: JSON.stringify(serviceBody)});
  assert.equal(response.status, 201);
  const serviceId = (await response.json())[0].id;
  html = await (await call('/')).text();
  assert.match(html, /خدمت مستقل/);
  assert.match(html, /https:\/\/kbkimiabeauty\.ir\/#salon/);
  response = await call('/services/standalone-service');
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /https:\/\/kbkimiabeauty\.ir\/services\/standalone-service/);
  assert.doesNotMatch(html, /panel\.example\.test/);
  response = await call('/sitemap.xml');
  assert.match(await response.text(), /https:\/\/kbkimiabeauty\.ir\/services\/standalone-service/);
  response = await call(`/api/admin/services`, {method: 'PUT', headers: {cookie, origin, 'content-type': 'application/json'}, body: JSON.stringify({id: serviceId, name_fa: 'خدمت ویرایش‌شده'})});
  assert.equal(response.status, 200);
  html = await (await call('/')).text();
  assert.match(html, /خدمت ویرایش‌شده/);
  response = await call('/api/admin/services', {method: 'PUT', headers: {cookie, origin, 'content-type': 'application/json'}, body: JSON.stringify({id: serviceId, is_active: false})});
  assert.equal(response.status, 200);
  html = await (await call('/')).text();
  assert.doesNotMatch(html, /خدمت ویرایش‌شده/);
  assert.equal((await call('/services/standalone-service')).status, 404);

  const sessionHash = (await db.query('select token_hash from public.kimia_admin_sessions limit 1')).rows[0].token_hash;
  await db.query("update public.kimia_admin_sessions set expires_at=now()-interval '1 second' where token_hash=$1", [sessionHash]);
  response = await call('/api/admin/session', {headers: {cookie}});
  assert.equal(response.status, 401, 'Expired sessions must not authorize admin routes.');

  response = await login('owner@example.test', 'a sufficiently long test password');
  cookie = cookieFrom(response);
  response = await call('/api/admin-auth/logout', {method: 'POST', headers: {cookie, origin, 'content-type': 'application/json'}, body: '{}'});
  assert.equal(response.status, 200);
  response = await call('/api/admin/session', {headers: {cookie}});
  assert.equal(response.status, 401, 'Logout must revoke the server-side session.');

  await new Promise(resolve => server.close(resolve));
  handler = await createStandaloneHandler({pool, env: runtimeEnv, uploadDir, allowedHosts: ['127.0.0.1', 'localhost']});
  server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const restartBase = `http://127.0.0.1:${server.address().port}`;
  response = await fetch(restartBase + '/');
  html = await response.text();
  assert.match(html, /عنوان آزمون/, 'Settings must persist across application restart.');
  assert.equal((await fetch(restartBase + imageUrl)).status, 404, 'Unpublished file remains private after restart.');
  assert.deepEqual(await (await import('node:fs/promises')).readFile(path.join(uploadDir, path.basename(imageUrl))), image);
} finally {
  await new Promise(resolve => server.close(resolve));
  await rm(tempDir, {recursive: true, force: true});
  await db.close();
}

const migration002 = await readFile(new URL('../db/migrations/002_admin_booking.sql', import.meta.url), 'utf8');
assert.match(migration002, /grant all on public\.site_settings/);
console.log('Standalone PostgreSQL adapter, migration runner, admin auth/CSRF/session, content and upload lifecycle, disabled launch APIs, and restart persistence passed using PGlite.');
