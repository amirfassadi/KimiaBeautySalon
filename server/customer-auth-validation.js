const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function asciiDigits(value) {
  return value.replace(/[۰-۹٠-٩]/g, digit => {
    let index = PERSIAN_DIGITS.indexOf(digit);
    if (index >= 0) return String(index);
    index = ARABIC_DIGITS.indexOf(digit);
    return index >= 0 ? String(index) : digit;
  });
}

export function normalizeCustomerPhone(input) {
  if (typeof input !== 'string') return {ok: false, code: 'invalid_phone'};
  const phone = asciiDigits(input.trim());
  let canonical = null;
  if (/^09[0-9]{9}$/.test(phone)) canonical = '+98' + phone.slice(1);
  else if (/^\+989[0-9]{9}$/.test(phone)) canonical = phone;
  else if (/^00989[0-9]{9}$/.test(phone)) canonical = '+' + phone.slice(2);
  else if (/^989[0-9]{9}$/.test(phone)) canonical = '+' + phone;
  return canonical ? {ok: true, value: canonical} : {ok: false, code: 'invalid_phone'};
}

export const normalizeIranianPhone = normalizeCustomerPhone;

export function validateOtpFormat(input) {
  if (typeof input !== 'string') return {ok: false, code: 'invalid_otp_format'};
  const otp = asciiDigits(input.trim());
  return /^[0-9]{6}$/.test(otp)
    ? {ok: true, value: otp}
    : {ok: false, code: 'invalid_otp_format'};
}

export const normalizeCustomerOtp = validateOtpFormat;

function isPlainObject(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function validateName(value, maximum) {
  if (typeof value !== 'string') return null;
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const length = Array.from(normalized).length;
  return length >= 2 && length <= maximum ? normalized : null;
}

const DISCOVERY_CHANNELS = new Set([
  'not_reported',
  'unknown',
  'personal_referral',
  'instagram',
  'search',
  'walk_in',
  'other',
]);

function validateReferralDeclaration(input) {
  const value = input === undefined
    ? {status: 'not_reported'}
    : input;
  if (!isPlainObject(value) ||
      Object.keys(value).some(key => !['status', 'kind', 'value'].includes(key))) return null;
  const status = value.status === undefined ? 'not_reported' : value.status;
  if (!['not_reported', 'unknown', 'none', 'pending'].includes(status)) return null;
  if (status !== 'pending') {
    if (Object.hasOwn(value, 'kind') || Object.hasOwn(value, 'value')) return null;
    return {status, kind: null, value: null};
  }
  if (!['name', 'code'].includes(value.kind) ||
      typeof value.value !== 'string' ||
      /[\p{Cc}\u2028\u2029]/u.test(value.value)) return null;
  const declaration = value.value.trim();
  const length = Array.from(declaration).length;
  if (length < 2 || length > 120) return null;
  return {status, kind: value.kind, value: declaration};
}

function validateCustomerReferral(input) {
  if (input === undefined) {
    return {
      discovery_channel: 'not_reported',
      same_referrer: false,
      site_referrer: {status: 'not_reported', kind: null, value: null},
      salon_referrer: {status: 'not_reported', kind: null, value: null},
    };
  }
  if (!isPlainObject(input) ||
      Object.keys(input).some(key =>
        !['discovery_channel', 'same_referrer', 'site_referrer', 'salon_referrer'].includes(key))) {
    return null;
  }
  const discoveryChannel = input.discovery_channel === undefined
    ? 'not_reported'
    : input.discovery_channel;
  if (!DISCOVERY_CHANNELS.has(discoveryChannel)) return null;
  const sameReferrer = input.same_referrer === undefined ? false : input.same_referrer;
  if (typeof sameReferrer !== 'boolean') return null;
  const siteReferrer = validateReferralDeclaration(input.site_referrer);
  const salonReferrer = validateReferralDeclaration(input.salon_referrer);
  if (!siteReferrer || !salonReferrer) return null;
  if (sameReferrer &&
      (siteReferrer.status !== salonReferrer.status ||
       siteReferrer.kind !== salonReferrer.kind ||
       siteReferrer.value !== salonReferrer.value)) return null;
  return {
    discovery_channel: discoveryChannel,
    same_referrer: sameReferrer,
    site_referrer: siteReferrer,
    salon_referrer: salonReferrer,
  };
}

export function validateCustomerProfile(input) {
  try {
    if (!isPlainObject(input)) return {ok: false, code: 'invalid_profile'};
    for (const key of Object.keys(input)) {
      if (!['first_name', 'last_name', 'marketing', 'referral'].includes(key)) {
        return {ok: false, code: 'invalid_profile'};
      }
    }
    const firstName = validateName(input.first_name, 80);
    const lastName = validateName(input.last_name, 100);
    if (!firstName || !lastName) return {ok: false, code: 'invalid_profile'};

    const marketing = Object.hasOwn(input, 'marketing') ? input.marketing : false;
    if (typeof marketing !== 'boolean') return {ok: false, code: 'invalid_profile'};
    const referral = validateCustomerReferral(input.referral);
    if (!referral) return {ok: false, code: 'invalid_profile'};

    return {
      ok: true,
      value: {
        first_name: firstName,
        last_name: lastName,
        marketing,
        referral,
      },
    };
  } catch {
    return {ok: false, code: 'invalid_profile'};
  }
}
