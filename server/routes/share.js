// Share images for a quiz result. The image shows only what the shared link
// shows (first name, party percentages, and optional top issues), so it needs
// no sign-in and social networks can fetch it for link previews.

import { Router } from 'express';
import * as results from '../db/repositories/results.js';
import { isShareId } from '../lib/validation.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { sharePreview } from '../services/quiz.js';
import { shareImage } from '../services/share-image.js';

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
