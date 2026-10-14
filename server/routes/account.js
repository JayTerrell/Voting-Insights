import { Router } from 'express';
import * as accounts from '../services/accounts.js';
import { parseProfile, requireEmail, isCode, ValidationError } from '../lib/validation.js';
import { optionalUser, requireUser, bearerToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const MINUTES_15 = 15 * 60 * 1000;
export const accountRoutes = Router();

accountRoutes.post('/register', rateLimit('register', 20, MINUTES_15), optionalUser, async (req, res) => {
  const profile = parseProfile(req.body || {});
  res.json(await accounts.register(profile, req.user, bearerToken(req)));
});

accountRoutes.post('/lookup', rateLimit('lookup', 8, MINUTES_15), async (req, res) => {
  await accounts.requestCode(requireEmail(req.body?.email));
  res.json({ sent: true });
});

accountRoutes.post('/verify', rateLimit('verify', 15, MINUTES_15), async (req, res) => {
  const email = requireEmail(req.body?.email);
  if (!isCode(req.body?.code)) throw new ValidationError('Please enter the 6-digit code from your email.');
  const profile = req.body?.profile && typeof req.body.profile === 'object' ? req.body.profile : null;
  res.json(await accounts.verify(email, String(req.body.code).trim(), profile));
});

accountRoutes.get('/me', requireUser, (req, res) => {
  res.json({ user: accounts.publicUser(req.user) });
});

accountRoutes.post('/sign-out', requireUser, async (req, res) => {
  await accounts.signOut(bearerToken(req));
  res.json({ signed_out: true });
});

accountRoutes.delete('/me', rateLimit('delete', 5, MINUTES_15), requireUser, async (req, res) => {
  await accounts.deleteAccount(req.user);
  res.json({ deleted: true });
});
