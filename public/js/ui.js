// Small DOM and formatting helpers shared by every view.

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
  document.title = t ? `${t} | Voting Insights` : 'Voting Insights: Collin County 2026 Candidate Guide and Issue Quiz';
}

// Renders "[1]" style citation links pointing at a candidate's numbered sources.
export function cites(ids, cand, anchorPrefix) {
  if (!ids || !ids.length) return '';
  return ids
    .map((id) => {
      const n = cand.sources.findIndex((s) => s.id === id);
      if (n < 0) return '';
      const src = cand.sources[n];
      return `<sup class="cite"><a href="${esc(src.url)}" target="_blank" rel="noopener" title="${esc(src.title)}${src.publisher ? ' (' + esc(src.publisher) + ')' : ''}" data-anchor="${esc(anchorPrefix)}-${n + 1}">[${n + 1}]</a></sup>`;
    })
    .join('');
}

export function sourceList(cand, anchorPrefix) {
  if (!cand.sources.length) return '<p class="muted small">No sources recorded.</p>';
  return `<ol>${cand.sources
    .map(
      (s, i) =>
        `<li id="${esc(anchorPrefix)}-${i + 1}"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${
          s.publisher ? `, ${esc(s.publisher)}` : ''
        }${s.date ? `, ${esc(s.date)}` : ''}</li>`
    )
    .join('')}</ol>`;
}

export const GROUPS = [
  { id: 'federal', label: 'Federal' },
  { id: 'state', label: 'Statewide Offices' },
  { id: 'legislative', label: 'Texas Legislature' },
  { id: 'state-judicial', label: 'State Courts' },
  { id: 'county', label: 'Collin County Offices' },
  { id: 'county-judicial', label: 'Collin County Courts' },
];
