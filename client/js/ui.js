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
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function setTitle(t) {
  document.title = t ? `${t} | VotersHub` : 'VotersHub: 2026 Texas Candidate Guide and Issue Quiz';
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

// The star next to an office adds it to the voter's watchlist. Clicks are
// handled once for the whole page in app.js.
export const watchLabel = (on, label) => `${on ? 'Stop watching' : 'Watch'} ${label}`;

export function watchButton(raceId, label) {
  const on = plan.isWatched(raceId);
  return `<button type="button" class="star-btn" data-watch="${esc(raceId)}" data-label="${esc(label)}" aria-pressed="${on}"
    aria-label="${esc(watchLabel(on, label))}" title="${on ? 'On your watchlist' : 'Watch this office'}"><svg viewBox="0 0 64 64" aria-hidden="true"><polygon points="32,6 39.1,25.7 60,25.7 43.4,38.1 49.6,58 32,46 14.4,58 20.6,38.1 4,25.7 24.9,25.7"/></svg></button>`;
}

// "Choose for my ballot" picks a candidate, the same as filling in their oval on My Ballot.
export function pickButton(race, c) {
  const on = plan.pickFor(race.id) === c.id;
  return `<button type="button" class="pick-btn" data-pick-race="${esc(race.id)}" data-pick-cand="${esc(c.id)}" aria-pressed="${on}">${
    on ? 'Your pick' : 'Choose for my ballot'
  }</button>`;
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
    return `<img class="cand-photo cand-photo-${size}" src="${esc(c.photo.url)}" alt="${esc(`Photo of ${c.name}`)}" title="${esc(`Photo: ${c.photo.credit}`)}" loading="lazy" decoding="async" width="${size === 'lg' ? 64 : 52}" height="${size === 'lg' ? 64 : 52}">`;
  }
  return `<span class="cand-photo cand-photo-${size} cand-initials" aria-hidden="true">${esc(initials(c.name))}</span>`;
}

// A small candidate card: photo, name, party, incumbency, and an optional quiz match.
export function miniCard(c, { match = null } = {}) {
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
  </div>`;
}

// Credit line for a candidate photo, linking to the page it came from.
export function photoCredit(c) {
  if (!c.photo) return '';
  return `<p class="photo-credit">Photo: <a href="${esc(c.photo.source_url)}" target="_blank" rel="noopener">${esc(c.photo.credit)}</a></p>`;
}

// A user's profile photo, or their initials when there is none.
export function avatarHtml(user, size = 'sm') {
  if (user?.avatar) return `<img class="avatar avatar-${size}" src="${esc(user.avatar)}" alt="">`;
  const letters = `${(user?.first_name || '?')[0]}${(user?.last_name || '')[0] || ''}`.toUpperCase();
  return `<span class="avatar avatar-${size} avatar-initials" aria-hidden="true">${esc(letters)}</span>`;
}

// ---------- Modal window ----------
// Closes with the X button, a click on the dimmed background, or Escape, and
// returns focus to whatever opened it. Only one modal is open at a time.

let openModalState = null;

export function closeModal() {
  if (!openModalState) return;
  const { root, opener, onClose, keyHandler } = openModalState;
  openModalState = null;
  document.removeEventListener('keydown', keyHandler, true);
  root.classList.add('closing');
  document.documentElement.classList.remove('modal-open');
  setTimeout(() => root.remove(), 180);
  onClose?.();
  opener?.focus?.({ preventScroll: true });
}

export function openModal({ title = '', label = '', wide = false, onClose } = {}) {
  closeModal();
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `<div class="modal-backdrop" data-close></div>
    <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label || title)}" tabindex="-1">
      <div class="modal-head">${title ? `<h2 class="modal-title">${esc(title)}</h2>` : '<span></span>'}
        <button type="button" class="modal-x" data-close aria-label="Close"><span aria-hidden="true"></span></button></div>
      <div class="modal-body"></div>
    </div>`;
  document.body.appendChild(root);
  document.documentElement.classList.add('modal-open');
  const dialog = root.querySelector('.modal');
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  const keyHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    // Keep Tab inside the dialog.
    if (e.key !== 'Tab') return;
    const items = [
      ...dialog.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', keyHandler, true);
  openModalState = { root, opener: document.activeElement, onClose, keyHandler };
  dialog.focus({ preventScroll: true });
  return { root, body: root.querySelector('.modal-body'), dialog, isOpen: () => openModalState?.root === root };
}
