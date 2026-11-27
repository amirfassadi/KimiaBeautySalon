import {
  normalizeCustomerPhone,
  validateOtpFormat,
} from './customer-auth-validation.js';

export const DEFAULT_SMS_TIMEOUT_MS = 10_000;
export const MAX_SMS_TIMEOUT_MS = 30_000;

function unavailable(code = 'sms_unavailable') {
  return {ok: false, code};
}

function normalizeTimeout(timeoutMs) {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 || timeoutMs > MAX_SMS_TIMEOUT_MS) {
    return null;
  }
  return timeoutMs;
}

export function createCustomerSmsAdapter({
  transport = null,
  runtimeMode = 'production',
  timeoutMs = DEFAULT_SMS_TIMEOUT_MS,
} = {}) {
  const timeout = normalizeTimeout(timeoutMs);

  return {
    async send({phone, code, signal} = {}) {
      const phoneResult = normalizeCustomerPhone(phone);
      if (!phoneResult.ok) return unavailable(phoneResult.code);
      const otpResult = validateOtpFormat(code);
      if (!otpResult.ok) return unavailable(otpResult.code);
      if (!transport || typeof transport.send !== 'function') {
        return unavailable('auth_unavailable');
      }
      if (transport.__customerSmsTestTransport === true &&
          !['test', 'development'].includes(runtimeMode)) {
        return unavailable('auth_unavailable');
      }
      if (!timeout) return unavailable('auth_unavailable');

      const controller = new AbortController();
      let externalSignal = signal;
      let settled = false;
      let timer = null;
      return await new Promise(resolve => {
        const finish = result => {
          if (settled) return;
          settled = true;
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          if (externalSignal?.removeEventListener) {
            externalSignal.removeEventListener('abort', abortExternal);
          }
          resolve(result);
        };

        const abortExternal = () => {
          controller.abort();
          finish(unavailable());
        };
        if (externalSignal?.addEventListener) {
          externalSignal.addEventListener('abort', abortExternal, {once: true});
        }
        if (externalSignal?.aborted) {
          abortExternal();
          return;
        }

        timer = setTimeout(() => {
          controller.abort();
          finish(unavailable());
        }, timeout);

        if (controller.signal.aborted) {
          finish(unavailable());
          return;
        }

        let transportPromise;
        try {
          transportPromise = Promise.resolve(transport.send({
            phone: phoneResult.value,
            code: otpResult.value,
            signal: controller.signal,
          }));
        } catch {
          finish(unavailable());
          return;
        }

        transportPromise.then(acknowledgement => {
          if (acknowledgement &&
              typeof acknowledgement === 'object' &&
              acknowledgement.accepted === true) {
            finish({ok: true, accepted: true});
          } else {
            finish(unavailable());
          }
        }).catch(() => {
          finish(unavailable());
        });
      });
    },
  };
}

export function createCustomerSmsTestTransport({runtimeMode} = {}) {
  if (!['test', 'development'].includes(runtimeMode)) {
    throw new Error('Test SMS transport requires test or development mode.');
  }

  const outbox = [];
  return {
    __customerSmsTestTransport: true,
    runtimeMode,
    async send({phone, code, signal}) {
      if (!['test', 'development'].includes(runtimeMode)) {
        throw new Error('Test SMS transport is not permitted.');
      }
      if (signal?.aborted) return {accepted: false};
      outbox.push({phone, code});
      return {accepted: true};
    },
    getOutbox() {
      return outbox.map(entry => ({...entry}));
    },
  };
}
