import { hit } from '../db/repositories/rate-limits.js';
import { sha256 } from '../lib/crypto.js';

// Limits each client IP to `max` requests per window for one route family.
export function rateLimit(name, max, windowMs) {
  return async (req, res, next) => {
    const hits = await hit(`${name}:${sha256(req.ip || 'unknown')}`, windowMs);
    if (hits > max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    }
    next();
  };
}
