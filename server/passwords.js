import {randomBytes, scrypt as callbackScrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(callbackScrypt);
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const validFormat = parts.length === 6 && parts[0] === 'scrypt' &&
    parts[1] === String(COST) && parts[2] === String(BLOCK_SIZE) && parts[3] === String(PARALLELISM);
  const salt = validFormat ? Buffer.from(parts[4], 'base64url') : Buffer.alloc(16, 0x5a);
  const expected = validFormat ? Buffer.from(parts[5], 'base64url') : Buffer.alloc(KEY_BYTES, 0xa5);
  const actual = await scrypt(password, salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });
  return validFormat && expected.length === actual.length && timingSafeEqual(expected, actual);
}
