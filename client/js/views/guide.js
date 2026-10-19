import {
  $,
  esc,
  setTitle,
  partyTag,
  cites,
  sourceList,
  scoreBadge,
  GROUPS,
  raceTitle,
  countyPicker,
  ballotNote,
  countyLabel,
  watchButton,
  pickButton,
  candidatePhoto,
  photoCredit,
} from '../ui.js';
import { loadGuide, loadFormOptions, ballotCounty } from '../api.js';
import { positionLabel, BASIS_LABEL, racesForCounty } from '../shared/scoring.js';

// ---------- Race list ----------

export async function renderGuide(view, _params, current) {
  setTitle('Candidate Guide');
  const [guide, options] = await Promise.all([loadGuide(), loadFormOptions()]);
  if (!current()) return;
  const qs = new URLSearchParams(location.search);
  let county = qs.get('county') || ballotCounty.get(guide);
  let group = qs.get('group') || 'all';
  let text = qs.get('q') || '';
  let contestedOnly = qs.get('contested') === '1';

  view.innerHTML = `
    <span class="eyebrow">Candidate Guide</span>
    <h1 id="guide-h">Every race on the ballot</h1>
    <p class="lede">Choose a race to compare its candidates side by side: what the office does, each candidate's priorities and promises, their record, and their documented positions, with links to every source.</p>
    <div class="filters" style="grid-template-columns:1fr">
      <div style="max-width:420px">${countyPicker(guide, options.counties, county)}</div>
    </div>
    <div id="ballot-note"></div>
    <div class="filters">
      <div>
        <label for="flt">Search by name or office</label>
        <input id="flt" type="search" placeholder="For example: Paxton, county judge, District 66" value="${esc(text)}">
      </div>
      <div>
        <label for="lvl">Level</label>
        <select id="lvl"><option value="all">All levels</option>${GROUPS.map((g) => `<option value="${g.id}" ${g.id === group ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select>
      </div>
    </div>
    <label class="check" style="margin-bottom:12px"><input type="checkbox" id="contested" ${contestedOnly ? 'checked' : ''}> <span>Show contested races only</span></label>
    <div id="race-out"></div>`;

  const out = $('#race-out', view);
  function draw() {
    const t = text.trim().toLowerCase();
    const onBallot = racesForCounty(guide, county);
    $('#guide-h', view).textContent = `Every race on the ${countyLabel(county)} ballot`;
    $('#ballot-note', view).innerHTML = ballotNote(guide, county);
    const html = GROUPS.filter((g) => group === 'all' || g.id === group)
      .map((g) => {
        const races = onBallot.filter(
          (r) =>
            r.group === g.id &&
            (!contestedOnly || r.candidates.length > 1) &&
            (!t || raceTitle(r).toLowerCase().includes(t) || r.candidates.some((c) => c.name.toLowerCase().includes(t)))
        );
        if (!races.length) return '';
        return `<h2 class="group-title">${esc(g.label)}</h2><div class="race-list">${races
          .map(
            (r) => `<div class="race-row">${watchButton(r.id, raceTitle(r))}<a class="race-item" href="/candidates/${esc(r.id)}">
              <span class="office">${esc(raceTitle(r))}</span>
              <span class="names">${r.candidates.map((c) => `<span>${esc(c.name)} ${partyTag(c.party)}</span>`).join('')}</span>
              <span class="go">${r.candidates.length > 1 ? 'Compare' : 'View profile'}</span></a></div>`
          )
          .join('')}</div>`;
      })
      .join('');
    out.innerHTML = html || '<p class="muted">No races match your search.</p>';
    const p = new URLSearchParams();
    p.set('county', county);
    if (group !== 'all') p.set('group', group);
    if (text) p.set('q', text);
    if (contestedOnly) p.set('contested', '1');
    history.replaceState({}, '', `/candidates${p.toString() ? '?' + p : ''}`);
  }
  $('#flt', view).addEventListener('input', (e) => {
    text = e.target.value;
    draw();
  });
  $('#ballot-county', view).addEventListener('change', (e) => {
    county = e.target.value;
    ballotCounty.set(county);
    draw();
  });
  $('#lvl', view).addEventListener('change', (e) => {
    group = e.target.value;
    draw();
  });
  $('#contested', view).addEventListener('change', (e) => {
    contestedOnly = e.target.checked;
    draw();
  });
  draw();
}

// ---------- Shared pieces ----------

function list(items, cand, prefix, empty) {
  if (!items.length) return `<p class="small muted">${esc(empty)}</p>`;
  return `<ul>${items.map((it) => `<li>${esc(it.text)}${cites(it.sources, cand, prefix)}</li>`).join('')}</ul>`;
}

function stanceCell(c, qid, prefix) {
  const s = c.stances[qid];
  if (!s) return '<span class="pos pos-none">No documented position</span>';
  return `<span class="pos">${scoreBadge(s.position)}${esc(positionLabel(s.position))}</span>${esc(s.summary)}${cites(s.sources, c, prefix)}
    <span class="basis">${esc(BASIS_LABEL[s.basis] || s.basis)}</span>`;
}

// What the office does: a short summary, two or three plain-language paragraphs,
// the main things it controls, the term, and an official source.
function officeBox(guide, race, num = null) {
  const office = guide.offices?.[race.office_key];
  if (!office) return '';
  return `<section class="office-box" aria-labelledby="office-h">
    <div class="office-main">
      <h2 id="office-h">${num ? `<span class="section-num" aria-hidden="true">${num}</span>` : ''}What this office does</h2>
      <p class="office-summary">${esc(office.summary)}</p>
      ${(office.about || []).map((t) => `<p>${esc(t)}</p>`).join('')}
    </div>
    <aside class="office-side">
      ${
        office.powers?.length
          ? `<h3>What it controls</h3><ul class="powers">${office.powers.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
          : ''
      }
      <dl class="office-facts">
        <dt>Term</dt><dd>${esc(office.term)}</dd>
        <dt>Source</dt><dd><a href="${esc(office.source.url)}" target="_blank" rel="noopener">${esc(office.source.title)}</a></dd>
      </dl>
    </aside>
  </section>`;
}

function candidateCard(c, prefix, { full = false, race = c.race } = {}) {
  return `<article class="cand-card" id="cand-${esc(c.id)}">
    <div class="cand-card-head">${candidatePhoto(c, 'lg')}<h3><a href="/candidate/${esc(c.id)}">${esc(c.name)}</a></h3></div>
    <div>${partyTag(c.party)} ${c.incumbent ? '<span class="tag tag-navy">Incumbent</span>' : ''}</div>
    ${race ? `<div class="pick-row">${pickButton(race, c)}</div>` : ''}
    ${c.current_role ? `<p class="role">${esc(c.current_role)}</p>` : ''}
    ${c.background ? `<p class="small">${esc(c.background)}</p>` : ''}
    ${c.website ? `<p class="small"><a href="${esc(c.website)}" target="_blank" rel="noopener">Campaign website</a></p>` : ''}
    ${
      c.researched === false
        ? '<p class="callout small" style="margin-top:12px">Research on this candidate is in progress. Their profile, positions, and sources will appear here soon.</p>'
        : `<details class="card-fold" open>
      <summary><span>Priorities, promises, and record</span><span class="fold-hint" aria-hidden="true"></span></summary>
      <div class="card-fold-body">
        <p class="sub">Priorities</p>${list(c.priorities, c, prefix, 'No stated priorities found.')}
        <p class="sub">Promises</p>${list(c.promises, c, prefix, 'No specific promises found.')}
        <p class="sub">Record</p>${list(c.record, c, prefix, 'No public record in office found.')}
        ${c.notes.length ? `<p class="sub">Notes</p>${list(c.notes, c, prefix, '')}` : ''}
        ${
          full && c.issue_notes.length
            ? `<p class="sub">Other positions</p><ul>${c.issue_notes
                .map((n) => `<li><b>${esc(n.topic)}:</b> ${esc(n.summary)}${cites(n.sources, c, prefix)}</li>`)
                .join('')}</ul>`
            : ''
        }
        ${c.research_gaps ? `<p class="small muted" style="margin-top:12px">Research gaps: ${esc(c.research_gaps)}</p>` : ''}
      </div>
    </details>`
    }
    ${photoCredit(c)}
  </article>`;
}

// ---------- Race comparison ----------

export async function renderRace(view, [raceId], current) {
  const guide = await loadGuide();
  if (!current()) return;
  const race = guide.races.find((r) => r.id === raceId);
  if (!race) {
    view.innerHTML = '<h1>Race not found</h1><p><a href="/candidates">Back to all races</a></p>';
    return;
  }
  setTitle(raceTitle(race));
  const cands = race.candidates;
  const officeQs = guide.questions.filter((q) => q.offices.includes(race.office_type));
  const extraQs = guide.questions.filter((q) => !q.offices.includes(race.office_type) && cands.some((c) => c.stances[q.id]));
  const prefix = (c) => `src-${c.id}`;

  const topics = [...new Set(cands.flatMap((c) => c.issue_notes.map((n) => n.topic)))].sort();

  const stanceRows = (qsList) =>
    qsList
      .map(
        (q) =>
          `<tr><th scope="row"><span class="cat">${esc(q.category)}</span>${esc(q.statement)}</th>${cands
            .map((c) => `<td data-label="${esc(c.name)}">${stanceCell(c, q.id, prefix(c))}</td>`)
            .join('')}</tr>`
      )
      .join('');

  const documented = (c) => officeQs.filter((q) => c.stances[q.id]).length;

  const sections = [
    { id: 'race-office', label: 'What this office does', short: 'The office', show: Boolean(guide.offices?.[race.office_key]) },
    { id: 'race-candidates', label: 'The candidates', short: 'Candidates', show: true },
    {
      id: 'race-positions',
      label: 'Positions on the issues',
      short: 'Positions',
      show: Boolean(officeQs.length || extraQs.length),
    },
    { id: 'race-other', label: 'Other issues', short: 'Other issues', show: topics.length > 0 },
    { id: 'race-sources', label: 'Sources', short: 'Sources', show: true },
  ].filter((x) => x.show);
  const head = (id, title, extra = '') => {
    const n = sections.findIndex((x) => x.id === id) + 1;
    return `<div class="section-head section-major" id="${id}"><h2><span class="section-num" aria-hidden="true">${n}</span>${esc(title)}</h2>${extra}</div>`;
  };

  view.innerHTML = `<div class="race-page">
    <p class="small race-back"><a href="/candidates">All races</a></p>
    <span class="eyebrow">${cands.length > 1 ? 'Compare candidates' : 'Uncontested race'}</span>
    <div class="title-row"><h1>${esc(raceTitle(race))}</h1>${watchButton(race.id, raceTitle(race))}</div>
    ${race.statewide ? '<p class="small muted">On the ballot for every Texas voter.</p>' : race.county ? '' : '<p class="small muted">On the ballot only for voters who live in this district.</p>'}

    <nav class="subnav race-nav" aria-label="On this page">
      <div class="subnav-links">${sections
        .map(
          (x) =>
            `<a href="#${x.id}" data-jump="${x.id}"><span class="long-label">${esc(x.label)}</span><span class="short-label">${esc(x.short)}</span></a>`
        )
        .join('')}</div>
      ${
        cands.length > 1
          ? `<div class="cand-jump" aria-label="Jump to a candidate">${cands
              .map(
                (c) =>
                  `<a href="#cand-${esc(c.id)}" data-jump="cand-${esc(c.id)}">${candidatePhoto(c)}<span>${esc(c.name.split(' ').slice(-1)[0])}</span></a>`
              )
              .join('')}</div>`
          : ''
      }
    </nav>

    ${guide.offices?.[race.office_key] ? `<div id="race-office" class="race-anchor">${officeBox(guide, race, 1)}</div>` : ''}

    ${head(
      'race-candidates',
      cands.length > 1 ? 'The candidates' : 'The candidate',
      `<span class="section-tools"><span class="small muted">Listed in ballot order</span>${
        cands.some((c) => c.researched !== false)
          ? '<button type="button" class="linkish" data-fold-all>Hide priorities and record</button>'
          : ''
      }</span>`
    )}
    <div class="compare n${Math.min(cands.length, 4)}">${cands.map((c) => candidateCard(c, prefix(c), { race })).join('')}</div>

    ${
      officeQs.length || extraQs.length
        ? `${head(
            'race-positions',
            'Positions on the issues',
            `<span class="small muted">${cands
              .map((c) => `${esc(c.name)}: ${documented(c)} of ${officeQs.length}`)
              .join(' &middot; ')} documented. <a href="/scoring">How scores work</a></span>`
          )}
      <div class="table-scroll"><table class="stance-table stack">
        <thead><tr><th>Statement</th>${cands.map((c) => `<th>${esc(c.name)}<br>${partyTag(c.party)}</th>`).join('')}</tr></thead>
        <tbody>${stanceRows(officeQs)}${
          extraQs.length
            ? `<tr><th colspan="${cands.length + 1}" style="background:var(--paper)"><b>Other questions these candidates addressed</b></th></tr>${stanceRows(extraQs)}`
            : ''
        }</tbody></table></div>`
        : ''
    }

    ${
      topics.length
        ? `${head('race-other', 'Other issues')}
      <div class="table-scroll"><table class="stance-table stack"><thead><tr><th>Topic</th>${cands.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>
      ${topics
        .map(
          (t) =>
            `<tr><th scope="row">${esc(t)}</th>${cands
              .map((c) => {
                const ns = c.issue_notes.filter((n) => n.topic === t);
                return `<td data-label="${esc(c.name)}">${ns.length ? ns.map((n) => `${esc(n.summary)}${cites(n.sources, c, prefix(c))}`).join('<br><br>') : '<span class="pos-none">Not addressed</span>'}</td>`;
              })
              .join('')}</tr>`
        )
        .join('')}</tbody></table></div>`
        : ''
    }

    ${head('race-sources', 'Sources')}
    <details class="sources-toggle">
      <summary>Show all ${cands.reduce((n, c) => n + c.sources.length, 0)} sources</summary>
      <div class="compare n${Math.min(cands.length, 4)}" style="margin-top:12px">${cands
        .map((c) => `<div class="panel sources"><h3 style="font-size:1rem">${esc(c.name)}</h3>${sourceList(c, prefix(c))}</div>`)
        .join('')}</div>
    </details>
    <p class="small muted" style="margin-top:16px">Position labels describe agreement with each statement as written. "No documented position" means we did not find a public vote, statement, questionnaire answer, or credible report. It does not mean the candidate has no view.</p>
  </div>`;

  const root = view.querySelector('.race-page');
  bindRacePage(root);
}

// Jump links, the menu highlight, and one switch that opens or closes every
// candidate's priorities and record together so the columns stay aligned.
// When the cards stack in one column (phones and small tablets), each card's
// priorities and record start closed and open on their own, and a row of
// candidate links in the menu jumps straight to each card.
const STACKED = '(max-width: 819px)';

function bindRacePage(root) {
  const inModal = Boolean(root.closest('.modal'));
  const stacked = window.matchMedia(STACKED).matches;
  const foldLabel = (open) => (open ? 'Hide priorities and record' : 'Show priorities and record');
  if (stacked) {
    root.querySelectorAll('.card-fold').forEach((f) => (f.open = false));
    const btn = root.querySelector('[data-fold-all]');
    if (btn) btn.textContent = foldLabel(false);
  }
  root.addEventListener('click', (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      e.preventDefault();
      const target = root.querySelector(`#${CSS.escape(jump.dataset.jump)}`);
      if (!target) return;
      if (jump.dataset.jump === 'race-sources') root.querySelector('.sources-toggle').open = true;
      const nav = root.querySelector('.race-nav');
      const scroller = inModal ? root.closest('.modal-body') : null;
      // Candidate cards get a little more room so their top rule clears the menu.
      const gap = jump.dataset.jump.startsWith('cand-') ? 24 : 12;
      const offset = (inModal ? 0 : document.querySelector('.masthead').offsetHeight) + nav.offsetHeight + gap;
      const smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      if (scroller) {
        const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset;
        scroller.scrollTo({ top, behavior: smooth });
      } else {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: smooth });
      }
      return;
    }
    const all = e.target.closest('[data-fold-all]');
    if (all) {
      const folds = [...root.querySelectorAll('.card-fold')];
      const open = !folds.every((f) => f.open);
      syncing = true;
      folds.forEach((f) => (f.open = open));
      syncing = false;
      all.textContent = foldLabel(open);
    }
  });
  let syncing = false;
  root.querySelectorAll('.card-fold').forEach((fold) =>
    fold.addEventListener('toggle', () => {
      if (syncing) return;
      const btn = root.querySelector('[data-fold-all]');
      if (window.matchMedia(STACKED).matches) {
        if (btn) btn.textContent = foldLabel([...root.querySelectorAll('.card-fold')].every((f) => f.open));
        return;
      }
      syncing = true;
      root.querySelectorAll('.card-fold').forEach((f) => (f.open = fold.open));
      syncing = false;
      if (btn) btn.textContent = foldLabel(fold.open);
    })
  );
  // Highlight the section on screen in the menu.
  const links = [...root.querySelectorAll('.race-nav a')];
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const group = entry.target.classList.contains('cand-card') ? '.cand-jump a' : '.subnav-links a';
        root
          .querySelectorAll(`.race-nav ${group}`)
          .forEach((a) => a.classList.toggle('current', a.dataset.jump === entry.target.id));
      }
    },
    { root: inModal ? root.closest('.modal-body') : null, rootMargin: '-30% 0px -60% 0px' }
  );
  links.forEach((a) => {
    const t = root.querySelector(`#${CSS.escape(a.dataset.jump)}`);
    if (t) spy.observe(t);
  });
}

