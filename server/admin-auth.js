import {createHash, randomBytes} from 'node:crypto';
import {verifyPassword} from './passwords.js';

const SESSION_COOKIE = 'kimia_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_FAILED_LOGINS = 5;
const MAX_LOGIN_ATTEMPTS = MAX_FAILED_LOGINS + 1;

const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers},
});

function secureCookie(env) {
  return env.NODE_ENV === 'production' ? '; Secure' : '';
}

function sessionCookie(token, env, clear = false) {
  return `${SESSION_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax${secureCookie(env)}; Max-Age=${clear ? 0 : SESSION_SECONDS}`;
}

function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

function sameOriginMutation(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      request.headers.get('sec-fetch-site') === 'cross-site') return false;
  return true;
}

async function parseLoginBody(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return null;
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return null;
  let body;
  try { body = await request.json(); } catch { return null; }
  if (!body || Array.isArray(body) || typeof body !== 'object') return null;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length > 1024) return null;
  return {email, password};
}

export async function createAdminSession(pool, adminId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  await pool.query(
    'insert into public.kimia_admin_sessions(token_hash, admin_id, expires_at) values ($1,$2,now()+($3 * interval \'1 second\'))',
    [tokenHash, adminId, SESSION_SECONDS],
  );
  return token;
}

export async function findAdminSession(pool, token) {
  if (!token || token.length > 128) return null;
  const result = await pool.query(
    `select a.id, a.email
       from public.kimia_admin_sessions s
       join public.kimia_admins a on a.id=s.admin_id
      where s.token_hash=$1 and s.expires_at > now() and a.disabled_at is null`,
    [sha256(token)],
  );
  return result.rows[0] || null;
}

export async function revokeAdminSession(pool, token) {
  if (token) await pool.query('delete from public.kimia_admin_sessions where token_hash=$1', [sha256(token)]);
}

async function reserveLoginAttempt(pool, keyHash) {
  const result = await pool.query(
    `insert into public.kimia_admin_login_limits(key_hash,window_started_at,failed_attempts)
     values($1,now(),1)
     on conflict(key_hash) do update set
       failed_attempts=case when kimia_admin_login_limits.window_started_at <= now()-($2 * interval '1 minute')
                            then 1 else least(kimia_admin_login_limits.failed_attempts+1,$3) end,
       window_started_at=case when kimia_admin_login_limits.window_started_at <= now()-($2 * interval '1 minute')
                              then now() else kimia_admin_login_limits.window_started_at end
     returning failed_attempts`,
    [keyHash, LOGIN_WINDOW_MINUTES, MAX_LOGIN_ATTEMPTS],
  );
  return result.rows[0].failed_attempts > MAX_FAILED_LOGINS;
}

async function login(request, env, pool, ip) {
  if (!sameOriginMutation(request)) return json({message: 'درخواست معتبر نیست.'}, 403);
  const credentials = await parseLoginBody(request);
  if (!credentials) return json({message: 'ایمیل یا گذرواژه معتبر نیست.'}, 400);
  const attemptKey = sha256(`${ip}\n${credentials.email}`);
  if (await reserveLoginAttempt(pool, attemptKey)) return json({message: 'تلاش‌های ورود بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'}, 429);

  const adminResult = await pool.query(
    'select id,email,password_hash from public.kimia_admins where lower(email)=$1 and disabled_at is null',
    [credentials.email],
  );
  const admin = adminResult.rows[0];
  const valid = await verifyPassword(credentials.password, admin?.password_hash);
  if (!admin || !valid) {
    return json({message: 'ایمیل یا گذرواژه اشتباه است.'}, 401);
  }

  await pool.query('delete from public.kimia_admin_login_limits where key_hash=$1', [attemptKey]);
  const token = await createAdminSession(pool, admin.id);
  return json({ok: true}, 200, {'set-cookie': sessionCookie(token, env)});
}

async function logout(request, env, pool) {
  if (!sameOriginMutation(request)) return json({message: 'درخواست معتبر نیست.'}, 403);
  await revokeAdminSession(pool, cookieValue(request, SESSION_COOKIE));
  return json({ok: true}, 200, {'set-cookie': sessionCookie('', env, true)});
}

export function adminAuthRoutes({env, pool, ip}) {
  return {
    async handle(request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/admin-auth/login' && request.method === 'POST') return login(request, env, pool, ip);
      if (path === '/api/admin-auth/logout' && request.method === 'POST') return logout(request, env, pool);
      return null;
    },
    async session(request) {
      return findAdminSession(pool, cookieValue(request, SESSION_COOKIE));
    },
  };
}

export const authInternals = {cookieValue, sameOriginMutation, sessionCookie, sha256};
