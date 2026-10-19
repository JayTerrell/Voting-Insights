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
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

export const isAdmin = (user) => Boolean(user && (user.is_admin || config.adminEmails.includes(user.email.toLowerCase())));

// Admin pages: a signed-in admin, or the ADMIN_TOKEN (for scripts) in the
// Authorization header. Neither is ever accepted in a URL.
export async function requireAdmin(req, res, next) {
  const token = bearerToken(req);
  if (config.adminToken && token && safeEqual(token, config.adminToken)) return next();
  req.user = await findUser(token);
  if (!isAdmin(req.user)) return res.status(req.user ? 403 : 401).json({ error: 'Unauthorized' });
  next();
}
