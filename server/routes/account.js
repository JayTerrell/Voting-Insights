import { Router } from 'express';
import * as accounts from '../services/accounts.js';
import { parseProfile, requireEmail, requirePassword, parsePlan, parseAvatar, normalizeEmail } from '../lib/validation.js';
import { requireUser, bearerToken } from '../middleware/auth.js';
import { rateLimit, rateLimitBy } from '../middleware/rate-limit.js';

const MINUTES_15 = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
export const accountRoutes = Router();

// Password guessing is limited per address as well as per IP, so spreading
// attempts across many IPs does not help against one account.
const perEmail = (name, max, windowMs) => rateLimitBy(name, max, windowMs, (req) => normalizeEmail(req.body?.email));

accountRoutes.post('/sign-up', rateLimit('sign-up', 30, MINUTES_15), async (req, res) => {
  const body = req.body || {};
  const profile = parseProfile(body);
  const partner = typeof body.partner === 'string' ? body.partner.slice(0, 40) : null;
  res.status(201).json(await accounts.signUp(profile, requirePassword(body.password), partner));
});

accountRoutes.post(
  '/sign-in',
  rateLimit('sign-in', 30, MINUTES_15),
  perEmail('sign-in-email', 10, MINUTES_15),
  async (req, res) => {
    const body = req.body || {};
    res.json(await accounts.signIn(requireEmail(body.email), typeof body.password === 'string' ? body.password : ''));
  }
);

accountRoutes.post('/password/forgot', rateLimit('forgot', 10, HOUR), perEmail('forgot-email', 3, HOUR), async (req, res) => {
  await accounts.requestPasswordReset(requireEmail(req.body?.email));
  res.json({ sent: true });
});

accountRoutes.post('/password/reset', rateLimit('reset', 10, MINUTES_15), async (req, res) => {
  const body = req.body || {};
  const password = requirePassword(body.password);
  res.json(await accounts.resetPassword(String(body.token || ''), password));
});

accountRoutes.post('/password/change', rateLimit('change', 10, MINUTES_15), requireUser, async (req, res) => {
  const body = req.body || {};
  const next = requirePassword(body.new_password);
  res.json(await accounts.changePassword(req.user, String(body.current_password || ''), next));
});

accountRoutes.get('/me', requireUser, async (req, res) => {
  res.json({ user: accounts.publicUser(req.user), providers: await accounts.linkedProviders(req.user) });
});

// The email address is the account's identity and cannot be changed here.
accountRoutes.patch('/me', rateLimit('profile', 20, MINUTES_15), requireUser, async (req, res) => {
  const profile = parseProfile({ ...req.body, email: req.user.email }, { requireConsent: false });
  res.json({ user: await accounts.updateProfile(req.user, profile) });
});

accountRoutes.put('/me/avatar', rateLimit('avatar', 20, MINUTES_15), requireUser, async (req, res) => {
  res.json({ user: await accounts.setAvatar(req.user, parseAvatar(req.body?.image)) });
});

accountRoutes.delete('/me/avatar', rateLimit('avatar', 20, MINUTES_15), requireUser, async (req, res) => {
  res.json({ user: await accounts.setAvatar(req.user, null) });
});

accountRoutes.get('/me/plan', requireUser, async (req, res) => {
  res.json({ plan: await accounts.getPlan(req.user) });
});

accountRoutes.put('/me/plan', rateLimit('plan', 300, MINUTES_15), requireUser, async (req, res) => {
  res.json({ plan: await accounts.savePlan(req.user, parsePlan(req.body)) });
});

accountRoutes.post('/sign-out', requireUser, async (req, res) => {
  await accounts.signOut(bearerToken(req));
  res.json({ signed_out: true });
});

accountRoutes.delete('/me', rateLimit('delete', 5, MINUTES_15), requireUser, async (req, res) => {
  await accounts.deleteAccount(req.user, {
    password: String(req.body?.password || ''),
    confirmEmail: req.body?.confirm_email,
  });
  res.json({ deleted: true });
});
