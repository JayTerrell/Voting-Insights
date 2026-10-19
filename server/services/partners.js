// Partner links: votershub.info/go/<slug>. A signed-in person requests a slug,
// an admin approves it, and the link starts counting visits. People who sign up
// within 30 days of their first partner visit are credited to that link (the
// first link wins), and partners see totals for them, never individuals.

import { createHmac } from 'node:crypto';
import * as partners from '../db/repositories/partners.js';
import * as users from '../db/repositories/users.js';
import { config } from '../config.js';
import { guide } from './guide.js';
import { topIssues } from '../../shared/scoring.js';
import { sendPartnerReceived, sendPartnerApproved, sendPartnerRejected, sendPartnerAdminNotice } from './mailer.js';

export const MIN_GROUP = 10; // smallest group whose totals are shown
export const EVENT_KINDS = ['share', 'vote_lookup'];
const TZ = 'America/Chicago';

export class PartnerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- Slugs ----------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set(
  'admin administrator api go app www mail email help support about contact quiz results result candidates candidate issues parties party scoring profile settings account sign-in sign-up signin signup login logout my-ballot ballot where-to-vote am-i-registered privacy terms methodology votershub voters-hub official texas sos state county null undefined test partner partners staff team'.split(
    ' '
  )
);
// A short screen for words no partner link should carry. Admins review every request too.
const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'fag', 'retard', 'whore', 'slut', 'nazi', 'kkk', 'porn', 'rape'];

export const normalizeSlug = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();

export function slugProblem(slug) {
  if (slug.length < 3 || slug.length > 30) return 'Use 3 to 30 characters.';
  if (!SLUG_RE.test(slug)) return 'Use lowercase letters, numbers, and hyphens, starting and ending with a letter or number.';
  if (slug.includes('--')) return 'Use one hyphen at a time.';
  if (RESERVED.has(slug)) return 'That word is reserved for the site. Please choose another.';
  if (BLOCKED.some((w) => slug.replace(/-/g, '').includes(w))) return 'Please choose a different link.';
  return null;
}

export async function checkSlug(raw) {
  const slug = normalizeSlug(raw);
  const problem = slugProblem(slug);
  if (problem) return { slug, available: false, reason: problem };
  const taken = await partners.findBySlug(slug);
  if (taken && taken.status !== 'rejected') return { slug, available: false, reason: 'That link is already taken.' };
  return { slug, available: true };
}

// ---------- Requests and decisions ----------

const linkUrl = (slug) => `${config.publicUrl}/go/${slug}`;

export const publicLink = (l) =>
  l && {
    id: l.id,
    slug: l.slug,
    url: linkUrl(l.slug),
    reason: l.reason,
    status: l.status,
    note: l.status === 'rejected' ? l.note || null : null,
    created_at: l.created_at,
    decided_at: l.decided_at,
  };

const adminEmailList = async () => [
  ...new Set([...config.adminEmails, ...(await users.admins()).map((a) => a.email.toLowerCase())]),
];

// Mail never blocks the request or the decision.
const quietly = (p) => p.catch((err) => console.error('[partners] email failed', err.message));

export async function request(user, rawSlug, rawReason) {
  const reason = String(rawReason || '')
    .replace(/[<>\p{Cc}]/gu, '')
    .trim()
    .slice(0, 300);
  if (reason.length < 3) throw new PartnerError('Tell us briefly who you will share the link with.');
  const current = await partners.latestForUser(user.id);
  if (current && current.status !== 'rejected') {
    throw new PartnerError(
      current.status === 'approved' ? 'You already have a partner link.' : 'Your request is already being reviewed.',
      409
    );
  }
  const check = await checkSlug(rawSlug);
  if (!check.available) throw new PartnerError(check.reason, 409);
  await partners.removeRejected(check.slug);
  const link = await partners.create(user.id, check.slug, reason);
  await quietly(sendPartnerReceived(user.email, { firstName: user.first_name, url: linkUrl(link.slug) }));
  const admins = await adminEmailList();
  await quietly(
    Promise.all(
      admins.map((to) =>
        sendPartnerAdminNotice(to, {
          name: `${user.first_name} ${user.last_name}`,
          email: user.email,
          url: linkUrl(link.slug),
          reason,
          adminUrl: `${config.publicUrl}/admin`,
        })
      )
    )
  );
  return publicLink(link);
}

