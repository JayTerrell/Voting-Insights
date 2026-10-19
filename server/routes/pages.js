// Server-rendered entry for shared result links, so social networks see a
// title and description for the person's results. Every other page is static.

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as results from '../db/repositories/results.js';
import { isShareId } from '../lib/validation.js';
import { shareUrl, sharePreview } from '../services/quiz.js';
import { config } from '../config.js';
import { recordVisit } from '../services/partners.js';

const indexHtml = readFileSync(fileURLToPath(new URL('../../client/index.html', import.meta.url)), 'utf8');

const escAttr = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function withMeta({ title, description, url, image }) {
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${escAttr(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${escAttr(description)}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${escAttr(title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${escAttr(description)}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${escAttr(url)}`)
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${escAttr(image || `${config.publicUrl}/img/og.png`)}`)
    .replace(
      /(<meta name="twitter:card" content="summary_large_image" \/>)/,
      `$1\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />\n    <meta name="twitter:image" content="${escAttr(image || `${config.publicUrl}/img/og.png`)}" />`
    );
}

export const pageRoutes = Router();

pageRoutes.get('/results/:id', async (req, res) => {
  const row = isShareId(req.params.id) ? await results.findByShareId(req.params.id) : null;
  if (!row) return res.type('html').send(indexHtml);
  const best = sharePreview(row).parties[0];
  res.set('Cache-Control', 'private, no-store');
  res.type('html').send(
    withMeta({
      title: `${row.first_name}'s 2026 Texas ballot alignment`,
      description: best
        ? `Closest party platform: ${best.name} at ${best.score}%. Take the nonpartisan quiz and see how the candidates on your ballot compare.`
        : 'Take the nonpartisan quiz and see how the candidates on your ballot compare.',
      url: shareUrl(row.share_id),
      // The version changes when the owner turns top issues on or off, so networks refetch the image.
      image: `${config.publicUrl}/api/share/${row.share_id}/card.png?v=${row.share_issues ? 2 : 1}`,
    })
  );
});

// Partner links: count the visit, then land on the home page with the partner
// remembered in the browser (the client keeps the first one for 30 days).
pageRoutes.get('/go/:slug', async (req, res) => {
  let slug = null;
  try {
    slug = await recordVisit(String(req.params.slug).slice(0, 40), req.ip, req.get('user-agent') || '');
  } catch (err) {
    console.error('[partners] visit not recorded', err.message);
  }
  res.set('Cache-Control', 'no-store');
  res.redirect(302, slug ? `/?ref=${encodeURIComponent(slug)}` : '/');
});
