// Server-rendered entry for shared result links, so social networks see a
// title and description for the person's results. Every other page is static.

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as results from '../db/repositories/results.js';
import { isShareId } from '../lib/validation.js';
import { shareUrl } from '../services/quiz.js';
import { config } from '../config.js';

const indexHtml = readFileSync(fileURLToPath(new URL('../../client/index.html', import.meta.url)), 'utf8');

const escAttr = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function withMeta({ title, description, url }) {
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${escAttr(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${escAttr(description)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${escAttr(title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${escAttr(description)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${escAttr(url)}`)
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${escAttr(config.publicUrl)}/img/og.png`);
}

export const pageRoutes = Router();

pageRoutes.get('/results/:id', async (req, res) => {
  const row = isShareId(req.params.id) ? await results.findByShareId(req.params.id) : null;
  if (!row) return res.type('html').send(indexHtml);
  const parsed = JSON.parse(row.results_json);
  const best = parsed.parties.filter((p) => p.score !== null).sort((a, b) => b.score - a.score)[0];
  res.set('Cache-Control', 'private, no-store');
  res.type('html').send(
    withMeta({
      title: `${row.first_name}'s 2026 Texas ballot alignment`,
      description: best
        ? `Closest party platform: ${best.name} at ${best.score}%. Take the nonpartisan quiz and see how the candidates on your ballot compare.`
        : 'Take the nonpartisan quiz and see how the candidates on your ballot compare.',
      url: shareUrl(row.share_id),
    })
  );
});
