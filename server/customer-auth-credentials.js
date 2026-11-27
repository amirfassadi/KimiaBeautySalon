import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export function generateOpaqueCredential() {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueCredential(raw) {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  return createHash('sha256').update(raw, 'ascii').digest('hex');
}

export function validateOpaqueCredential(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{43}$/.test(raw);
}

export function constantTimeHexEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' ||
      left.length !== right.length || !/^[a-f0-9]+$/.test(left) ||
      !/^[a-f0-9]+$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'ascii'), Buffer.from(right, 'ascii'));
}
