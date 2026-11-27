export const ACCESS_COOKIE = 'kimia_customer_session';
export const PROOF_COOKIE = 'kimia_customer_registration';

export function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf('=');
    if (equals < 0) continue;
    const key = trimmed.slice(0, equals);
    const value = trimmed.slice(equals + 1);
    if (key === name) return value;
  }
  return null;
}

export function accessCookie(token, env, clear = false) {
  const secure = env?.NODE_ENV === 'production' ? '; Secure' : '';
  if (clear) return `${ACCESS_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
  return `${ACCESS_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=2592000`;
}

export function registrationProofCookie(token, env, clear = false) {
  const secure = env?.NODE_ENV === 'production' ? '; Secure' : '';
  if (clear) return `${PROOF_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;
  return `${PROOF_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=900`;
}

export function clearCustomerCookies(env) {
  return [accessCookie('', env, true), registrationProofCookie('', env, true)];
}
