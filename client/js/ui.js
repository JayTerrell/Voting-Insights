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
  document.title = t ? `${t} | Voting Insights` : 'Voting Insights: 2026 Texas Candidate Guide and Issue Quiz';
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

// A county picker for the guide pages. Lists counties with a loaded ballot,
// then every other Texas county (which shows statewide races only).
export function countyPicker(guide, allCounties, selected, id = 'ballot-county') {
  const loaded = Object.keys(guide.ballots || {}).sort();
  const others = (allCounties || []).filter((c) => !loaded.includes(c) && c !== 'Outside Texas');
  const opt = (c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(countyLabel(c))}</option>`;
  return `<label for="${id}">Show the ballot for</label>
    <select id="${id}">
      <optgroup label="Full ballot available">${loaded.map(opt).join('')}</optgroup>
      ${others.length ? `<optgroup label="Statewide races only">${others.map(opt).join('')}</optgroup>` : ''}
    </select>`;
}

export function ballotNote(guide, county) {
  if (guide.ballots && Object.hasOwn(guide.ballots, county)) return '';
  const loaded = Object.keys(guide.ballots || {})
    .map(countyLabel)
    .join(', ');
  return `<div class="callout" style="margin-bottom:16px">We have not loaded the full ${esc(countyLabel(county))} ballot yet, so only statewide races are shown. Full ballots are available for: ${esc(loaded)}.</div>`;
}
