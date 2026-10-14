import { Router } from 'express';
import * as accounts from '../services/accounts.js';
import { parseProfile, requireEmail } from '../lib/validation.js';
import { requireUser, bearerToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const MINUTES_15 = 15 * 60 * 1000;
export const accountRoutes = Router();

accountRoutes.post('/register', rateLimit('register', 20, MINUTES_15), async (req, res) => {
  res.json(await accounts.register(parseProfile(req.body || {})));
});

accountRoutes.post('/lookup', rateLimit('lookup', 20, MINUTES_15), async (req, res) => {
  const found = await accounts.openByEmail(requireEmail(req.body?.email));
  if (!found) return res.status(404).json({ error: 'We did not find any saved results for that email address.' });
  res.json(found);
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
