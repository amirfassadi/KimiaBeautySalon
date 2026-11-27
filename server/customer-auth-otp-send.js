import {normalizeCustomerPhone, validateOtpFormat} from './customer-auth-validation.js';
import {
  OTP_RESERVATION_POLICY,
  normalizeTrustedClientIp,
} from './customer-auth-otp-store.js';
import {generateOtpCode, hashCustomerOtp} from './customer-auth-otp-crypto.js';

function secretBytes(secret) {
  if (typeof secret === 'string') return Buffer.from(secret, 'utf8');
  if (secret instanceof Uint8Array) return Buffer.from(secret);
  return null;
}

function isReservationId(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}


export function createCustomerOtpSendService({
  store,
  smsAdapter,
  hashSecret,
  codeGenerator = generateOtpCode,
} = {}) {
  if (!store || typeof store.reserve !== 'function' || typeof store.revoke !== 'function') {
    return {
      async send() {
        return {ok: false, code: 'auth_unavailable'};
      },
    };
  }
  if (!smsAdapter || typeof smsAdapter.send !== 'function') {
    return {
      async send() {
        return {ok: false, code: 'auth_unavailable'};
      },
    };
  }

  const secretBuffer = secretBytes(hashSecret);
  if (!secretBuffer || secretBuffer.length < 32) {
    return {
      async send() {
        return {ok: false, code: 'auth_unavailable'};
      },
    };
  }
  if (typeof codeGenerator !== 'function') {
    return {
      async send() {
        return {ok: false, code: 'auth_unavailable'};
      },
    };
  }

  return {
    async send({phone, trustedIp, signal} = {}) {
      if (signal?.aborted) return {ok: false, code: 'sms_unavailable'};

      const phoneResult = normalizeCustomerPhone(phone);
      if (!phoneResult.ok) return {ok: false, code: 'invalid_phone'};
      if (typeof trustedIp !== 'string' || !normalizeTrustedClientIp(trustedIp)) {
        return {ok: false, code: 'invalid_ip'};
      }

      let code;
      try {
        code = codeGenerator();
      } catch {
        return {ok: false, code: 'auth_unavailable'};
      }
      const otpResult = validateOtpFormat(code);
      if (!otpResult.ok) return {ok: false, code: 'auth_unavailable'};

      const hashResult = hashCustomerOtp({
        secret: secretBuffer,
        phone: phoneResult.value,
        code: otpResult.value,
      });
      if (!hashResult.ok) return {ok: false, code: 'auth_unavailable'};

      let reservation;
      try {
        reservation = await store.reserve({
          phone: phoneResult.value,
          trustedIp,
          codeHash: hashResult.value,
        });
      } catch {
        return {ok: false, code: 'auth_unavailable'};
      }
      if (!reservation || reservation.ok !== true ||
          !isReservationId(reservation.reservation_id)) {
        if (reservation?.code === 'rate_limited') {
          const retry = Number.isInteger(reservation.retry_after_seconds)
            && reservation.retry_after_seconds > 0
            ? reservation.retry_after_seconds
            : null;
          return retry
            ? {ok: false, code: 'rate_limited', retry_after_seconds: retry}
            : {ok: false, code: 'auth_unavailable'};
        }
        return {ok: false, code: reservation?.code === 'invalid_ip' ? 'invalid_ip' :
          reservation?.code === 'invalid_phone' ? 'invalid_phone' :
          reservation?.code === 'invalid_code_hash' ? 'invalid_code_hash' :
          'auth_unavailable'};
      }

      if (signal?.aborted) {
        const revoked = await revokeReservation(store, reservation.reservation_id);
        return revoked
          ? {ok: false, code: 'sms_unavailable'}
          : {ok: false, code: 'auth_unavailable'};
      }

      let smsResult;
      try {
        smsResult = await smsAdapter.send({
          phone: phoneResult.value,
          code: otpResult.value,
          signal,
        });
      } catch {
        return await failedSend(store, reservation.reservation_id);
      }
      if (signal?.aborted) {
        return await failedSend(store, reservation.reservation_id, null);
      }
      if (smsResult &&
          smsResult.ok === true &&
          smsResult.accepted === true) {
        return {
          ok: true,
          code: 'otp_sent',
          retry_after_seconds: OTP_RESERVATION_POLICY.resendCooldownSeconds,
        };
      }
      return await failedSend(store, reservation.reservation_id, smsResult);
    },
  };
}

async function revokeReservation(store, reservationId) {
  try {
    const result = await store.revoke(reservationId);
    return result && result.ok === true && result.revoked === true;
  } catch {
    return false;
  }
}

async function failedSend(store, reservationId, smsResult) {
  const revoked = await revokeReservation(store, reservationId);
  if (!revoked) return {ok: false, code: 'auth_unavailable'};
  if (smsResult?.code === 'auth_unavailable') return {ok: false, code: 'auth_unavailable'};
  return {ok: false, code: 'sms_unavailable'};
}
