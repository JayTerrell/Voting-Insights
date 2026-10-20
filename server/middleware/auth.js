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

// Admin roles, highest first. 'master' accounts are listed in ADMIN_EMAILS and
// can do everything; 'write' admins also manage other admins; 'read' admins see
// the numbers and review partner link requests.
export const ROLE_RANK = { read: 1, write: 2, master: 3 };

export function adminRole(user) {
  if (!user) return null;
  if (config.adminEmails.includes(String(user.email).toLowerCase())) return 'master';
  if (user.admin_role === 'read' || user.admin_role === 'write') return user.admin_role;
  return user.is_admin ? 'write' : null;
}

export const isAdmin = (user) => Boolean(adminRole(user));

// Admin pages: a signed-in admin, or the ADMIN_TOKEN (for scripts) in the
// Authorization header. Neither is ever accepted in a URL.
export async function requireAdmin(req, res, next) {
  const token = bearerToken(req);
  if (config.adminToken && token && safeEqual(token, config.adminToken)) {
    req.adminRole = 'master';
    return next();
  }
  req.user = await findUser(token);
  req.adminRole = adminRole(req.user);
  if (!req.adminRole) return res.status(req.user ? 403 : 401).json({ error: 'Unauthorized' });
  next();
}

// Use after requireAdmin: the signed-in admin needs at least this role.
export const requireRole = (role) => (req, res, next) =>
  ROLE_RANK[req.adminRole] >= ROLE_RANK[role]
    ? next()
    : res
        .status(403)
        .json({ error: role === 'master' ? 'Only the master admin can do that.' : 'Your admin role cannot do that.' });
