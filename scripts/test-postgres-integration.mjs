import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {runMigrations} from '../server/migrate.js';
import {provisionAdmin} from '../server/bootstrap-admin.js';
import {createStandaloneHandler} from '../server/index.js';
import {postgresConfig} from '../server/postgres-config.js';

const connectionString = process.env.KIMIA_TEST_DATABASE_URL;
if (!connectionString) {
  console.log('Skipped real PostgreSQL integration test: set KIMIA_TEST_DATABASE_URL to an isolated local kimia_test_* database.');
  process.exit(0);
}

const target = new URL(connectionString);
const databaseName = decodeURIComponent(target.pathname.slice(1));
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname) ||
    !/^kimia_test_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Refusing to connect: KIMIA_TEST_DATABASE_URL must target localhost and a database named kimia_test_*. The script never creates or drops databases.');
}

const {Pool} = await import('pg');
const pool = new Pool(postgresConfig({DATABASE_URL: connectionString, DATABASE_PASSWORD: process.env.KIMIA_TEST_DATABASE_PASSWORD}, {max: 5, application_name: 'kimia-postgres-integration-test'}));
const tempDir = await mkdtemp(path.join(tmpdir(), 'kimia-postgres-integration-'));
const uploadDir = path.join(tempDir, 'uploads');
const testId = randomUUID();
const email = `integration-${testId}@example.test`;
const slug = `integration-${testId.replaceAll('-', '')}`;
const password = randomBytes(24).toString('base64url');
let server;

async function listen(handler) {
  server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer() {
  if (!server) return;
  const active = server;
  server = null;
  await new Promise((resolve, reject) => active.close(error => error ? reject(error) : resolve()));
}

try {
  const identity = await pool.query(
    `select current_database() as database_name, current_user as role_name,
            role.rolsuper
       from pg_roles role where role.rolname=current_user`,
  );
  assert.equal(identity.rows[0]?.database_name, databaseName);
  assert.ok(identity.rows[0] && !identity.rows[0].rolsuper && identity.rows[0].role_name !== 'postgres',
    'Use a dedicated non-superuser application role.');

  const firstRun = await runMigrations(pool);
  assert.deepEqual(firstRun, [
    '001_initial_schema.sql', '002_admin_booking.sql',
    '003_booking_tracking.sql', '005_self_hosted_admin.sql',
  ]);
  assert.deepEqual(await runMigrations(pool), firstRun, 'Migrations must be safely repeatable.');
  await provisionAdmin(pool, email, password);

  const env = {
    DATABASE_URL: connectionString,
    PUBLIC_BASE_URL: 'https://kbkimiabeauty.ir',
    NODE_ENV: 'production',
  };
  const createHandler = () => createStandaloneHandler({pool, env, uploadDir});
  let base = await listen(await createHandler());
  const request = (url, options = {}) => fetch(base + url, options);
  const loginResponse = await request('/api/admin-auth/login', {
    method: 'POST',
    headers: {origin: base, 'content-type': 'application/json'},
    body: JSON.stringify({email, password}),
  });
  assert.equal(loginResponse.status, 200);
  assert.deepEqual(await loginResponse.json(), {ok: true});
  const cookie = loginResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const category = await pool.query("select id from public.service_categories where slug='nails'");
  assert.ok(category.rows[0]?.id);
  let response = await request('/api/admin/services', {
    method: 'POST',
    headers: {cookie, origin: base, 'content-type': 'application/json'},
    body: JSON.stringify({
      category_id: category.rows[0].id,
      slug,
      name_fa: 'خدمت آزمون PostgreSQL',
      description_fa: 'محتوای پایدار تست',
      details_fa: 'جزئیات آزمون',
      sort_order: 1,
      is_active: true,
    }),
  });
  assert.equal(response.status, 201);
  const serviceId = (await response.json())[0].id;
  response = await request('/api/admin/services', {
    method: 'PUT',
    headers: {cookie, origin: base, 'content-type': 'application/json'},
    body: JSON.stringify({id: serviceId, name_fa: 'خدمت ویرایش‌شده PostgreSQL'}),
  });
  assert.equal(response.status, 200);

  response = await request('/api/admin/upload', {
    method: 'POST',
    headers: {cookie, origin: base, 'content-type': 'image/webp'},
    body: await readFile(new URL('../src/assets/portrait.webp', import.meta.url)),
  });
  assert.equal(response.status, 201);
  const imageUrl = (await response.json()).image_url;
  response = await request('/api/admin/gallery_items', {
    method: 'POST',
    headers: {cookie, origin: base, 'content-type': 'application/json'},
    body: JSON.stringify({
      service_id: serviceId,
      image_url: imageUrl,
      alt_text_fa: 'تصویر آزمون PostgreSQL',
      caption_fa: 'نمونهٔ تست',
      is_published: true,
      consent_confirmed: true,
      sort_order: 1,
    }),
  });
  assert.equal(response.status, 201);
  assert.equal((await request(imageUrl)).status, 200);

  await closeServer();
  base = await listen(await createHandler());
  response = await request('/api/admin/session', {headers: {cookie}});
  assert.equal(response.status, 200, 'Database-backed session must persist across application restart.');
  assert.match(await (await request('/')).text(), /خدمت ویرایش‌شده PostgreSQL/);
  assert.equal((await request(`/services/${slug}`)).status, 200);
  assert.equal((await request(imageUrl)).status, 200, 'Published image file and metadata must survive restart.');

  response = await request('/api/admin/services', {
    method: 'PUT',
    headers: {cookie, origin: base, 'content-type': 'application/json'},
    body: JSON.stringify({id: serviceId, is_active: false}),
  });
  assert.equal(response.status, 200);
  assert.equal((await request(`/services/${slug}`)).status, 404, 'Inactive test service must not be public.');

  response = await request('/api/admin/gallery_items', {
    method: 'PUT',
    headers: {cookie, origin: base, 'content-type': 'application/json'},
    body: JSON.stringify({id: (await pool.query('select id from public.gallery_items where image_url=$1', [imageUrl])).rows[0].id, is_published: false, consent_confirmed: true}),
  });
  assert.equal(response.status, 200);
  assert.equal((await request(imageUrl)).status, 404, 'Unpublished image must become private.');
  const persisted = await pool.query('select name_fa from public.services where id=$1', [serviceId]);
  assert.equal(persisted.rows[0]?.name_fa, 'خدمت ویرایش‌شده PostgreSQL');

  response = await request('/api/admin-auth/logout', {
    method: 'POST',
    headers: {cookie, origin: base, 'content-type': 'application/json'},
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal((await request('/api/admin/session', {headers: {cookie}})).status, 401);

  console.log(`Real PostgreSQL integration test passed for ${databaseName}. Test rows remain in this disposable database; no database was created or dropped.`);
} finally {
  await closeServer();
  await pool.end();
  await rm(tempDir, {recursive: true, force: true});
}
