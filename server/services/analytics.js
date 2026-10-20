// Site-wide numbers for the Admin overview: visitors, page views, sign-ups,
// quizzes, and engagement, grouped by day, week, or month, compared with the
// period before.
//
// Visits are counted without cookies or stored addresses. Each page view
// stores a one-way hash of the network address and browser, salted with the
// day, so it counts daily unique visitors and cannot identify anyone or be
// linked across days. Crawlers are skipped.

import { createHmac } from 'node:crypto';
import * as analytics from '../db/repositories/analytics.js';
import { config } from '../config.js';
import { guide } from './guide.js';
import { topIssues } from '../../shared/scoring.js';
import { centralDay } from './partners.js';

export const KINDS = ['pageview', 'quiz_start', 'share', 'vote_lookup', 'print_ballot'];
const BOTS =
  /bot|crawl|spider|preview|facebookexternalhit|slack|discord|whatsapp|telegram|embedly|quora|pinterest|vkshare|skype|curl|wget|python|headless|lighthouse/i;

const visitorHash = (ip, ua, day) =>
  createHmac('sha256', config.authSecret || 'votershub-visitors')
    .update(`site|${day}|${ip}|${ua}`)
    .digest('hex')
    .slice(0, 32);

const device = (ua) => (/ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|iphone|android/i.test(ua) ? 'Phone' : 'Computer');

// Paths are grouped so no one's shared result or list link is stored.
function cleanPath(p) {
  const path = String(p || '/')
    .split(/[?#]/)[0]
    .slice(0, 120);
  if (!path.startsWith('/')) return '/';
  return path
    .replace(/^\/results\/[\w-]+/, '/results/:id')
    .replace(/^\/(ballot|watchlist)\/[\w-]+/, '/$1/:id')
    .replace(/^\/go\/[\w-]+/, '/go/:link');
}

// Where a visit came from: a partner link, another site's host name, or direct.
function cleanSource(s) {
  const v = String(s || '')
    .toLowerCase()
    .trim();
  if (!v || v === 'direct') return 'Direct';
  if (v === 'partner') return 'Partner link';
  let host = v;
  try {
    if (v.includes('://')) host = new URL(v).hostname;
  } catch {
    host = '';
  }
  host = host
    .split('/')[0]
    .replace(/^www\./, '')
    .replace(/[^a-z0-9.-]/g, '')
    .slice(0, 80);
  if (/(^|\.)t\.co$|twitter\.com$|x\.com$/.test(host)) return 'X';
  if (/facebook\.com$|fb\.me$/.test(host)) return 'Facebook';
  if (/instagram\.com$/.test(host)) return 'Instagram';
  if (/threads\.(net|com)$/.test(host)) return 'Threads';
  if (/linkedin\.com$|lnkd\.in$/.test(host)) return 'LinkedIn';
  if (/google\./.test(host)) return 'Google';
  if (/bing\.com$|duckduckgo\.com$|yahoo\.com$/.test(host)) return 'Other search';
  if (/reddit\.com$/.test(host)) return 'Reddit';
  return host || 'Direct';
}

// staff: the visitor is a signed-in admin, or this device has been used by one.
export async function track(body, ip, ua, staff = false) {
  const kind = String(body?.kind || '');
  if (!KINDS.includes(kind) || BOTS.test(ua || '')) return false;
  const day = centralDay();
  await analytics.add({
    kind,
    day,
    path: cleanPath(body.path),
    source: kind === 'pageview' && body.source !== undefined ? cleanSource(body.source) : null,
    device: kind === 'pageview' ? device(ua || '') : null,
    visitor: visitorHash(ip, ua, day),
    staff: staff || body.staff === true,
  });
  return true;
}

// ---------- Overview ----------

const DAY_MS = 864e5;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS) + 1;

// Monday of the day's week, or the month.
function bucketOf(day, group) {
  if (group === 'month') return day.slice(0, 7);
  if (group === 'week') {
    const d = new Date(`${day}T12:00:00Z`);
    return addDays(day, -((d.getUTCDay() + 6) % 7));
  }
  return day;
}

function bucketKeys(from, to, group) {
  const keys = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketOf(d, group);
    if (keys.at(-1) !== k) keys.push(k);
  }
  return keys;
}

const count = (values) => {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return [...m].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count);
};
const rate = (n, d) => (d ? Math.min(100, Math.round((n / d) * 1000) / 10) : null);

// Rows whose UTC timestamp falls on a Central Time day in [from, to]. Rows
// without a readable timestamp are skipped rather than failing the page.
async function inCentralRange(fetch, from, to, masters = null) {
  const rows = await fetch(`${addDays(from, -1)}T00:00:00.000Z`, `${addDays(to, 2)}T00:00:00.000Z`, masters);
  return rows
    .map((r) => {
      const when = new Date(r.created_at || r.updated_at);
      return Number.isNaN(when.getTime()) ? null : { ...r, day: centralDay(when) };
    })
    .filter((r) => r && r.day >= from && r.day <= to);
}

const parse = (text, fallback) => {
  try {
    return JSON.parse(text) ?? fallback;
  } catch {
    return fallback;
  }
};

