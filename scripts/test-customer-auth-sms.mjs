import assert from 'node:assert/strict';
import {
  createCustomerSmsAdapter,
  createCustomerSmsTestTransport,
  DEFAULT_SMS_TIMEOUT_MS,
  MAX_SMS_TIMEOUT_MS,
} from '../server/customer-auth-sms.js';

assert.equal(DEFAULT_SMS_TIMEOUT_MS, 10_000);
assert.equal(MAX_SMS_TIMEOUT_MS, 30_000);

let sent = [];
const transport = {
  async send({phone, code, signal}) {
    sent.push({phone, code, aborted: signal.aborted});
    return {accepted: true};
  },
};
const config = {transport, runtimeMode: 'production', timeoutMs: 50};
const configSnapshot = {...config};
const adapter = createCustomerSmsAdapter(config);
assert.deepEqual(await adapter.send({phone: ' ۰۹۳۰۷۸۹۷۸۲۵ ', code: '٠١٢٣٤٥'}), {
  ok: true,
  accepted: true,
});
assert.deepEqual(sent, [{phone: '+989307897825', code: '012345', aborted: false}]);
assert.deepEqual(config, configSnapshot);

let invalidSendCount = 0;
const noInvalidTransport = {
  async send() {
    invalidSendCount++;
    return {accepted: true};
  },
};
const invalidAdapter = createCustomerSmsAdapter({
  transport: noInvalidTransport,
  runtimeMode: 'test',
  timeoutMs: 50,
});
assert.deepEqual(await invalidAdapter.send({phone: '0930789782', code: '123456'}), {
  ok: false,
  code: 'invalid_phone',
});
assert.deepEqual(await invalidAdapter.send({phone: '09307897825', code: '12a456'}), {
  ok: false,
  code: 'invalid_otp_format',
});
assert.equal(invalidSendCount, 0);

assert.deepEqual(await createCustomerSmsAdapter({transport: null, runtimeMode: 'test'}).send({
  phone: '09307897825',
  code: '123456',
}), {ok: false, code: 'auth_unavailable'});

for (const acknowledgement of [null, false, undefined, {}, {accepted: false}, {accepted: 'true'}, 1]) {
  const malformed = createCustomerSmsAdapter({
    transport: {async send() { return acknowledgement; }},
    runtimeMode: 'test',
  });
  assert.deepEqual(await malformed.send({phone: '09307897825', code: '123456'}), {
    ok: false,
    code: 'sms_unavailable',
  });
}

for (const transportResult of [
  () => { throw new Error('synthetic-sms-secret'); },
  () => Promise.reject(new Error('provider-token-123')),
]) {
  const failing = createCustomerSmsAdapter({
    transport: {send: transportResult},
    runtimeMode: 'test',
    timeoutMs: 50,
  });
  const result = await failing.send({phone: '09307897825', code: '123456'});
  assert.deepEqual(result, {ok: false, code: 'sms_unavailable'});
  assert.doesNotMatch(JSON.stringify(result), /secret|token|phone|123456|provider/i);
}

let timedOutSignal = null;
const ignoringTransport = createCustomerSmsAdapter({
  transport: {
    send({signal}) {
      timedOutSignal = signal;
      return new Promise(() => {});
    },
  },
  runtimeMode: 'test',
  timeoutMs: 10,
});
const timeoutStart = Date.now();
assert.deepEqual(await ignoringTransport.send({phone: '09307897825', code: '123456'}), {
  ok: false,
  code: 'sms_unavailable',
});
assert.ok(Date.now() - timeoutStart < 500);
assert.equal(timedOutSignal.aborted, true);

const callerController = new AbortController();
callerController.abort();
const alreadyAborted = createCustomerSmsAdapter({
  transport: {
    send() {
      assert.fail('Transport must not run for an aborted caller.');
    },
  },
  runtimeMode: 'test',
  timeoutMs: 100,
});
assert.deepEqual(await alreadyAborted.send({
  phone: '09307897825',
  code: '123456',
  signal: callerController.signal,
}), {ok: false, code: 'sms_unavailable'});

