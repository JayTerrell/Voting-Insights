// Small DOM and formatting helpers shared by every view.

import { plan } from './api.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const STAR =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><polygon fill="currentColor" points="32,4 39.1,24.7 61,24.7 43.4,37.6 50.1,58.4 32,45.6 13.9,58.4 20.6,37.6 3,24.7 24.9,24.7"/></svg>';

export const starRule = () => `<div class="star-rule" aria-hidden="true">${STAR}</div>`;

export const PARTY_CLASS = { Republican: 'rep', Democratic: 'dem', Libertarian: 'lib', Green: 'grn' };

export function partyTag(party) {
  return `<span class="party party-${esc(party)}">${esc(party)}</span>`;
}

export function skeleton(kind = 'page') {
  if (kind === 'list') {
    return Array.from({ length: 6 }, () => '<span class="sk sk-line w80"></span><span class="sk sk-line w40"></span>').join('');
  }
  return `<span class="sk sk-title"></span><span class="sk sk-line w80"></span><span class="sk sk-line w60"></span>
    <span class="sk sk-block"></span><span class="sk sk-line w80"></span><span class="sk sk-line w40"></span><span class="sk sk-block"></span>`;
}

export function formatDate(iso, withTime = true) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  });
}

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function setTitle(t) {
  document.title = t ? `${t} | Voting Insights` : 'Voting Insights: 2026 Texas Candidate Guide and Issue Quiz';
}

export function sourceLabel(src) {
  if (src.publisher) return src.publisher;
  try {
    return new URL(src.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Source';
  }
}

// Renders the sources behind one claim as named links, for example
// "Source: Texas Tribune, capitol.texas.gov". Each link opens the exact page.
export function cites(ids, cand) {
  const srcs = (ids || []).map((id) => cand.sources.find((s) => s.id === id)).filter(Boolean);
  if (!srcs.length) return '';
  const links = srcs
    .map(
      (s) =>
        `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}${s.date ? ', ' + esc(s.date) : ''}">${esc(sourceLabel(s))}</a>`
    )
    .join(', ');
  return ` <span class="cites">Source${srcs.length > 1 ? 's' : ''}: ${links}</span>`;
}

// Shows a position on the -2 to +2 scale with its sign, for example "+2".
export const formatScore = (n) => (n > 0 ? `+${n}` : String(n));

export function scoreBadge(position) {
  return `<span class="score-badge" title="Position score on a scale from -2 (strongly disagree) to +2 (strongly agree)">Score ${esc(formatScore(position))}</span>`;
}

export function sourceList(cand) {
  if (!cand.sources.length) return '<p class="muted small">No sources recorded.</p>';
  return `<ol>${cand.sources
    .map(
      (s) =>
        `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${
          s.publisher ? `, ${esc(s.publisher)}` : ''
        }${s.date ? `, ${esc(s.date)}` : ''}<br><span class="url">${esc(s.url)}</span></li>`
    )
    .join('')}</ol>`;
}

export const GROUPS = [
  { id: 'federal', label: 'Federal' },
  { id: 'state', label: 'Statewide Offices' },
  { id: 'legislative', label: 'Texas Legislature' },
  { id: 'state-judicial', label: 'State Courts' },
  { id: 'county', label: 'County Offices' },
  { id: 'county-judicial', label: 'County and District Courts' },
];

// County-only offices get the county name so lists from several counties stay clear.
export function raceTitle(race) {
  if (!race.county || race.title.includes(race.county)) return race.title;
  return `${race.title}, ${race.county} County`;
}

export function countyLabel(county) {
  return /county$/i.test(county) || county === 'Outside Texas' ? county : `${county} County`;
}

// A county picker for the guide pages, listing every county with a loaded ballot.
export function countyPicker(guide, _allCounties, selected, id = 'ballot-county') {
  const loaded = Object.keys(guide.ballots || {}).sort();
  const opt = (c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(countyLabel(c))}</option>`;
  return `<label for="${id}">Show the ballot for</label>
    <select id="${id}">${loaded.map(opt).join('')}</select>`;
}

export function ballotNote(guide, county) {
  if (guide.ballots && Object.hasOwn(guide.ballots, county)) return '';
  const loaded = Object.keys(guide.ballots || {})
    .map(countyLabel)
    .join(', ');
  return `<div class="callout" style="margin-bottom:16px">We have not loaded the full ${esc(countyLabel(county))} ballot yet, so only statewide races are shown. Full ballots are available for: ${esc(loaded)}.</div>`;
}

// A star button that adds a race or candidate to the voter's shortlist. Clicks are
// handled once for the whole page in app.js.
export const starLabel = (on, label) => `${on ? 'Remove' : 'Add'} ${label} ${on ? 'from' : 'to'} your shortlist`;

export function starButton(kind, id, label) {
  const on = plan.isStarred(kind, id);
  return `<button type="button" class="star-btn" data-star="${kind}" data-id="${esc(id)}" data-label="${esc(label)}" aria-pressed="${on}"
    aria-label="${esc(starLabel(on, label))}" title="${on ? 'On your shortlist' : 'Add to your shortlist'}"><svg viewBox="0 0 64 64" aria-hidden="true"><polygon points="32,6 39.1,25.7 60,25.7 43.4,38.1 49.6,58 32,46 14.4,58 20.6,38.1 4,25.7 24.9,25.7"/></svg></button>`;
}

const initials = (name) =>
  name
    .replace(/["(].*?[")]/g, ' ')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(jr|sr|ii|iii|iv)\.?$/i.test(w))
    .map((w) => w[0].toUpperCase())
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join('');

// A candidate's photo when one is on file, otherwise their initials.
export function candidatePhoto(c, size = 'md') {
  if (c.photo && c.photo.url) {
    return `<img class="cand-photo cand-photo-${size}" src="${esc(c.photo.url)}" alt="" loading="lazy" decoding="async">`;
  }
  return `<span class="cand-photo cand-photo-${size} cand-initials" aria-hidden="true">${esc(initials(c.name))}</span>`;
}

// A small candidate card: photo, name, party, incumbency, and an optional quiz match.
export function miniCard(c, { match = null, star = true } = {}) {
  const matchChip =
    match && match.score !== null
      ? `<span class="match-chip" title="Your quiz match${match.limited ? ', based on limited data' : ''}">${match.score}% match</span>`
      : '';
  return `<div class="mini-card">
    ${candidatePhoto(c)}
    <div class="mini-body">
      <a class="mini-name" href="/candidate/${esc(c.id)}">${esc(c.name)}</a>
      <div class="mini-tags">${partyTag(c.party)}${c.incumbent ? '<span class="tag tag-navy">Incumbent</span>' : ''}${matchChip}</div>
    </div>
    ${star ? starButton('candidate', c.id, c.name) : ''}
  </div>`;
}
