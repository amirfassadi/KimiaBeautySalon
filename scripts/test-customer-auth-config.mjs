import assert from 'node:assert/strict';
import {getCustomerAuthConfig, customerAuthGateNames} from '../server/customer-auth-config.js';

assert.deepEqual(customerAuthGateNames, {
  backend: 'AUTH_CUSTOMER_ENABLED',
  preview: 'AUTH_CUSTOMER_PREVIEW_ENABLED',
  publicLinks: 'AUTH_CUSTOMER_PUBLIC_LINKS_ENABLED',
});

const missing = getCustomerAuthConfig({});
assert.deepEqual(missing, {
  requested: {backend: false, preview: false, publicLinks: false},
  issues: [],
});

const explicitFalse = getCustomerAuthConfig({
  AUTH_CUSTOMER_ENABLED: 'false',
  AUTH_CUSTOMER_PREVIEW_ENABLED: 'false',
  AUTH_CUSTOMER_PUBLIC_LINKS_ENABLED: 'false',
});
assert.deepEqual(explicitFalse.requested, {backend: false, preview: false, publicLinks: false});
assert.deepEqual(explicitFalse.issues, []);

for (const malformed of ['TRUE', '1', 'yes', ' enabled ', true, false, 1, []]) {
  const result = getCustomerAuthConfig({
    AUTH_CUSTOMER_ENABLED: malformed,
  });
  assert.equal(result.requested.backend, false);
  assert.deepEqual(result.issues, [{
    variable: 'AUTH_CUSTOMER_ENABLED',
    code: 'invalid_boolean',
  }]);
}

const allRequested = getCustomerAuthConfig({
  AUTH_CUSTOMER_ENABLED: 'true',
  AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
  AUTH_CUSTOMER_PUBLIC_LINKS_ENABLED: 'true',
});
assert.deepEqual(allRequested.requested, {backend: true, preview: true, publicLinks: true});
assert.deepEqual(allRequested.issues, []);

const previewOnly = getCustomerAuthConfig({
  AUTH_CUSTOMER_PREVIEW_ENABLED: 'true',
});
assert.deepEqual(previewOnly.requested, {backend: false, preview: true, publicLinks: false});

const linksOnly = getCustomerAuthConfig({
  AUTH_CUSTOMER_PUBLIC_LINKS_ENABLED: 'true',
});
assert.deepEqual(linksOnly.requested, {backend: false, preview: false, publicLinks: true});

const env = {
  AUTH_CUSTOMER_ENABLED: 'true',
  AUTH_SMS_URL: 'https://sms.example.test/secret',
  AUTH_SMS_TOKEN: 'synthetic-sms-secret',
  DATABASE_URL: 'postgresql://user:synthetic-database-secret@localhost/kimia',
  DATABASE_PASSWORD: 'synthetic-database-password',
};
const original = {...env};
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('configuration parsing must not make HTTP requests');
};
try {
  const noSecrets = getCustomerAuthConfig(env);
  assert.deepEqual(env, original);
  const serialized = JSON.stringify(noSecrets);
  assert.doesNotMatch(serialized, /sms|database|secret|@|https?:/i);
  assert.deepEqual(noSecrets.requested, {backend: true, preview: false, publicLinks: false});
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Customer auth configuration: strict fail-closed parsing, independent gates, no secret exposure, and no I/O side effects.');
