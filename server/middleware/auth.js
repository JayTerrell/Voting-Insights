import { findUser } from '../db/repositories/tokens.js';
import { config } from '../config.js';
import { safeEqual } from '../lib/crypto.js';

export function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

// Attaches req.user when a valid token is present. Never rejects the request.
export async function optionalUser(req, res, next) {
  req.user = await findUser(bearerToken(req));
  next();
}

export async function requireUser(req, res, next) {
  req.user = await findUser(bearerToken(req));
  if (!req.user) return res.status(401).json({ error: 'Please verify your email to continue.' });
  next();
}

// Admin exports accept the token only in the Authorization header, never in the URL.
export function requireAdmin(req, res, next) {
  const token = bearerToken(req);
  if (!config.adminToken || !token || !safeEqual(token, config.adminToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
