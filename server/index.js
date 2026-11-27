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
import {applyBusinessHours} from './business-hours.js';
import {createCustomerOtpStore} from './customer-auth-otp-store.js';
import {createCustomerOtpSendService} from './customer-auth-otp-send.js';
import {createOtpVerificationService} from './customer-auth-otp-verification.js';
import {createCustomerRegistrationService} from './customer-auth-registration.js';
import {createCustomerReferralAdminService} from './customer-referrals.js';
import {createCustomerAuthHttp, customerAuthErrorResponse} from './customer-auth-http.js';
import {cookieValue, ACCESS_COOKIE, PROOF_COOKIE, clearCustomerCookies} from './customer-auth-cookies.js';
import {findCustomerSession} from './customer-auth-session.js';
import {hashOpaqueCredential, validateOpaqueCredential} from './customer-auth-credentials.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN_HTML = await readFile(new URL('../src/admin-login.html', import.meta.url), 'utf8');
const CUSTOMER_LOGIN_HTML = await readFile(new URL('../src/customer-login.html', import.meta.url), 'utf8');
const CUSTOMER_REGISTER_HTML = await readFile(new URL('../src/customer-register.html', import.meta.url), 'utf8');
const CUSTOMER_ACCOUNT_HTML = await readFile(new URL('../src/customer-account.html', import.meta.url), 'utf8');
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

