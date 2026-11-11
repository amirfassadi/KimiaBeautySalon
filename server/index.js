import {createServer} from 'node:http';
import {constants} from 'node:fs';
import {mkdir, open, readFile, realpath} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import worker from '../dist/server/index.js';
import {adminAuthRoutes} from './admin-auth.js';
import {createPostgresAdapter} from './postgres-adapter.js';
import {postgresConfig} from './postgres-config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN_HTML = await readFile(new URL('../src/admin-login.html', import.meta.url), 'utf8');
const IMAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
const MIME_TYPES = Object.freeze({jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp'});
const loopback = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

function responseJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}

function loginPage() {
  return new Response(LOGIN_HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

function getOrigin(request, env) {
  const host = String(request.headers.host || '').toLowerCase();
  const allowedHosts = env.ALLOWED_HOSTS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!host || !allowedHosts.includes(host.split(':')[0])) return null;
  const trusted = loopback(request.socket.remoteAddress);
  const forwardedProto = trusted ? request.headers['x-forwarded-proto'] : null;
  const protocol = forwardedProto === 'https' || request.socket.encrypted ? 'https:' : 'http:';
  return {host, protocol, origin: `${protocol}//${host}`, trusted};
}

function clientIp(request, trustedProxy) {
  if (trustedProxy && loopback(request.socket.remoteAddress)) {
    const forwarded = request.headers['x-real-ip'];
    if (typeof forwarded === 'string' && net.isIP(forwarded)) return forwarded;
  }
  const remote = request.socket.remoteAddress;
  return remote === '::ffff:127.0.0.1' ? '127.0.0.1' : remote || 'unknown';
}

async function requestBody(request, limit) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > limit) {
    request.resume();
    throw Object.assign(new Error('Request body too large.'), {status: 413});
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) {
      request.resume();
      throw Object.assign(new Error('Request body too large.'), {status: 413});
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

function headersForFetch(request, ip) {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(request.headers)) {
    if (rawValue === undefined || name === 'oai-authenticated-user-id' || name === 'oai-authenticated-user-email' ||
        name === 'cf-connecting-ip' || name === 'x-kimia-admin-id' || name === 'x-kimia-admin-email') continue;
    headers.set(name, Array.isArray(rawValue) ? rawValue.join(', ') : rawValue);
  }
  headers.set('cf-connecting-ip', ip);
  return headers;
}

function createDiskBucket(root) {
  const absoluteRoot = path.resolve(root);
  const resolveKey = key => {
    if (typeof key !== 'string' || !IMAGE_KEY.test(key)) throw new Error('Invalid image key.');
    const file = path.resolve(absoluteRoot, key);
    if (path.dirname(file) !== absoluteRoot) throw new Error('Invalid image path.');
    return file;
  };
  return {
    async put(key, value) {
      const file = resolveKey(key);
      const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
      try { await handle.writeFile(value); } finally { await handle.close(); }
    },
    async get(key) {
      const file = resolveKey(key);
      try {
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return null;
          return {body: await handle.readFile(), httpMetadata: {contentType: MIME_TYPES[path.extname(key).slice(1)]}};
        } finally { await handle.close(); }
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ELOOP') return null;
        throw error;
      }
    },
  };
}

async function sendWebResponse(response, outgoing, method) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (method === 'HEAD' || !response.body) {
    outgoing.end();
    return;
  }
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

