import assert from 'node:assert/strict';
import pg from 'pg';
import {postgresConfig} from '../server/postgres-config.js';

const base = 'postgresql://kimia_app@127.0.0.1:5432/kimia?application_name=config-test';
for (const password of ['synthetic-password', 'literal%40@:/?# +عکس']) {
  const config = postgresConfig({DATABASE_URL: base, DATABASE_PASSWORD: password}, {max: 1});
  const client = new pg.Client(config);
  assert.equal(client.connectionParameters.password, password);
  assert.equal(client.connectionParameters.user, 'kimia_app');
  assert.equal(client.connectionParameters.database, 'kimia');
  assert.equal(client.connectionParameters.application_name, 'config-test');
  assert.equal(config.max, 1);
}
const overridden = new pg.Client(postgresConfig({DATABASE_URL: base + '&password=old', DATABASE_PASSWORD: 'new-password'}));
assert.equal(overridden.connectionParameters.password, 'new-password');
const embedded = new pg.Client(postgresConfig({DATABASE_URL: 'postgresql://app:embedded@localhost/test'}));
assert.equal(embedded.connectionParameters.password, 'embedded');
assert.throws(() => postgresConfig({DATABASE_URL: 'invalid-secret-value'}), error => !error.message.includes('invalid-secret-value'));
console.log('PostgreSQL configuration: separate password survives pg parsing, special characters round-trip, and errors do not echo the URL.');