function customerAuthPage(html) {
  return new Response(html, {
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

function customerRedirect(location, env, clearCookies = false) {
  const headers = new Headers({
    location,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });
  if (clearCookies) {
    for (const cookie of clearCustomerCookies(env)) headers.append('set-cookie', cookie);
  }
  return new Response(null, {status: 302, headers});
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
  const headers = Object.fromEntries(
    [...response.headers.entries()].filter(([name]) => name !== 'set-cookie'),
  );
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : null;
  if (setCookies?.length) outgoing.setHeader('set-cookie', setCookies);
  outgoing.writeHead(response.status, headers);
  if (method === 'HEAD' || !response.body) {
    outgoing.end();
    return;
  }
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

export async function createStandaloneHandler({
  pool,
  env,
  workerModule = worker,
  uploadDir,
  allowedHosts,
  smsAdapter = null,
  hashSecret = null,
}) {
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
  const otpStore = createCustomerOtpStore({pool});
  const secretBuffer = typeof hashSecret === 'string'
    ? Buffer.from(hashSecret, 'utf8')
    : hashSecret instanceof Uint8Array
      ? Buffer.from(hashSecret)
      : typeof env.CUSTOMER_AUTH_HMAC_SECRET === 'string'
        ? Buffer.from(env.CUSTOMER_AUTH_HMAC_SECRET, 'utf8')
        : null;
  const strongSecret = secretBuffer && secretBuffer.length >= 32 ? secretBuffer : null;
  const validSmsAdapter = smsAdapter &&
    typeof smsAdapter.send === 'function';
  const sendService = strongSecret && validSmsAdapter
    ? createCustomerOtpSendService({store: otpStore, smsAdapter, hashSecret: strongSecret})
    : null;
  const verificationService = strongSecret
    ? createOtpVerificationService({pool, hashSecret: strongSecret})
    : null;
  const registrationService = createCustomerRegistrationService({pool});
  const referralAdminService = createCustomerReferralAdminService({pool});

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

      if (['/login', '/register', '/account'].includes(pathName) && method === 'GET') {
        const backendRequested = runtimeEnv.AUTH_CUSTOMER_ENABLED === 'true';
        const previewRequested = runtimeEnv.AUTH_CUSTOMER_PREVIEW_ENABLED === 'true';
        let admin = null;
        try {
          admin = await authRoutes.session(new Request(url, {headers: headersForFetch(request, ip)}));
        } catch {
          return sendWebResponse(new Response('سرویس احراز هویت در دسترس نیست.', {
            status: 503,
            headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow'},
          }), outgoing, method);
        }
        if (!backendRequested || !previewRequested || !admin) {
          return sendWebResponse(new Response('این صفحه در دسترس نیست.', {
            status: 404,
            headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow'},
          }), outgoing, method);
        }
        const forwarded = headersForFetch(request, ip);
        const pageRequest = new Request(url, {headers: forwarded});
        try {
          const accessRaw = cookieValue(pageRequest, ACCESS_COOKIE);
          const customer = await findCustomerSession(pool, accessRaw);
          if (pathName === '/login') {
            if (customer) {
              outgoing.writeHead(302, {location: '/account', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow'});
              outgoing.end();
              return;
            }
            return sendWebResponse(customerAuthPage(CUSTOMER_LOGIN_HTML), outgoing, method);
          }
          if (pathName === '/account') {
            if (!customer) {
              return sendWebResponse(customerRedirect('/login', runtimeEnv, true), outgoing, method);
            }
            return sendWebResponse(customerAuthPage(CUSTOMER_ACCOUNT_HTML), outgoing, method);
          }
          if (customer) {
            outgoing.writeHead(302, {location: '/account', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow'});
            outgoing.end();
            return;
          }
          const proofRaw = cookieValue(pageRequest, PROOF_COOKIE);
          if (!validateOpaqueCredential(proofRaw)) {
            return sendWebResponse(customerRedirect('/login', runtimeEnv, true), outgoing, method);
          }
          const proofHash = hashOpaqueCredential(proofRaw);
          const proof = await pool.query(
            `select phone_e164,(expires_at > now()) as unexpired,used_at,revoked_at
               from public.kimia_customer_registration_proofs
              where proof_hash=$1`,
            [proofHash],
          );
          const row = proof.rows[0];
          if (!row || row.used_at || row.revoked_at || !row.unexpired) {
            return sendWebResponse(customerRedirect('/login', runtimeEnv, true), outgoing, method);
          }
          return sendWebResponse(customerAuthPage(CUSTOMER_REGISTER_HTML), outgoing, method);
        } catch {
          return sendWebResponse(new Response('سرویس احراز هویت در دسترس نیست.', {
            status: 503,
            headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow'},
          }), outgoing, method);
        }
      }

      if (pathName === '/api/auth' || pathName.startsWith('/api/auth/')) {
        const readiness = async () => {
          if (!strongSecret) return {ok: false, reason: 'missing_secret'};
          if (!validSmsAdapter) return {ok: false, reason: 'missing_transport'};
          if (!sendService || !verificationService || !registrationService) {
            return {ok: false, reason: 'missing_configuration'};
          }
          try {
            const required = await pool.query(
              `select count(*)=8 as ready
                 from pg_tables
                where schemaname='public'
                  and tablename=any($1::text[])`,
              [[
                'kimia_customer_accounts',
                'kimia_customer_otp_challenges',
                'kimia_customer_registration_proofs',
                'kimia_customer_access_sessions',
                'kimia_customer_send_events',
                'kimia_referral_people',
                'kimia_customer_referrals',
                'kimia_customer_referral_history',
              ]],
            );
            if (!Boolean(required.rows[0]?.ready)) return {ok: false, reason: 'missing_schema'};
            return {ok: true};
          } catch {
            return {ok: false, state: 'outage', reason: 'outage'};
          }
        };
        const customerAuthHttp = createCustomerAuthHttp({
          pool,
          env: runtimeEnv,
          sendService,
          verificationService,
          registrationService,
          adminSession: async forwardedRequest => authRoutes.session(forwardedRequest),
          readiness,
        });
        const forwarded = headersForFetch(request, ip);
        let authBody;
        if (method === 'POST') {
          try {
            authBody = await requestBody(request, 4096);
          } catch (error) {
            if (error?.status === 413) {
              return sendWebResponse(customerAuthErrorResponse('request_too_large', 413), outgoing, method);
            }
            throw error;
          }
        }
        const authRequest = new Request(url, {
          method,
          headers: forwarded,
          ...(authBody ? {body: authBody} : {}),
        });
        const response = await customerAuthHttp.handle(authRequest);
        if (response) return sendWebResponse(response, outgoing, method);
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

      const referralApi = '/api/admin/customer-referrals';
      if (pathName === referralApi || pathName.startsWith(referralApi + '/')) {
        if (runtimeEnv.AUTH_CUSTOMER_ENABLED !== 'true' ||
            runtimeEnv.AUTH_CUSTOMER_PREVIEW_ENABLED !== 'true') {
          return sendWebResponse(responseJson({message: 'این مسیر پیدا نشد.'}, 404), outgoing, method);
        }
        if (method !== 'GET' && method !== 'PUT') {
          return sendWebResponse(new Response(JSON.stringify({
            code: 'method_not_allowed',
            message: 'روش درخواست پشتیبانی نمی‌شود.',
          }), {
            status: 405,
            headers: {'content-type': 'application/json; charset=utf-8', allow: 'GET, PUT', 'cache-control': 'no-store'},
          }), outgoing, method);
        }

        const historyMatch = pathName.match(/^\/api\/admin\/customer-referrals\/([0-9a-f-]{36})\/history$/i);
        const customerMatch = pathName.match(/^\/api\/admin\/customer-referrals\/([0-9a-f-]{36})$/i);
        if (method === 'GET' && historyMatch) {
          const result = await referralAdminService.history(historyMatch[1]);
          const status = result.ok ? 200 : result.code === 'invalid_customer' ? 400 : 503;
          return sendWebResponse(responseJson(result, status), outgoing, method);
        }
        if (method === 'GET' && pathName === referralApi) {
          const result = await referralAdminService.list(url.searchParams.get('search') || '');
          const status = result.ok ? 200 : 400;
          return sendWebResponse(responseJson(result, status), outgoing, method);
        }
        if (method === 'PUT' && customerMatch) {
          let requestOrigin;
          try {
            requestOrigin = request.headers.origin ? new URL(request.headers.origin).origin : '';
          } catch {
            requestOrigin = '';
          }
          if (requestOrigin !== origin.origin) {
            return sendWebResponse(responseJson({ok: false, code: 'invalid_origin', message: 'درخواست معتبر نیست.'}, 403), outgoing, method);
          }
          if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            return sendWebResponse(responseJson({ok: false, code: 'unsupported_media_type', message: 'درخواست باید JSON باشد.'}, 415), outgoing, method);
          }
          const bytes = await requestBody(request, 16384);
          let input;
          try {
            input = JSON.parse(bytes.toString('utf8'));
          } catch {
            return sendWebResponse(responseJson({ok: false, code: 'invalid_json', message: 'ساختار درخواست معتبر نیست.'}, 400), outgoing, method);
          }
          const result = await referralAdminService.save({
            customerId: customerMatch[1],
            actorId: session.id,
            input,
          });
          const status = result.ok ? 200
            : result.code === 'customer_not_found' ? 404
              : result.code === 'invalid_referral' ? 400
                : 503;
          return sendWebResponse(responseJson(result, status), outgoing, method);
        }
        return sendWebResponse(responseJson({ok: false, code: 'not_found', message: 'این مسیر پیدا نشد.'}, 404), outgoing, method);
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
    await applyBusinessHours(pool);
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
