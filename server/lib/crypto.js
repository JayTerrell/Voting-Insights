import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
