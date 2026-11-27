import {createHmac, randomInt} from 'node:crypto';

export const OTP_HMAC_DOMAIN = 'kimia-customer-otp-v1';

function secretBytes(secret) {
  if (typeof secret === 'string') return Buffer.from(secret, 'utf8');
  if (secret instanceof Uint8Array) return Buffer.from(secret);
  return null;
}

export function generateOtpCode(randomIntImpl = randomInt) {
  if (typeof randomIntImpl !== 'function') throw new Error('OTP random generator is required.');
  const value = randomIntImpl(0, 1_000_000);
  if (!Number.isInteger(value) || value < 0 || value >= 1_000_000) {
    throw new Error('OTP random generator produced an invalid value.');
  }
  return String(value).padStart(6, '0');
}

export function hashCustomerOtp({secret, phone, code}) {
  const secretBuffer = secretBytes(secret);
  if (!secretBuffer || secretBuffer.length < 32 ||
      typeof phone !== 'string' || !/^\+989[0-9]{9}$/.test(phone) ||
      typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
    return {ok: false, code: 'invalid_otp_hash_input'};
  }
  const message = Buffer.from(`${OTP_HMAC_DOMAIN}\nphone=${phone}\ncode=${code}`, 'utf8');
  return {
    ok: true,
    value: createHmac('sha256', secretBuffer).update(message).digest('hex'),
  };
}
