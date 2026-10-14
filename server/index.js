import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import * as store from './db.js';
import { emailConfigured, sendCodeEmail, sendResultsEmail } from './email.js';
import { scoreAll } from '../public/js/scoring.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const GUIDE_PATH = resolve('data/guide.json');
if (!existsSync(GUIDE_PATH)) {
  console.error('data/guide.json is missing. Run "npm run build:data" first.');
  process.exit(1);
}
const guideRaw = readFileSync(GUIDE_PATH, 'utf8');
const guide = JSON.parse(guideRaw);
const DATA_VERSION = createHash('sha256').update(guideRaw).digest('hex').slice(0, 12);
const formOptions = JSON.parse(readFileSync(resolve('data/form-options.json'), 'utf8'));
const indexHtml = readFileSync(resolve('public/index.html'), 'utf8');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY ?? 1);
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});

// Small in-memory rate limiter, keyed by route and client IP.
const buckets = new Map();
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.reset < now) {
      buckets.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++b.count > max) return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const clean = (s, max = 60) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

function validateProfile(body) {
  const p = {
    first_name: clean(body.first_name),
    last_name: clean(body.last_name),
    email: store.normalizeEmail(body.email),
    county: clean(body.county),
    age_range: clean(body.age_range),
    marketing_ok: body.marketing_ok === true,
  };
  if (!p.first_name || !p.last_name) return { error: 'Please enter your first and last name.' };
  if (!EMAIL_RE.test(p.email) || p.email.length > 254) return { error: 'Please enter a valid email address.' };
  if (!formOptions.counties.includes(p.county)) return { error: 'Please choose your county.' };
  if (!formOptions.age_ranges.includes(p.age_range)) return { error: 'Please choose your age range.' };
  if (body.agree_terms !== true) return { error: 'Please agree to the Terms of Use and Privacy Policy to continue.' };
  return { profile: p };
}

function bearer(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function publicUser(u) {
  return { first_name: u.first_name, last_name: u.last_name, email: u.email, county: u.county, age_range: u.age_range };
}

async function sendCode(email) {
  const code = store.createVerificationCode(email);
  if (!emailConfigured) console.log(`[verify] Code for ${email}: ${code}`);
  await sendCodeEmail(email, code);
}

function shareUrl(shareId) {
  return `${PUBLIC_URL}/results/${shareId}`;
}

async function emailResult(row) {
  await sendResultsEmail(row.email, {
    firstName: row.first_name,
    results: JSON.parse(row.results_json),
    shareUrl: shareUrl(row.share_id),
    guide,
    createdAt: row.created_at,
  });
  store.markEmailed(row.share_id);
}

// ---------- API ----------

app.get('/api/guide', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.set('ETag', `"${DATA_VERSION}"`);
  if (req.get('if-none-match') === `"${DATA_VERSION}"`) return res.status(304).end();
  res.type('application/json').send(guideRaw);
});

app.get('/api/form-options', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ ...formOptions, contact_email: process.env.CONTACT_EMAIL || null });
});

// Start the quiz. New emails get an account right away. An email that already
// has an account must be confirmed with a code unless this device holds its token.
app.post('/api/register', limit('register', 20, 15 * 60_000), async (req, res) => {
  const { profile, error } = validateProfile(req.body || {});
  if (error) return res.status(400).json({ error });

  const existing = store.findUserByEmail(profile.email);
  if (!existing) {
    const user = store.createUser(profile);
    return res.json({ token: store.issueToken(user.id), user: publicUser(user) });
  }
  const tokenUser = store.userForToken(bearer(req));
  if (tokenUser && tokenUser.id === existing.id) {
    store.updateUserProfile(existing.id, profile);
    return res.json({ token: bearer(req), user: publicUser({ ...existing, ...profile }) });
  }
  try {
    await sendCode(profile.email);
  } catch (e) {
    console.error('[register] failed to send code', e);
    return res.status(502).json({ error: 'We could not send a verification email right now. Please try again shortly.' });
  }
  res.json({ verify: true });
});

// Ask for a code to open "My Results". The response is the same whether or not
// the email exists, so the form cannot be used to discover who has taken the quiz.
app.post('/api/lookup', limit('lookup', 8, 15 * 60_000), async (req, res) => {
  const email = store.normalizeEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (store.findUserByEmail(email)) {
    try {
      await sendCode(email);
    } catch (e) {
      console.error('[lookup] failed to send code', e);
      return res.status(502).json({ error: 'We could not send a verification email right now. Please try again shortly.' });
    }
  }
  res.json({ sent: true });
});

app.post('/api/verify', limit('verify', 15, 15 * 60_000), (req, res) => {
  const email = store.normalizeEmail(req.body?.email);
  if (!store.checkVerificationCode(email, req.body?.code)) {
    return res.status(400).json({ error: 'That code is incorrect or has expired.' });
  }
  const user = store.findUserByEmail(email);
  if (!user) return res.status(400).json({ error: 'That code is incorrect or has expired.' });
  if (req.body?.profile) {
    const { profile } = validateProfile({ ...req.body.profile, email, agree_terms: true });
    if (profile) store.updateUserProfile(user.id, profile);
  }
  res.json({ token: store.issueToken(user.id), user: publicUser(store.findUserByEmail(email)) });
});

app.get('/api/me', (req, res) => {
  const user = store.userForToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: publicUser(user) });
});