// ---------- Single candidate ----------

export async function renderCandidate(view, [id], current) {
  const guide = await loadGuide();
  if (!current()) return;
  const c = guide.candidateIndex[id];
  if (!c) {
    view.innerHTML = '<h1>Candidate not found</h1><p><a href="/candidates">Back to all races</a></p>';
    return;
  }
  setTitle(c.name);
  const race = c.race;
  const prefix = `src-${c.id}`;
  const stances = guide.questions.filter((q) => c.stances[q.id]);
  const opponents = race.candidates.filter((o) => o.id !== c.id);

  view.innerHTML = `
    <p class="small"><a href="/candidates">All races</a> / <a href="/candidates/${esc(race.id)}">${esc(raceTitle(race))}</a></p>
    <span class="eyebrow">${esc(raceTitle(race))}</span>
    <h1 style="margin-bottom:6px">${esc(c.name)}</h1>
    <p>${partyTag(c.party)} ${c.incumbent ? '<span class="tag tag-navy">Incumbent</span>' : ''} ${
      opponents.length
        ? `<span class="small muted">Running against ${opponents.map((o) => `<a href="/candidate/${esc(o.id)}">${esc(o.name)}</a> (${esc(o.party)})`).join(', ')}</span>`
        : '<span class="small muted">Unopposed on the November ballot</span>'
    }</p>
    ${officeBox(guide, race)}
    <div style="margin-top:20px">${candidateCard(c, prefix, { full: true })}</div>

    <div class="section-head"><h2>Documented positions</h2><span class="small muted">${stances.length} of ${guide.questions.length} quiz questions. <a href="/scoring">How scores work</a></span></div>
    ${
      stances.length
        ? `<div class="table-scroll"><table class="stance-table"><thead><tr><th>Statement</th><th>Position</th></tr></thead><tbody>${stances
            .map(
              (q) =>
                `<tr><th scope="row"><span class="cat">${esc(q.category)}</span>${esc(q.statement)}</th><td>${stanceCell(c, q.id, prefix)}</td></tr>`
            )
            .join('')}</tbody></table></div>`
        : '<p class="muted">We did not find documented positions on the quiz questions for this candidate.</p>'
    }

    <div class="section-head"><h2>Sources</h2></div>
    <div class="panel sources">${sourceList(c, prefix)}</div>
    ${opponents.length ? `<p style="margin-top:20px"><a class="btn btn-ghost" href="/candidates/${esc(race.id)}">Compare with ${opponents.length > 1 ? 'opponents' : 'opponent'}</a></p>` : ''}`;
}
