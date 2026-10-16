import { hit } from '../db/repositories/rate-limits.js';
import { sha256 } from '../lib/crypto.js';

const tooMany = (res, windowMs) => {
  res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
  res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
};

// Limits each client IP to `max` requests per window for one route family.
export const rateLimit = (name, max, windowMs) => rateLimitBy(name, max, windowMs, (req) => req.ip || 'unknown');

// Limits requests per window by any key taken from the request, such as an email
// address. Keys are hashed before they are stored.
export function rateLimitBy(name, max, windowMs, keyOf) {
  return async (req, res, next) => {
    const key = keyOf(req);
    if (!key) return next();
    const hits = await hit(`${name}:${sha256(key)}`, windowMs);
    if (hits > max) return tooMany(res, windowMs);
    next();
  };
}