// masters is the list of master admin emails when admins are excluded, else null.
async function periodNumbers(from, to, masters) {
  const [events, users, results] = await Promise.all([
    analytics.daily(from, to, Boolean(masters)),
    inCentralRange(analytics.users, from, to, masters),
    inCentralRange(analytics.results, from, to, masters),
  ]);
  const sum = (kind, field = 'n') => events.filter((e) => e.kind === kind).reduce((n, e) => n + Number(e[field]), 0);
  return {
    events,
    users,
    results,
    kpis: {
      visitors: sum('pageview', 'visitors'),
      page_views: sum('pageview'),
      quiz_starts: sum('quiz_start', 'visitors'),
      sign_ups: users.length,
      quizzes_taken: results.length,
      quiz_takers: new Set(results.map((r) => r.user_id)).size,
      shares: sum('share'),
      polling_lookups: sum('vote_lookup'),
      ballots_printed: sum('print_ballot'),
    },
  };
}

export async function overview({ from, to, group = 'day', excludeAdmins = true }) {
  const masters = excludeAdmins ? config.adminEmails : null;
  const g = ['day', 'week', 'month'].includes(group) ? group : 'day';
  const now = await periodNumbers(from, to, masters);
  const span = daysBetween(from, to);
  const prev = await periodNumbers(addDays(from, -span), addDays(from, -1), masters);

  // Time series.
  const keys = bucketKeys(from, to, g);
  const blank = () => ({ visitors: 0, page_views: 0, quiz_starts: 0, sign_ups: 0, quizzes_taken: 0 });
  const series = new Map(keys.map((k) => [k, { bucket: k, ...blank() }]));
  for (const e of now.events) {
    const b = series.get(bucketOf(e.day, g));
    if (!b) continue;
    if (e.kind === 'pageview') {
      b.visitors += Number(e.visitors);
      b.page_views += Number(e.n);
    } else if (e.kind === 'quiz_start') b.quiz_starts += Number(e.visitors);
  }
  for (const u of now.users) series.get(bucketOf(u.day, g)) && (series.get(bucketOf(u.day, g)).sign_ups += 1);
  for (const r of now.results) series.get(bucketOf(r.day, g)) && (series.get(bucketOf(r.day, g)).quizzes_taken += 1);

  // Ballots: accounts whose plan changed in the range and holds picks or watched offices.
  const plans = (await inCentralRange(analytics.plansUpdated, from, to, masters)).map((p) => parse(p.plan_json, {}));
  const activeBallots = plans.filter((p) => p.starred_races?.length || Object.keys(p.picks || {}).length).length;

  // Combined quiz results for the range: each person's latest result.
  const latest = new Map();
  for (const r of now.results) latest.set(r.user_id, r);
  const parties = new Map();
  const closest = [];
  const issues = [];
  for (const r of latest.values()) {
    const res = parse(r.results_json, {});
    const scored = (res.parties || []).filter((p) => typeof p.score === 'number');
    for (const p of scored) {
      const e = parties.get(p.name) || { name: p.name, total: 0, n: 0 };
      e.total += p.score;
      e.n += 1;
      parties.set(p.name, e);
    }
    const best = [...scored].sort((a, b) => b.score - a.score)[0];
    if (best) closest.push(best.name);
    issues.push(...topIssues(parse(r.answers_json, {}), guide, 3));
  }

  const k = now.kpis;
  const [pages, sources, devices, totals] = await Promise.all([
    analytics.top('path', from, to, Boolean(masters)),
    analytics.top('source', from, to, Boolean(masters)),
    analytics.top('device', from, to, Boolean(masters)),
    analytics.totals(masters),
  ]);

  return {
    range: { from, to, group: g, days: span },
    exclude_admins: Boolean(masters),
    previous: { from: addDays(from, -span), to: addDays(from, -1) },
    kpis: { ...k, active_ballots: activeBallots },
    previous_kpis: prev.kpis,
    funnel: [
      { step: 'Visitors', count: k.visitors },
      { step: 'Started the quiz', count: k.quiz_starts, rate: rate(k.quiz_starts, k.visitors) },
      { step: 'Signed up', count: k.sign_ups, rate: rate(k.sign_ups, k.visitors) },
      { step: 'Finished the quiz', count: k.quiz_takers, rate: rate(k.quiz_takers, k.sign_ups) },
    ],
    series: [...series.values()],
    traffic: { pages, sources, devices },
    sign_ups: {
      county: count(now.users.map((u) => u.county)),
      age_range: count(now.users.map((u) => u.age_range)),
      method: count(now.users.map((u) => (Number(u.social) ? 'Google' : 'Email and password'))),
      source: count(now.users.map((u) => (u.partner_link_id ? 'Partner link' : 'Direct or other'))),
    },
    quiz: {
      people: latest.size,
      average_alignment: [...parties.values()]
        .map((p) => ({ name: p.name, average: Math.round(p.total / p.n) }))
        .sort((a, b) => b.average - a.average),
      closest_match: count(closest),
      top_issues: count(issues).slice(0, 13),
    },
    totals,
  };
}
