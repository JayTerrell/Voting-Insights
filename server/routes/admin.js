import { Router } from 'express';
import * as users from '../db/repositories/users.js';
import * as results from '../db/repositories/results.js';
import { requireAdmin, isAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { toCsv } from '../lib/csv.js';
import * as partners from '../services/partners.js';
import { config } from '../config.js';

export const adminRoutes = Router();
adminRoutes.use(rateLimit('admin', 300, 15 * 60 * 1000), requireAdmin);

adminRoutes.get('/users.csv', async (req, res) => {
  res
    .type('text/csv')
    .attachment('users.csv')
    .send(toCsv(await users.exportAll()));
});

adminRoutes.get('/results.csv', async (req, res) => {
  res
    .type('text/csv')
    .attachment('quiz-results.csv')
    .send(toCsv(await results.exportAll()));
});

// ---------- Partner links ----------

const rangeOf = (req) => partners.dateRange(req.query.from, req.query.to);
const fail = (res, err) => {
  if (err instanceof partners.PartnerError) return res.status(err.status).json({ error: err.message });
  throw err;
};

adminRoutes.get('/partners', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  res.json({ links: await partners.listForAdmin(status) });
});

adminRoutes.post('/partners/:id/:decision', async (req, res) => {
  const { decision } = req.params;
  if (decision !== 'approve' && decision !== 'reject') return res.status(404).json({ error: 'Not found' });
  if (!req.user) return res.status(403).json({ error: 'Sign in as an admin to decide requests.' });
  try {
    res.json({ link: await partners.decide(req.user, Number(req.params.id), decision === 'approve', req.body?.note) });
  } catch (err) {
    fail(res, err);
  }
});

adminRoutes.get('/partners/summary', async (req, res) => {
  const range = rangeOf(req);
  res.json({ range, links: await partners.summary(range) });
});

adminRoutes.get('/partners.csv', async (req, res) => {
  const rows = await partners.summary(rangeOf(req));
  res
    .type('text/csv')
    .attachment('partner-links.csv')
    .send(
      toCsv(
        rows.map((r) => ({
          link: r.url,
          owner: r.owner.name,
          email: r.owner.email,
          visits: r.visits,
          unique_visitors: r.unique_visitors,
          sign_ups: r.sign_ups,
          quiz_completions: r.quiz_completions,
          sign_up_rate_pct: r.sign_up_rate ?? '',
        }))
      )
    );
});

// ---------- Admins ----------

const adminView = (u) => ({
  id: u.id,
  name: `${u.first_name} ${u.last_name}`,
  email: u.email,
  county: u.county,
  created_at: u.created_at,
  is_admin: isAdmin(u),
  owner: config.adminEmails.includes(u.email.toLowerCase()),
});

adminRoutes.get('/users', async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .slice(0, 80);
  res.json({ users: (q.length >= 2 ? await users.search(q) : await users.admins()).map(adminView) });
});

adminRoutes.put('/users/:id/admin', async (req, res) => {
  if (typeof req.body?.admin !== 'boolean') return res.status(400).json({ error: 'Choose on or off.' });
  const target = await users.findById(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'That account no longer exists.' });
  if (!req.body.admin && config.adminEmails.includes(target.email.toLowerCase())) {
    return res.status(400).json({ error: 'This account is a permanent admin and cannot be removed here.' });
  }
  if (!req.body.admin && req.user && req.user.id === target.id) {
    return res.status(400).json({ error: 'You cannot remove your own admin access.' });
  }
  res.json({ user: adminView(await users.setAdmin(target.id, req.body.admin)) });
});
