import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createStandaloneHandler} from '../server/index.js';
import {createCustomerSmsAdapter, createCustomerSmsTestTransport} from '../server/customer-auth-sms.js';
import {provisionAdmin} from '../server/bootstrap-admin.js';

const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const testAdminEmail = 'owner@example.test';
const testAdminPassword = 'a sufficiently long test password';
const tempDir = await mkdtemp(path.join(tmpdir(), 'kimia-customer-auth-browser-'));
const uploadDir = path.join(tempDir, 'uploads');
const db = new PGlite({extensions: {pgcrypto}});
let server;
let closing = false;

const pool = {
  async query(sql, values = []) {
    if (!values.length && (sql.match(/;/g) || []).length > 1) {
      await db.exec(sql);
      return {rows: []};
    }
    return db.query(sql, values);
  },
  async connect() {
    return {
      async query(sql, values = []) {
        if (/^begin$/i.test(sql.trim())) return db.query('begin');
        if (/^commit$/i.test(sql.trim())) return db.query('commit');
        if (/^rollback$/i.test(sql.trim())) return db.query('rollback');
        if (/pg_advisory_(?:xact_)?lock/i.test(sql)) return {rows: [{}]};
        if (!values.length && (sql.match(/;/g) || []).length > 1) {
          await db.exec(sql);
          return {rows: []};
        }
        return db.query(sql, values);
      },
      release() {},
    };
  },
  async end() {},
};

function isLoopbackRequest(request) {
  const host = String(request.headers.host || '').split(':')[0].toLowerCase();
  return loopbackAddresses.has(request.socket.remoteAddress) &&
    (host === '127.0.0.1' || host === 'localhost' || host === '[::1]');
}

function testResponse(response, status, contentType, body) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': contentType,
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex, nofollow',
  });
  response.end(body);
}

async function close() {
  if (closing) return;
  closing = true;
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await db.close();
  await rm(tempDir, {recursive: true, force: true});
}

try {
  await db.exec('create extension if not exists pgcrypto');
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role kimia_app nosuperuser nobypassrls;
    grant usage, create on schema public to kimia_app;
    set role kimia_app;
  `);
  for (const migration of [
    '001_initial_schema.sql',
    '002_admin_booking.sql',
    '003_booking_tracking.sql',
    '005_self_hosted_admin.sql',
    '006_customer_auth_v1.sql',
    '007_customer_referrals.sql',
  ]) {
    await db.exec(await readFile(new URL('../db/migrations/' + migration, import.meta.url), 'utf8'));
  }
  await db.exec('reset role; set role kimia_app');

  await provisionAdmin(pool, testAdminEmail, testAdminPassword);
  await db.query(
    `insert into public.kimia_customer_accounts(phone_e164,first_name,last_name)
     values ('+989311111111','مشتری','پیشین')`,
  );

  const env = {
    DATABASE_URL: 'postgresql://kimia_app@127.0.0.1/kimia_test_customer_auth_browser',
    PUBLIC_BASE_URL: 'https://kbkimiabeauty.ir',
    NODE_ENV: 'test',
    AUTH_CUSTOMER_ENABLED: 'true',
    AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
    AUTH_CUSTOMER_PUBLIC_LINKS_ENABLED: 'false',
  };
  const smsTransport = createCustomerSmsTestTransport({runtimeMode: 'test'});
  const smsAdapter = createCustomerSmsAdapter({
    transport: smsTransport,
    runtimeMode: 'test',
    timeoutMs: 1000,
  });
  const handler = await createStandaloneHandler({
    pool,
    env,
    uploadDir,
    allowedHosts: ['127.0.0.1', 'localhost'],
    smsAdapter,
    hashSecret: Buffer.from('local-browser-preview-only-secret-32-bytes'),
  });

  server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/__test/')) {
      if (!isLoopbackRequest(request)) {
        testResponse(response, 404, 'text/plain; charset=utf-8', 'Not found');
        return;
      }
      if (url.pathname === '/__test/sms-inbox' && request.method === 'GET') {
        const latest = smsTransport.getOutbox().at(-1);
        if (!latest) {
          testResponse(response, 404, 'text/plain; charset=utf-8', 'No test SMS has been sent.');
          return;
        }
        testResponse(response, 200, 'text/html; charset=utf-8',
          `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>صندوق آزمایشی SMS</title><body><main><h1>صندوق SMS محلی</h1><p>این صفحه فقط در ابزار آزمون loopback است.</p><output aria-label="کد آزمایشی">${latest.code}</output></main></body></html>`);
        return;
      }
      if (url.pathname === '/__test/expire-latest-otp' && request.method === 'POST') {
        const latest = smsTransport.getOutbox().at(-1);
        if (!latest) {
          testResponse(response, 404, 'text/plain; charset=utf-8', 'No test SMS has been sent.');
          return;
        }
        void db.query(
          `update public.kimia_customer_otp_challenges
              set expires_at=now()-interval '2 seconds',
                  created_at=now()-interval '3 seconds'
            where phone_e164=$1 and consumed_at is null and revoked_at is null`,
          [latest.phone],
        ).then(
          () => testResponse(response, 200, 'text/plain; charset=utf-8', 'Latest test OTP expired.'),
          () => testResponse(response, 500, 'text/plain; charset=utf-8', 'Test operation failed.'),
        );
        return;
      }
      testResponse(response, 404, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
    void handler(request, response);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback listener did not bind to a TCP port.');
  console.log(`Local customer-auth browser preview: http://127.0.0.1:${address.port}/admin/login`);
  console.log('Temporary administrator fixture: owner@example.test (password is in this test tool only).');
  console.log('Test-only SMS inbox: /__test/sms-inbox; expiry control: POST /__test/expire-latest-otp.');
  console.log('Bound only to 127.0.0.1. Stop with Ctrl+C; the temporary database and upload directory are removed.');

  const shutdown = () => {
    void close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error('Local customer-auth browser preview could not start.');
  await close();
  process.exitCode = 1;
}
