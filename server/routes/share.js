// Share images for a quiz result or a shared ballot or watchlist. Each image
// shows only what its shared link shows, so it needs no sign-in and social
// networks can fetch it for link previews.

import { Router } from 'express';
import * as results from '../db/repositories/results.js';
import { isShareId } from '../lib/validation.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { sharePreview } from '../services/quiz.js';
import { shareImage, listImage } from '../services/share-image.js';
import * as listShares from '../db/repositories/list-shares.js';
import { resolve } from '../services/list-share.js';

export const shareRoutes = Router();

shareRoutes.get('/share/:id/:format.png', rateLimit('share-image', 600, 15 * 60 * 1000), async (req, res) => {
  const format = req.params.format;
  if (format !== 'card' && format !== 'story') return res.status(404).end();
  const row = isShareId(req.params.id) ? await results.findByShareId(req.params.id) : null;
  if (!row) return res.status(404).end();
  const png = shareImage(sharePreview(row), format);
  res.set('Cache-Control', 'public, max-age=600');
  if (req.query.download) res.attachment(`votershub-${format}.png`);
  res.type('image/png').send(png);
});

shareRoutes.get('/lists/:id/:format.png', rateLimit('share-image', 600, 15 * 60 * 1000), async (req, res) => {
  const format = req.params.format;
  if (format !== 'card' && format !== 'story') return res.status(404).end();
  const row = isShareId(req.params.id) ? await listShares.findByShareId(req.params.id) : null;
  if (!row) return res.status(404).end();
  const png = listImage(resolve(row), format);
  res.set('Cache-Control', 'public, max-age=600');
  if (req.query.download) res.attachment(`votershub-${row.kind}-${format}.png`);
  res.type('image/png').send(png);
});
