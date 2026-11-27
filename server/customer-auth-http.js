import {getCustomerAuthConfig} from './customer-auth-config.js';
import {
  ACCESS_COOKIE,
  PROOF_COOKIE,
  accessCookie,
  registrationProofCookie,
  clearCustomerCookies,
  cookieValue,
} from './customer-auth-cookies.js';
import {findCustomerSession} from './customer-auth-session.js';
import {hashOpaqueCredential, validateOpaqueCredential} from './customer-auth-credentials.js';

function json(body, status = 200, headers = {}) {
  const responseHeaders = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'set-cookie') continue;
    responseHeaders.set(name, value);
  }
  if (Array.isArray(headers['set-cookie'])) {
    for (const value of headers['set-cookie']) responseHeaders.append('set-cookie', value);
  } else if (typeof headers['set-cookie'] === 'string') {
    responseHeaders.append('set-cookie', headers['set-cookie']);
  }
  return new Response(JSON.stringify(body), {status, headers: responseHeaders});
}

const ERROR_MESSAGES = Object.freeze({
  auth_disabled: 'ورود مشتری در این پیش‌نمایش فعال نیست.',
  auth_unavailable: 'سرویس ورود موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.',
  account_exists: 'این شماره قبلاً ثبت شده است. برای ورود دوباره اقدام کنید.',
  invalid_json: 'اطلاعات درخواست معتبر نیست.',
  invalid_origin: 'درخواست از مبدأ معتبر ارسال نشده است.',
  invalid_otp_format: 'کد تأیید باید شش رقم باشد.',
  invalid_phone: 'شمارهٔ همراه را با قالب معتبر وارد کنید.',
  invalid_profile: 'نام و نام خانوادگی را بررسی کنید.',
  method_not_allowed: 'روش ارسال درخواست معتبر نیست.',
  not_found: 'این مسیر پیدا نشد.',
  otp_expired: 'کد تأیید منقضی شده است. کد تازه‌ای درخواست کنید.',
  otp_invalid: 'کد تأیید درست نیست.',
  otp_locked: 'تعداد تلاش‌ها به پایان رسیده است. پس از پایان زمان انتظار کد تازه‌ای درخواست کنید.',
  rate_limited: 'برای درخواست کد تازه باید کمی صبر کنید.',
  registration_expired: 'مهلت تکمیل ثبت‌نام تمام شده است. دوباره وارد شوید.',
  registration_proof_missing: 'تأیید شماره پیدا نشد. دوباره وارد شوید.',
  request_too_large: 'حجم درخواست بیش از حد مجاز است.',
  sms_unavailable: 'ارسال پیامک فعلاً در دسترس نیست. کمی بعد دوباره تلاش کنید.',
  unauthenticated: 'نشست ورود معتبر نیست. دوباره وارد شوید.',
  unsupported_media_type: 'نوع محتوای درخواست باید JSON باشد.',
});

function error(code, status, extra = {}, headers = {}) {
  return json({
    code,
    message: ERROR_MESSAGES[code] || 'عملیات انجام نشد. کمی بعد دوباره تلاش کنید.',
    retry_after_seconds: null,
    remaining_attempts: null,
    recovery_action: null,
    ...extra,
  }, status, headers);
}

export const customerAuthErrorResponse = error;

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin !== new URL(request.url).origin) return false;
  const secFetch = request.headers.get('sec-fetch-site');
  if (secFetch && !['same-origin', 'same-site', 'none'].includes(secFetch)) return false;
  if (secFetch === 'same-site' && origin !== new URL(request.url).origin) return false;
  return true;
}

async function readJson(request) {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') return {error: error('unsupported_media_type', 415)};
  const rawLength = request.headers.get('content-length');
  const length = rawLength === null ? 0 : Number(rawLength);
  if (!Number.isFinite(length) || length < 0) return {error: error('invalid_json', 400)};
  if (length > 4096) return {error: error('request_too_large', 413)};
  try {
    if (!request.body) return {error: error('invalid_json', 400)};
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return {error: error('request_too_large', 413)};
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!body || Array.isArray(body) || typeof body !== 'object') {
      return {error: error('invalid_json', 400)};
    }
    return {body};
  } catch {
    return {error: error('invalid_json', 400)};
  }
}