export async function decide(admin, id, approve, note) {
  const link = await partners.findById(id);
  if (!link) throw new PartnerError('That request no longer exists.', 404);
  if (link.status !== 'pending') throw new PartnerError(`That request was already ${link.status}.`, 409);
  const cleanNote = String(note || '')
    .replace(/[<>\p{Cc}]/gu, '')
    .trim()
    .slice(0, 300);
  const saved = await partners.decide(id, approve ? 'approved' : 'rejected', admin.id, cleanNote);
  const payload = {
    firstName: link.first_name,
    url: linkUrl(link.slug),
    note: cleanNote,
    profileUrl: `${config.publicUrl}/profile`,
  };
  await quietly(approve ? sendPartnerApproved(link.email, payload) : sendPartnerRejected(link.email, payload));
  return { ...publicLink(saved), owner: { name: `${link.first_name} ${link.last_name}`, email: link.email } };
}

export async function listForAdmin(status) {
  return (await partners.list(status)).map((l) => ({
    ...publicLink(l),
    owner: { name: `${l.first_name} ${l.last_name}`, email: l.email },
  }));
}

// ---------- Tracking ----------

export const centralDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// A one-way hash of the visitor's network address and browser, salted per day:
// it counts daily unique visitors and cannot be reversed or linked across days.
function visitorHash(ip, ua, day) {
  return createHmac('sha256', config.authSecret || 'votershub-visitors')
    .update(`${day}|${ip}|${ua}`)
    .digest('hex')
    .slice(0, 32);
}

const BOTS =
  /bot|crawl|spider|preview|facebookexternalhit|slack|discord|whatsapp|telegram|embedly|quora|pinterest|vkshare|skype|curl|wget|python|headless/i;

export async function recordVisit(slug, ip, ua) {
  const link = await partners.findBySlug(normalizeSlug(slug));
  if (!link || link.status !== 'approved') return null;
  if (!BOTS.test(ua || '')) {
    const day = centralDay();
    await partners.addEvent(link.id, 'visit', day, visitorHash(ip, ua, day));
  }
  return link.slug;
}

export async function recordEvent(slug, kind, ip, ua) {
  if (!EVENT_KINDS.includes(kind)) throw new PartnerError('Unknown event.');
  const link = await partners.findBySlug(normalizeSlug(slug));
  if (!link || link.status !== 'approved' || BOTS.test(ua || '')) return false;
  const day = centralDay();
  await partners.addEvent(link.id, kind, day, visitorHash(ip, ua, day));
  return true;
}

// Called at sign-up with the partner slug the browser remembered.
export async function attributeSignUp(userId, slug) {
  if (!slug) return;
  const link = await partners.findBySlug(normalizeSlug(slug));
  if (link?.status === 'approved' && link.user_id !== userId) await partners.attribute(userId, link.id);
}

export async function signUpNote(slug) {
  const link = slug ? await partners.findBySlug(normalizeSlug(slug)) : null;
  return link?.status === 'approved' ? { slug: link.slug, name: link.first_name } : null;
}

// ---------- Stats ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dateRange(from, to) {
  const end = DAY_RE.test(to || '') ? to : centralDay();
  const start = DAY_RE.test(from || '') ? from : '2026-01-01';
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

// Counts by value, with groups under MIN_GROUP folded into one line.
function buckets(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const shown = [];
  let hidden = 0;
  for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (count >= MIN_GROUP) shown.push({ name, count });
    else hidden += count;
  }
  return { rows: shown, hidden };
}

// Capped at 100: someone can sign up on a different device than the one that visited.
const pct = (n, d) => (d ? Math.min(100, Math.round((n / d) * 1000) / 10) : null);

