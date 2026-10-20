// Shared ballot picks and watchlists: the owner creates, updates, or stops a
// link, and anyone with the link can read the list.

import { Router } from 'express';
import * as lists from '../services/list-share.js';
import * as shares from '../db/repositories/list-shares.js';
import { isShareId } from '../lib/validation.js';
import { optionalUser, requireUser } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const MINUTES_15 = 15 * 60 * 1000;
export const listRoutes = Router();

listRoutes.get('/lists/mine', requireUser, async (req, res) => {
  res.json(await lists.mine(req.user));
});

listRoutes.put('/lists/:kind', rateLimit('list-share', 60, MINUTES_15), requireUser, async (req, res) => {
  const out = await lists.share(req.user, req.params.kind, String(req.body?.county || ''));
  if (out.error) return res.status(400).json({ error: out.error });
  res.json(out);
});

listRoutes.delete('/lists/:kind', requireUser, async (req, res) => {
  if (!lists.LIST_KINDS.includes(req.params.kind)) return res.status(404).json({ error: 'Not found.' });
  await lists.stop(req.user, req.params.kind);
  res.json({ stopped: true });
});

listRoutes.get('/lists/:id', rateLimit('view', 120, MINUTES_15), optionalUser, async (req, res) => {
  const row = isShareId(req.params.id) ? await shares.findByShareId(req.params.id) : null;
  if (!row) return res.status(404).json({ error: 'This shared list is no longer available.' });
  res.json(lists.publicView(row, req.user));
});