export function createCustomerAuthHttp({
  pool,
  env = {},
  sendService,
  verificationService,
  registrationService,
  adminSession,
  readiness,
} = {}) {
  const config = getCustomerAuthConfig(env);

  async function previewAllowed(request) {
    if (!config.requested.preview) return {state: 'absent'};
    if (!config.requested.backend) return {state: 'absent'};
    if (typeof adminSession !== 'function') return {state: 'absent'};
    try {
      const session = await adminSession(request);
      return session ? {state: 'authorized'} : {state: 'absent'};
    } catch {
      return {state: 'outage'};
    }
  }

  async function gate(request) {
    if (!config.requested.backend) return {allowed: false, response: error('auth_disabled', 404)};
    const preview = await previewAllowed(request);
    if (preview.state === 'outage') {
      return {allowed: false, response: error('auth_unavailable', 503)};
    }
    if (!config.requested.preview || preview.state !== 'authorized') {
      return {allowed: false, response: error('auth_disabled', 404)};
    }
    let ready = false;
    try {
      if (typeof readiness === 'function') {
        const result = await readiness();
        ready = result?.ok === true;
      } else {
        ready = false;
      }
    } catch {
      ready = false;
    }
    if (!ready) {
      return {allowed: false, response: error('auth_unavailable', 503)};
    }
    return {allowed: true};
  }

  return {
    async handle(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      const methods = {
        '/api/auth/status': ['GET'],
        '/api/auth/otp/send': ['POST'],
        '/api/auth/otp/verify': ['POST'],
        '/api/auth/register': ['POST'],
        '/api/auth/me': ['GET'],
        '/api/auth/logout': ['POST'],
      };
      if (Object.hasOwn(methods, path) && !methods[path].includes(request.method)) {
        return error('method_not_allowed', 405, {}, {allow: methods[path].join(', ')});
      }
      if (path === '/api/auth/status' && request.method === 'GET') {
        if (!config.requested.backend) {
          return json({enabled: false, reason: 'feature_disabled'});
        }
        if (!config.requested.preview) {
          return json({enabled: false, reason: 'missing_configuration'});
        }
        if (config.issues.length) {
          return json({enabled: false, reason: 'missing_configuration'});
        }
        const preview = await previewAllowed(request);
        if (preview.state === 'outage') return error('auth_unavailable', 503);
        if (preview.state !== 'authorized') {
          return json({enabled: false, reason: 'feature_disabled'});
        }
        let readinessResult = null;
        try {
          if (typeof readiness === 'function') {
            readinessResult = await readiness();
          } else {
            readinessResult = {ok: false, reason: 'missing_configuration'};
          }
        } catch {
          return error('auth_unavailable', 503);
        }
        if (readinessResult?.ok === true) return json({enabled: true});
        if (readinessResult?.state === 'outage' || readinessResult?.reason === 'outage') {
          return error('auth_unavailable', 503);
        }
        if (readinessResult?.reason === 'missing_configuration' ||
            readinessResult?.reason === 'missing_secret' ||
            readinessResult?.reason === 'missing_transport' ||
            readinessResult?.reason === 'missing_schema') {
          return json({enabled: false, reason: 'missing_configuration'});
        }
        if (readinessResult?.ok === false) {
          return json({enabled: false, reason: 'missing_configuration'});
        }
        return error('auth_unavailable', 503);
      }
      if (!Object.hasOwn(methods, path)) {
        return path === '/api/auth' || path.startsWith('/api/auth/')
          ? error('not_found', 404)
          : null;
      }
      if (path === '/api/auth/me' && request.method === 'GET') {
        const gated = await gate(request);
        if (!gated.allowed) return gated.response;
        const raw = cookieValue(request, ACCESS_COOKIE);
        try {
          const user = await findCustomerSession(pool, raw);
          if (!user) return error('unauthenticated', 401);
          return json({
            authenticated: true,
            first_name: user.first_name,
            last_name: user.last_name,
            phone_e164: user.phone_e164,
            marketing: user.marketing,
          });
        } catch {
          return error('auth_unavailable', 503);
        }
      }
      if (request.method !== 'POST') {
        return error('method_not_allowed', 405);
      }
      const gated = await gate(request);
      if (!gated.allowed) return gated.response;
      if (!sameOrigin(request)) return error('invalid_origin', 403);
      if (path === '/api/auth/logout') {
        const parsed = await readJson(request);
        if (parsed.error) return parsed.error;
        if (!sameOrigin(request)) return error('invalid_origin', 403);
        const accessRaw = cookieValue(request, ACCESS_COOKIE);
        const proofRaw = cookieValue(request, PROOF_COOKIE);
        let client = null;
        try {
          if (typeof pool?.connect !== 'function') throw new Error('Transactional pool required.');
          client = await pool.connect();
          await client.query('begin');
          if (validateOpaqueCredential(accessRaw)) {
            const hash = hashOpaqueCredential(accessRaw);
            await client.query(
              'update public.kimia_customer_access_sessions set revoked_at=clock_timestamp() where token_hash=$1 and revoked_at is null',
              [hash],
            );
          }
          if (validateOpaqueCredential(proofRaw)) {
            const hash = hashOpaqueCredential(proofRaw);
            await client.query(
              'update public.kimia_customer_registration_proofs set revoked_at=clock_timestamp() where proof_hash=$1 and used_at is null and revoked_at is null',
              [hash],
            );
          }
          await client.query('commit');
          return json({ok: true}, 200, {'set-cookie': clearCustomerCookies(env)});
        } catch {
          if (client) try { await client.query('rollback'); } catch {}
          return error('auth_unavailable', 503);
        } finally {
          if (client) client.release();
        }
      }
      const parsed = await readJson(request);
      if (parsed.error) return parsed.error;
      const body = parsed.body;

      if (path === '/api/auth/otp/send') {
        if (!Object.hasOwn(body, 'phone')) return error('invalid_phone', 400);
        let ip = request.headers.get('cf-connecting-ip');
        try {
          const result = await sendService.send({phone: body.phone, trustedIp: ip});
          if (result?.code === 'rate_limited') {
            const retry = result.retry_after_seconds;
            return error('rate_limited', 429, {
              retry_after_seconds: retry,
            }, {'retry-after': String(retry)});
          }
          if (result?.code === 'invalid_phone') return error('invalid_phone', 400);
          if (result?.ok === true && result.code === 'otp_sent') {
            const retry = result.retry_after_seconds;
            if (!Number.isInteger(retry) || retry <= 0) return error('auth_unavailable', 503);
            return json({ok: true, code: 'otp_sent', retry_after_seconds: retry}, 202, {
              'retry-after': String(retry),
            });
          }
          return error(result?.code === 'auth_unavailable' ? 'auth_unavailable' : 'sms_unavailable',
            result?.code === 'auth_unavailable' ? 503 : 502);
        } catch {
          return error('auth_unavailable', 503);
        }
      }

      if (path === '/api/auth/otp/verify') {
        if (!Object.hasOwn(body, 'phone') || !Object.hasOwn(body, 'code')) {
          return error('invalid_otp_format', 400);
        }
        try {
          const accessRaw = cookieValue(request, ACCESS_COOKIE);
          const proofRaw = cookieValue(request, PROOF_COOKIE);
          const previousCredentials = [];
          if (validateOpaqueCredential(accessRaw)) previousCredentials.push({type: 'access', raw: accessRaw});
          if (validateOpaqueCredential(proofRaw)) previousCredentials.push({type: 'registration', raw: proofRaw});
          const result = await verificationService.verify({
            phone: body.phone,
            code: body.code,
            previousCredentials,
          });
          if (!result?.ok) {
            if (result?.code === 'invalid_phone') return error('invalid_phone', 400);
            if (result?.code === 'invalid_otp_format') return error('invalid_otp_format', 400);
            if (result?.code === 'otp_expired') return error('otp_expired', 410);
            if (result?.code === 'otp_locked') {
              const retry = result.retry_after_seconds;
              if (!Number.isInteger(retry) || retry <= 0) return error('auth_unavailable', 503);
              return error('otp_locked', 423, {
                remaining_attempts: 0,
                retry_after_seconds: retry,
              }, {'retry-after': String(retry)});
            }
            if (result?.code === 'otp_invalid') return error('otp_invalid', 401, {
              remaining_attempts: result.remaining_attempts,
            });
            return error('auth_unavailable', 503);
          }
          if (result.credential?.type === 'registration') {
            return json(
              {is_new_user: true},
              200,
              {'set-cookie': [
                registrationProofCookie(result.credential.raw, env),
                accessCookie('', env, true),
              ]},
            );
          }
          return json(
            {is_new_user: false, authenticated: true},
            200,
            {'set-cookie': [
              accessCookie(result.credential.raw, env),
              registrationProofCookie('', env, true),
            ]},
          );
        } catch {
          return error('auth_unavailable', 503);
        }
      }

      if (path === '/api/auth/register') {
        const proof = cookieValue(request, PROOF_COOKIE);
        const accessRaw = cookieValue(request, ACCESS_COOKIE);
        const previousCredentials = [];
        if (validateOpaqueCredential(accessRaw)) previousCredentials.push({type: 'access', raw: accessRaw});
        if (validateOpaqueCredential(proof)) previousCredentials.push({type: 'registration', raw: proof});
        try {
          const result = await registrationService.register({
            profile: body,
            registrationCredential: proof,
            previousCredentials,
          });
          if (!result?.ok) {
            if (result.code === 'invalid_profile') return error('invalid_profile', 400);
            if (result.code === 'registration_proof_missing') return error('registration_proof_missing', 401);
            if (result.code === 'registration_expired') return error('registration_expired', 410);
            if (result.code === 'account_exists') return error('account_exists', 409, {
              recovery_action: 'login',
            }, {
              'set-cookie': clearCustomerCookies(env),
            });
            return error('auth_unavailable', 503);
          }
          return json(
            {ok: true, authenticated: true},
            201,
            {
              'set-cookie': [
                accessCookie(result.credential.raw, env),
                registrationProofCookie('', env, true),
              ],
            },
          );
        } catch {
          return error('auth_unavailable', 503);
        }
      }
      return null;
    },
  };
}
