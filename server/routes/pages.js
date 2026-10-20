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
import * as listShares from '../db/repositories/list-shares.js';
import { listUrl, listVersion, resolve } from '../services/list-share.js';
import { countyLabel } from '../services/guide.js';

const indexHtml = readFileSync(fileURLToPath(new URL('../../client/index.html', import.meta.url)), 'utf8');

const escAttr = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function withMeta({ title, description, url, image }) {
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${escAttr(title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*/, `$1${escAttr(description)}`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*/, `$1${escAttr(title)}`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*/, `$1${escAttr(description)}`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*/, `$1${escAttr(url)}`)
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*/, `$1${escAttr(image || `${config.publicUrl}/img/og.png`)}`)
    .replace(
      /(<meta\s+name="twitter:card"\s+content="summary_large_image"\s*\/>)/,
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

// Shared ballot picks and watchlists. The path names the kind, so a link to
// the wrong kind is treated as not found.
pageRoutes.get(['/ballot/:id', '/watchlist/:id'], async (req, res) => {
  const kind = req.path.split('/')[1];
  const { id } = req.params;
  const row = isShareId(id) ? await listShares.findByShareId(id) : null;
  if (!row || row.kind !== kind) return res.type('html').send(indexHtml);
  const list = resolve(row);
  const n = list.items.length;
  const names =
    kind === 'ballot'
      ? list.items.slice(0, 3).map((i) => `${i.pick.name} for ${i.title}`)
      : list.items.slice(0, 3).map((i) => i.title);
  const more = n > 3 ? `, and ${n - 3} more` : '';
  res.set('Cache-Control', 'private, no-store');
  res.type('html').send(
    withMeta({
      title:
        kind === 'ballot'
          ? `${row.first_name}'s picks for the 2026 Texas ballot`
          : `The offices ${row.first_name} is watching on the 2026 Texas ballot`,
      description: `${countyLabel(row.county)}: ${names.join('; ')}${more}. See the full list and build your own ballot on VotersHub.`,
      url: listUrl(kind, row.share_id),
      image: `${config.publicUrl}/api/lists/${row.share_id}/card.png?v=${listVersion(row)}`,
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
