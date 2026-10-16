// Small signed, expiring values (HMAC-SHA256) for sign-in state that must
// survive a round trip through Google or Apple without a database row.

import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto.js';

const b64 = (s) => Buffer.from(s).toString('base64url');

export function seal(payload, secret, ttlMs) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// Returns the payload, or null when the value is malformed, tampered with, or expired.
export function unseal(value, secret) {
  if (typeof value !== 'string' || value.length > 4096 || !secret) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
