import { Router } from 'express';
import * as users from '../db/repositories/users.js';
import * as results from '../db/repositories/results.js';
import { requireAdmin, requireRole, adminRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { toCsv } from '../lib/csv.js';
import * as partners from '../services/partners.js';
import * as analytics from '../services/analytics.js';
import { config } from '../config.js';

export const adminRoutes = Router();
adminRoutes.use(rateLimit('admin', 300, 15 * 60 * 1000), requireAdmin);

adminRoutes.get('/users.csv', requireRole('master'), async (req, res) => {
  res
    .type('text/csv')
    .attachment('users.csv')
    .send(toCsv(await users.exportAll()));
});

adminRoutes.get('/results.csv', requireRole('master'), async (req, res) => {
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
  role: adminRole(u),
});

// The signed-in admin's own role, so the page shows only what they can do.
adminRoutes.get('/me', (req, res) => res.json({ role: req.adminRole }));

adminRoutes.get('/users', async (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .slice(0, 80);
  const rows = q.length >= 2 ? await users.search(q) : await users.admins(config.adminEmails);
  const order = { master: 0, write: 1, read: 2, null: 3 };
  res.json({ users: rows.map(adminView).sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name)) });
});

// Write and master admins grant, change, or remove admin access. Master admins
// cannot be changed here. An admin may lower their own role, but only a write
// or master admin can raise it again.
adminRoutes.put('/users/:id/role', requireRole('write'), async (req, res) => {
  const role = req.body?.role ?? null;
  if (role !== null && role !== 'read' && role !== 'write')
    return res.status(400).json({ error: 'Choose Read, Write, or no access.' });
  const target = await users.findById(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'That account no longer exists.' });
  if (adminRole(target) === 'master') {
    return res.status(400).json({ error: 'The master admin always has full access and cannot be changed.' });
  }
  res.json({ user: adminView(await users.setAdminRole(target.id, role)) });
});

// ---------- Site overview ----------

adminRoutes.get('/overview', async (req, res) => {
  const range = rangeOf(req);
  try {
    res.json(await analytics.overview({ ...range, group: req.query.group, excludeAdmins: req.query.admins !== 'include' }));
  } catch (err) {
    // Admins see the actual reason, so a problem can be reported precisely.
    console.error('[admin] overview failed', err);
    res.status(500).json({ error: `The overview could not be built: ${err.message}` });
  }
});

adminRoutes.get('/overview.csv', async (req, res) => {
  const o = await analytics.overview({ ...rangeOf(req), group: req.query.group, excludeAdmins: req.query.admins !== 'include' });
  res
    .type('text/csv')
    .attachment(`votershub-overview-${o.range.from}-to-${o.range.to}.csv`)
    .send(
      toCsv(
        o.series.map(({ bucket, ...rest }) => ({
          [o.range.group]: o.range.group === 'hour' ? `${bucket.replace('T', ' ')}:00` : bucket,
          ...rest,
        }))
      )
    );
});