function sanitizeAnswers(raw) {
  const valid = new Set(guide.questions.map((q) => q.id));
  const out = {};
  for (const [qid, a] of Object.entries(raw || {})) {
    if (!valid.has(qid) || !a) continue;
    const value = Number(a.value);
    const weight = Number(a.weight);
    if (![-2, -1, 0, 1, 2].includes(value)) continue;
    out[qid] = { value, weight: [0.5, 1, 2].includes(weight) ? weight : 1 };
  }
  return out;
}

app.post('/api/results', limit('results', 30, 15 * 60_000), async (req, res) => {
  const user = store.userForToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Your session has expired. Please start the quiz again.' });
  const answers = sanitizeAnswers(req.body?.answers);
  if (Object.keys(answers).length < 5) {
    return res.status(400).json({ error: 'Please answer at least five questions to see meaningful results.' });
  }
  const results = scoreAll(answers, guide, user.county);
  const row = store.saveResult(user.id, answers, results, DATA_VERSION);
  emailResult(row).catch((e) => console.error('[results] email failed', e));
  res.json({ share_id: row.share_id, created_at: row.created_at, results, answers });
});

app.get('/api/results/:id', (req, res) => {
  const row = store.getResult(String(req.params.id));
  if (!row) return res.status(404).json({ error: 'We could not find those results.' });
  const viewer = store.userForToken(bearer(req));
  const owner = Boolean(viewer && viewer.id === row.user_id);
  res.json({
    share_id: row.share_id,
    created_at: row.created_at,
    first_name: row.first_name,
    owner,
    results: JSON.parse(row.results_json),
    answers: owner ? JSON.parse(row.answers_json) : undefined,
    data_version: row.data_version,
    current_version: DATA_VERSION,
  });
});

app.post('/api/results/:id/email', limit('email', 5, 15 * 60_000), async (req, res) => {
  const row = store.getResult(String(req.params.id));
  const viewer = store.userForToken(bearer(req));
  if (!row || !viewer || viewer.id !== row.user_id) return res.status(403).json({ error: 'Only the person who took this quiz can email it.' });
  try {
    await emailResult(row);
    res.json({ sent: true, to: row.email });
  } catch (e) {
    console.error('[email] failed', e);
    res.status(502).json({ error: 'We could not send the email right now. Please try again shortly.' });
  }
});

app.get('/api/my-results', (req, res) => {
  const user = store.userForToken(bearer(req));
  if (!user) return res.status(401).json({ error: 'Please verify your email to see your results.' });
  const rows = store.listResults(user.id).map((r) => {
    const results = JSON.parse(r.results_json);
    return { share_id: r.share_id, created_at: r.created_at, answered: results.answered, parties: results.parties };
  });
  res.json({ user: publicUser(user), results: rows });
});

// ---------- Admin exports ----------

function adminOnly(req, res, next) {
  const given = Buffer.from(bearer(req) || String(req.query.token || ''));
  const want = Buffer.from(ADMIN_TOKEN);
  if (!ADMIN_TOKEN || given.length !== want.length || !timingSafeEqual(given, want)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

app.get('/api/admin/users.csv', adminOnly, (req, res) => {
  res.type('text/csv').attachment('users.csv').send(toCsv(store.exportUsers()));
});
app.get('/api/admin/results.csv', adminOnly, (req, res) => {
  res.type('text/csv').attachment('quiz-results.csv').send(toCsv(store.exportResults()));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Pages ----------

app.use(express.static(resolve('public'), { index: false, maxAge: '1h' }));

const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderIndex(meta = {}) {
  const title = meta.title || 'Voting Insights: 2026 Texas Candidate Guide and Issue Quiz';
  const desc =
    meta.description ||
    'A nonpartisan guide to the races on Texas ballots for November 3, 2026, starting with Collin County, with sourced candidate positions and an issue alignment quiz.';
  const url = meta.url || PUBLIC_URL;
  const tags = `
    <meta name="description" content="${escAttr(desc)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Voting Insights">
    <meta property="og:title" content="${escAttr(title)}">
    <meta property="og:description" content="${escAttr(desc)}">
    <meta property="og:url" content="${escAttr(url)}">
    <meta property="og:image" content="${PUBLIC_URL}/img/og.png">
    <meta name="twitter:card" content="summary_large_image">`;
  return indexHtml.replace('<!--META-->', tags).replace('<title>Voting Insights</title>', `<title>${escAttr(title)}</title>`);
}

app.get('/results/:id', (req, res) => {
  const row = store.getResult(String(req.params.id));
  let meta = {};
  if (row) {
    const results = JSON.parse(row.results_json);
    const best = [...results.parties].filter((p) => p.score !== null).sort((a, b) => b.score - a.score)[0];
    meta = {
      title: `${row.first_name}'s 2026 Texas ballot alignment`,
      description: best
        ? `Closest party platform: ${best.name} at ${best.score}%. Take the nonpartisan quiz and see how every candidate on your ballot compares.`
        : 'Take the nonpartisan quiz and see how every candidate on your ballot compares.',
      url: shareUrl(row.share_id),
    };
  }
  res.type('html').send(renderIndex(meta));
});

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.type('html').send(renderIndex({ url: PUBLIC_URL + req.path }));
});

app.listen(PORT, () => {
  console.log(`Voting Insights running at ${PUBLIC_URL} (data ${DATA_VERSION}, email ${emailConfigured ? 'SMTP' : 'outbox folder'})`);
});