let lateResolve;
const lateTransport = createCustomerSmsAdapter({
  transport: {
    send() {
      return new Promise(resolve => {
        lateResolve = resolve;
      });
    },
  },
  runtimeMode: 'test',
  timeoutMs: 5,
});
const lateResult = await lateTransport.send({phone: '09307897825', code: '123456'});
assert.deepEqual(lateResult, {ok: false, code: 'sms_unavailable'});
lateResolve({accepted: true});
await Promise.resolve();

let lateReject;
const rejectionTransport = createCustomerSmsAdapter({
  transport: {
    send() {
      return new Promise((resolve, reject) => {
        lateReject = reject;
      });
    },
  },
  runtimeMode: 'test',
  timeoutMs: 5,
});
assert.deepEqual(await rejectionTransport.send({phone: '09307897825', code: '123456'}), {
  ok: false,
  code: 'sms_unavailable',
});
lateReject(new Error('late-secret'));
await Promise.resolve();

let clears = 0;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback, delay) => originalSetTimeout(callback, delay);
globalThis.clearTimeout = handle => {
  clears++;
  return originalClearTimeout(handle);
};
try {
  const timerAdapter = createCustomerSmsAdapter({
    transport: {async send() { return {accepted: true}; }},
    runtimeMode: 'test',
    timeoutMs: 100,
  });
  assert.deepEqual(await timerAdapter.send({phone: '09307897825', code: '123456'}), {
    ok: true,
    accepted: true,
  });
  assert.ok(clears >= 1);
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

for (const runtimeMode of [undefined, 'production', 'unknown', '']) {
  assert.throws(
    () => createCustomerSmsTestTransport({runtimeMode}),
    /test or development mode/,
  );
}
for (const runtimeMode of ['test', 'development']) {
  const testTransport = createCustomerSmsTestTransport({runtimeMode});
  const testAdapter = createCustomerSmsAdapter({
    transport: testTransport,
    runtimeMode,
    timeoutMs: 50,
  });
  assert.deepEqual(await testAdapter.send({phone: '09307897825', code: '123456'}), {
    ok: true,
    accepted: true,
  });
  assert.deepEqual(testTransport.getOutbox(), [{
    phone: '+989307897825',
    code: '123456',
  }]);
}
const testTransportForProduction = createCustomerSmsTestTransport({runtimeMode: 'test'});
assert.deepEqual(createCustomerSmsAdapter({
  transport: testTransportForProduction,
  runtimeMode: 'production',
}).send({phone: '09307897825', code: '123456'}).constructor.name, 'Promise');
assert.deepEqual(await createCustomerSmsAdapter({
  transport: testTransportForProduction,
  runtimeMode: 'production',
}).send({phone: '09307897825', code: '123456'}), {
  ok: false,
  code: 'auth_unavailable',
});
assert.deepEqual(testTransportForProduction.getOutbox(), []);

const invalidTimeoutAdapter = createCustomerSmsAdapter({
  transport: {async send() { return {accepted: true}; }},
  runtimeMode: 'test',
  timeoutMs: Infinity,
});
assert.deepEqual(await invalidTimeoutAdapter.send({phone: '09307897825', code: '123456'}), {
  ok: false,
  code: 'auth_unavailable',
});

const envSnapshot = JSON.stringify(process.env);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('SMS test must not make external requests');
};
try {
  const transportWithoutFallback = createCustomerSmsAdapter({
    transport: null,
    runtimeMode: 'production',
  });
  assert.deepEqual(await transportWithoutFallback.send({phone: '09307897825', code: '123456'}), {
    ok: false,
    code: 'auth_unavailable',
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(JSON.stringify(process.env), envSnapshot);

console.log('Customer SMS adapter passed: validation, acceptance, failure, timeout, test-mode guards and no I/O fallback.');
