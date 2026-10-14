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
            (r) => `<a class="race-item" href="/candidates/${esc(r.id)}">
              <span class="office">${esc(raceTitle(r))}</span>
              <span class="names">${r.candidates.map((c) => `<span>${esc(c.name)} ${partyTag(c.party)}</span>`).join('')}</span>
              <span class="go">${r.candidates.length > 1 ? 'Compare' : 'View profile'}</span></a>`
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

function officeBox(race) {
  if (!race.office) return '';
  return `<div class="panel office-box">
    <div><h2 style="font-size:1.15rem">What this office does</h2><p style="margin:0">${esc(race.office.summary)}</p></div>
    <div><p class="sub" style="margin-top:0">Term</p><p style="margin:0">${esc(race.office.term)}</p>
    <p class="sub">Source</p><p class="small" style="margin:0"><a href="${esc(race.office.source.url)}" target="_blank" rel="noopener">${esc(race.office.source.title)}</a></p></div>
  </div>`;
}

function candidateCard(c, prefix, { full = false } = {}) {
  return `<article class="cand-card">
    <h3><a href="/candidate/${esc(c.id)}">${esc(c.name)}</a></h3>
    <div>${partyTag(c.party)} ${c.incumbent ? '<span class="tag tag-navy">Incumbent</span>' : ''}</div>
    ${c.current_role ? `<p class="role">${esc(c.current_role)}</p>` : ''}
    ${c.background ? `<p class="small">${esc(c.background)}</p>` : ''}
    ${c.website ? `<p class="small"><a href="${esc(c.website)}" target="_blank" rel="noopener">Campaign website</a></p>` : ''}
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

  view.innerHTML = `
    <p class="small"><a href="/candidates">All races</a></p>
    <span class="eyebrow">${cands.length > 1 ? 'Compare candidates' : 'Uncontested race'}</span>
    <h1>${esc(raceTitle(race))}</h1>
    ${race.statewide ? '<p class="small muted">On the ballot for every Texas voter.</p>' : race.county ? '' : '<p class="small muted">On the ballot only for voters who live in this district.</p>'}
    ${officeBox(race)}

    <div class="section-head"><h2>The candidates</h2><span class="small muted">Listed in ballot order</span></div>
    <div class="compare n${Math.min(cands.length, 4)}">${cands.map((c) => candidateCard(c, prefix(c))).join('')}</div>

    ${
      officeQs.length || extraQs.length
        ? `<div class="section-head"><h2>Positions on the issues</h2><span class="small muted">${cands
            .map((c) => `${esc(c.name)}: ${documented(c)} of ${officeQs.length}`)
            .join(' &middot; ')} documented. <a href="/scoring?race=${esc(race.id)}">Score sheet for this race</a></span></div>
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
        ? `<div class="section-head"><h2>Other issues</h2></div>
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

    <details class="sources-toggle" style="margin-top:36px">
      <summary>Sources (${cands.reduce((n, c) => n + c.sources.length, 0)})</summary>
      <div class="compare n${Math.min(cands.length, 4)}" style="margin-top:12px">${cands
        .map((c) => `<div class="panel sources"><h3 style="font-size:1rem">${esc(c.name)}</h3>${sourceList(c, prefix(c))}</div>`)
        .join('')}</div>
    </details>
    <p class="small muted" style="margin-top:16px">Position labels describe agreement with each statement as written. "No documented position" means we did not find a public vote, statement, questionnaire answer, or credible report. It does not mean the candidate has no view.</p>`;
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
    ${officeBox(race)}
    <div style="margin-top:20px">${candidateCard(c, prefix, { full: true })}</div>

    <div class="section-head"><h2>Documented positions</h2><span class="small muted">${stances.length} of ${guide.questions.length} quiz questions. <a href="/scoring?candidate=${esc(c.id)}">See in the score sheet</a></span></div>
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
