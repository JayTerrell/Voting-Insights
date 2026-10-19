import { Router } from 'express';
import * as partners from '../services/partners.js';
import * as links from '../db/repositories/partners.js';
import { requireUser, isAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const MINUTES_15 = 15 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
export const partnerRoutes = Router();

const send = (res, fn) =>
  fn().catch((err) => {
    if (err instanceof partners.PartnerError) return res.status(err.status).json({ error: err.message });
    throw err;
  });

partnerRoutes.get('/partner/check', rateLimit('partner-check', 120, MINUTES_15), requireUser, async (req, res) => {
  res.json(await partners.checkSlug(req.query.slug));
});

partnerRoutes.get('/partner/me', requireUser, async (req, res) => {
  res.json({ link: partners.publicLink(await links.latestForUser(req.user.id)) });
});

partnerRoutes.post('/partner/request', rateLimit('partner-request', 5, HOUR), requireUser, (req, res) =>
  send(res, async () =>
    res.status(201).json({ link: await partners.request(req.user, req.body?.slug, req.body?.reason, req.body?.socials) })
  )
);

// A partner's own totals. Admins may also open any link's totals here by id.
partnerRoutes.get('/partner/stats', requireUser, async (req, res) => {
  const range = partners.dateRange(req.query.from, req.query.to);
  let link = await links.latestForUser(req.user.id);
  if (req.query.id && isAdmin(req.user)) link = await links.findById(Number(req.query.id));
  if (!link || link.status !== 'approved') return res.status(404).json({ error: 'No approved partner link.' });
  res.json({ link: partners.publicLink(link), stats: await partners.stats(link.id, range) });
});

// Anonymous activity from a visitor who arrived through a partner link.
partnerRoutes.post('/partner/event', rateLimit('partner-event', 60, MINUTES_15), async (req, res) => {
  const body = req.body || {};
  if (!partners.EVENT_KINDS.includes(body.kind)) return res.status(400).json({ error: 'Unknown event.' });
  await partners.recordEvent(String(body.slug || '').slice(0, 40), body.kind, req.ip, req.get('user-agent') || '');
  res.json({ ok: true });
});

// Who referred the person filling in the sign-up form, for the note shown there.
partnerRoutes.get('/partner/referrer', rateLimit('partner-referrer', 60, MINUTES_15), async (req, res) => {
  res.json({ partner: await partners.signUpNote(String(req.query.slug || '').slice(0, 40)) });
});