export async function stats(linkId, range) {
  const { from, to } = range;
  const inRange = (iso) => {
    const d = centralDay(new Date(iso));
    return d >= from && d <= to;
  };
  const [events, members, results, plans] = await Promise.all([
    partners.events(linkId, from, to),
    partners.members(linkId),
    partners.memberResults(linkId),
    partners.memberPlans(linkId),
  ]);

  // Traffic, per day. Unique visitors are counted per day and summed.
  const days = new Map();
  for (const e of events) {
    if (e.kind !== 'visit') continue;
    const d = days.get(e.day) || { day: e.day, visits: 0, visitors: new Set() };
    d.visits += 1;
    d.visitors.add(e.visitor);
    days.set(e.day, d);
  }
  const daily = [...days.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({ day: d.day, visits: d.visits, unique_visitors: d.visitors.size }));
  const visits = daily.reduce((n, d) => n + d.visits, 0);
  const uniques = daily.reduce((n, d) => n + d.unique_visitors, 0);

  // People who signed up in the range, and what they did.
  const joined = members.filter((m) => inRange(m.created_at));
  const joinedIds = new Set(joined.map((m) => m.id));
  const latest = new Map();
  for (const r of results) if (joinedIds.has(r.user_id)) latest.set(r.user_id, r);
  const quizTakers = latest.size;
  const planRows = plans.filter((p) => joinedIds.has(p.user_id)).map((p) => JSON.parse(p.plan_json));
  const watched = planRows.reduce((n, p) => n + (p.starred_races?.length || 0), 0);
  const picks = planRows.reduce((n, p) => n + Object.keys(p.picks || {}).length, 0);
  const ballots = planRows.filter((p) => p.starred_races?.length || Object.keys(p.picks || {}).length).length;

  const out = {
    range: { from, to },
    min_group: MIN_GROUP,
    traffic: { visits, unique_visitors: uniques, daily },
    conversion: {
      sign_ups: joined.length,
      quiz_completions: quizTakers,
      sign_up_rate: pct(joined.length, uniques),
      quiz_rate: pct(quizTakers, joined.length),
    },
    engagement: {
      ballots_started: ballots,
      offices_watched: watched,
      candidates_picked: picks,
      results_shared: events.filter((e) => e.kind === 'share').length,
      polling_lookups: events.filter((e) => e.kind === 'vote_lookup').length,
    },
    audience: null,
    quiz: null,
  };

  // Audience and quiz totals only when the group is big enough that nobody stands out.
  if (joined.length >= MIN_GROUP) {
    out.audience = { county: buckets(joined.map((m) => m.county)), age_range: buckets(joined.map((m) => m.age_range)) };
  }
  if (quizTakers >= MIN_GROUP) {
    const parties = new Map();
    const closest = [];
    const issues = [];
    for (const r of latest.values()) {
      const res = JSON.parse(r.results_json);
      const scored = res.parties.filter((p) => p.score !== null);
      for (const p of scored) {
        const e = parties.get(p.name) || { name: p.name, total: 0, n: 0 };
        e.total += p.score;
        e.n += 1;
        parties.set(p.name, e);
      }
      const best = [...scored].sort((a, b) => b.score - a.score)[0];
      if (best) closest.push(best.name);
      issues.push(...topIssues(JSON.parse(r.answers_json), guide, 3));
    }
    out.quiz = {
      takers: quizTakers,
      average_alignment: [...parties.values()]
        .map((p) => ({ name: p.name, average: Math.round(p.total / p.n) }))
        .sort((a, b) => b.average - a.average),
      closest_match: buckets(closest),
      top_issues: buckets(issues),
    };
  }
  return out;
}

export async function summary(range) {
  const links = await partners.list('approved');
  return Promise.all(
    links.map(async (l) => {
      const s = await stats(l.id, range);
      return {
        ...publicLink(l),
        owner: { name: `${l.first_name} ${l.last_name}`, email: l.email },
        visits: s.traffic.visits,
        unique_visitors: s.traffic.unique_visitors,
        sign_ups: s.conversion.sign_ups,
        quiz_completions: s.conversion.quiz_completions,
        sign_up_rate: s.conversion.sign_up_rate,
      };
    })
  );
}