export async function createStandaloneHandler({pool, env, workerModule = worker, uploadDir, allowedHosts}) {
  if (!pool || !env?.DATABASE_URL) throw new Error('A PostgreSQL pool and DATABASE_URL are required.');
  if (!path.isAbsolute(uploadDir || '')) throw new Error('UPLOAD_DIR must be an absolute path outside the application release.');
  const absoluteUploadDir = await mkdir(uploadDir, {recursive: true, mode: 0o750}).then(() => realpath(uploadDir));
  const relativeUpload = path.relative(ROOT, absoluteUploadDir);
  if (!relativeUpload.startsWith('..') && !path.isAbsolute(relativeUpload)) {
    throw new Error('UPLOAD_DIR must be outside the application repository/release.');
  }
  const publicUrl = new URL(env.PUBLIC_BASE_URL);
  if (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error('PUBLIC_BASE_URL must be an HTTPS origin.');
  }
  const allowed = allowedHosts || [publicUrl.hostname, `www.${publicUrl.hostname}`, 'localhost', '127.0.0.1'];
  const runtimeEnv = {
    ...env,
    SELF_HOSTED: true,
    PUBLIC_BASE_URL: publicUrl.origin,
    SELF_HOSTED_BASE_URL: publicUrl.origin,
    ALLOWED_HOSTS: allowed.join(','),
    DB_ADAPTER: createPostgresAdapter(pool),
    BUCKET: createDiskBucket(absoluteUploadDir),
  };
  const makeAuth = ip => adminAuthRoutes({env: runtimeEnv, pool, ip});

  return async function handle(request, outgoing) {
    const requestId = crypto.randomUUID();
    let method = request.method.toUpperCase();
    try {
      const origin = getOrigin(request, runtimeEnv);
      if (!origin) return sendWebResponse(responseJson({message: 'درخواست معتبر نیست.'}, 400), outgoing, method);
      const url = new URL(request.url, origin.origin);
      if (url.origin !== origin.origin) return sendWebResponse(responseJson({message: 'درخواست معتبر نیست.'}, 400), outgoing, method);
      const pathName = url.pathname;
      if (origin.host.split(':')[0] === `www.${publicUrl.hostname}`) {
        outgoing.writeHead(308, {location: `https://${publicUrl.hostname}${url.pathname}${url.search}`, 'cache-control': 'no-store'});
        outgoing.end();
        return;
      }

      if (pathName === '/api/health' && method === 'GET') {
        try {
          await pool.query('select 1');
          const migrations = await pool.query(
            `select count(*)=4 as ready from public.kimia_schema_migrations
             where version = any($1::text[])`,
            [['001_initial_schema.sql', '002_admin_booking.sql', '003_booking_tracking.sql', '005_self_hosted_admin.sql']],
          );
          const ready = Boolean(migrations.rows[0]?.ready);
          return sendWebResponse(responseJson({ok: ready, database_ready: ready, booking_enabled: false, customer_auth_enabled: false}, ready ? 200 : 503), outgoing, method);
        } catch {
          return sendWebResponse(responseJson({ok: false, database_ready: false, booking_enabled: false, customer_auth_enabled: false}, 503), outgoing, method);
        }
      }

      const ip = clientIp(request, origin.trusted);
      const authRoutes = makeAuth(ip);
      if (pathName === '/api/admin-auth/login' || pathName === '/api/admin-auth/logout') {
        const bytes = await requestBody(request, 4096);
        const forwarded = headersForFetch(request, ip);
        const authRequest = new Request(url, {method, headers: forwarded, ...(method === 'GET' || method === 'HEAD' ? {} : {body: bytes})});
        const response = await authRoutes.handle(authRequest);
        return sendWebResponse(response || responseJson({message: 'این مسیر پیدا نشد.'}, 404), outgoing, method);
      }

      if (pathName === '/admin/login' && method === 'GET') {
        const session = await authRoutes.session(new Request(url, {headers: headersForFetch(request, ip)}));
        if (session) {
          outgoing.writeHead(303, {location: '/admin', 'cache-control': 'no-store'});
          outgoing.end();
          return;
        }
        return sendWebResponse(loginPage(), outgoing, method);
      }

      if (pathName.startsWith('/api/auth/') && pathName !== '/api/auth/status') {
        return sendWebResponse(responseJson({message: 'این قابلیت فعال نیست.'}, 404), outgoing, method);
      }
      if (pathName === '/api/bookings' || pathName === '/api/bookings/lookup') {
        return sendWebResponse(responseJson({message: 'نوبت‌دهی آنلاین فعال نیست.'}, 404), outgoing, method);
      }

      const adminApi = pathName === '/api/admin' || pathName.startsWith('/api/admin/');
      const adminPage = pathName === '/admin' || pathName === '/admin/';
      const uploadResource = pathName.startsWith('/uploads/');
      let session = null;
      if (adminApi || adminPage || uploadResource) {
        session = await authRoutes.session(new Request(url, {headers: headersForFetch(request, ip)}));
        if (!session && (adminApi || adminPage)) {
          if (adminPage && method === 'GET') {
            outgoing.writeHead(302, {location: '/admin/login', 'cache-control': 'no-store', 'x-robots-tag': 'noindex'});
            outgoing.end();
          } else {
            await sendWebResponse(responseJson({message: 'برای ادامه وارد حساب مدیریت شوید.'}, 401), outgoing, method);
          }
          return;
        }
      }

      const limit = pathName === '/api/admin/upload' ? 5 * 1024 * 1024 : 64 * 1024;
      const bytes = method === 'GET' || method === 'HEAD' ? undefined : await requestBody(request, limit);
      const headers = headersForFetch(request, ip);
      if (session) {
        headers.set('oai-authenticated-user-id', session.id);
        headers.set('oai-authenticated-user-email', session.email);
      }
      const body = bytes?.length ? new Uint8Array(bytes) : undefined;
      const workerRequest = new Request(url, {method, headers, ...(body ? {body} : {})});
      const requestEnv = {
        ...runtimeEnv,
        ADMIN_USER_IDS: session?.id || '',
        ADMIN_EMAILS: session?.email || '',
      };
      const response = await workerModule.fetch(workerRequest, requestEnv);
      return sendWebResponse(response || responseJson({message: 'این مسیر پیدا نشد.'}, 404), outgoing, method);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      console.error(JSON.stringify({event: 'request_failed', request_id: requestId, status, error_code: error?.code || error?.name || 'unknown'}));
      return sendWebResponse(responseJson({message: status === 413 ? 'حجم درخواست بیش از حد مجاز است.' : 'عملیات انجام نشد.'}, status), outgoing, method);
    }
  };
}

function validateRuntimeConfig(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!env.UPLOAD_DIR || !path.isAbsolute(env.UPLOAD_DIR)) throw new Error('UPLOAD_DIR must be an absolute persistent path.');
  if (env.PUBLIC_BASE_URL !== 'https://kbkimiabeauty.ir') throw new Error('PUBLIC_BASE_URL must be https://kbkimiabeauty.ir.');
  if (env.HOST !== '127.0.0.1') throw new Error('HOST must remain 127.0.0.1; expose the service through Nginx only.');
  const port = Number(env.PORT || 3018);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  return port;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = validateRuntimeConfig(process.env);
    const pool = new Pool(postgresConfig(process.env, {max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, application_name: 'kimia-web'}));
    const role = await pool.query('select current_user as role_name, rolsuper from pg_roles where rolname=current_user');
    if (!role.rows[0] || role.rows[0].rolsuper || role.rows[0].role_name === 'postgres') {
      throw new Error('The application database role must be dedicated and non-superuser.');
    }
    const handler = await createStandaloneHandler({pool, env: process.env, uploadDir: process.env.UPLOAD_DIR});
    const server = createServer(handler);
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.keepAliveTimeout = 5000;
    server.listen(port, '127.0.0.1', () => console.log(`Kimia self-hosted server listening on 127.0.0.1:${port}`));
    const shutdown = async () => {
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch {
    console.error('Kimia server could not start. Verify runtime configuration and persistent storage permissions.');
    process.exitCode = 1;
  }
}
