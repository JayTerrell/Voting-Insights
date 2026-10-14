import { $, esc, setTitle, partyTag, sourceLabel, formatScore, raceTitle, GROUPS } from '../ui.js';
import { loadGuide } from '../api.js';
import {
  SCALE,
  IMPORTANCE,
  BASIS_WEIGHT,
  BASIS_LABEL,
  PRIOR_WEIGHT,
  LIMITED_DATA_THRESHOLD,
  compare,
  positionLabel,
} from '../shared/scoring.js';

const BASIS_MEANING = {
  record: 'A vote, bill, ruling, or official action',
  statement: "The candidate's own words: website, speech, interview, debate, or social media",
  questionnaire: 'Answers to a voter guide or newspaper questionnaire',
  platform: "A party's official written platform (party scores only)",
  reported: 'Credible news reporting that describes the position',
  inferred: 'Derived from closely related documented positions or issue-group endorsements, never from party alone',
};

// Office groups shown as columns in the question-to-office table.
const OFFICE_COLUMNS = [
  ['U.S. Congress', ['us_senate', 'us_house']],
  ['Governor and Lt. Governor', ['governor', 'lt_governor']],
  ['Attorney General', ['attorney_general']],
  ['Comptroller', ['comptroller']],
  ['Land Commissioner', ['land_commissioner']],
  ['Agriculture', ['agriculture_commissioner']],
  ['Railroad Commission', ['railroad_commissioner']],
  ['Texas Legislature', ['state_senate', 'state_house']],
  ['County Judge and Commissioners', ['county_judge', 'county_commissioner']],
  ['District Attorney', ['district_attorney']],
  ['Judges', ['judicial']],
];

const fixed = (n) => (Math.round(n * 100) / 100).toString();

// Every documented candidate position as one flat row.
function sheetRows(guide) {
  const rows = [];
  for (const race of guide.races) {
    for (const c of race.candidates) {
      for (const q of guide.questions) {
        const s = c.stances[q.id];
        if (!s) continue;
        rows.push({
          order: rows.length,
          race,
          candidate: c,
          question: q,
          stance: s,
          sources: s.sources.map((id) => c.sources.find((x) => x.id === id)).filter(Boolean),
          counts: q.offices.includes(race.office_type),
        });
      }
    }
  }
  return rows;
}

function sourceLinks(sources) {
  return sources
    .map(
      (s) =>
        `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(sourceLabel(s))}</a>${
          s.date ? ` <span class="muted">(${esc(s.date)})</span>` : ''
        }`
    )
    .join('<br>');
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows) {
  const header = [
    'race',
    'candidate',
    'party',
    'question_id',
    'question',
    'score',
    'position',
    'evidence',
    'evidence_weight',
    'counts_for_this_office',
    'summary',
    'source_titles',
    'source_urls',
  ];
  const lines = rows.map((r) =>
    [
      raceTitle(r.race),
      r.candidate.name,
      r.candidate.party,
      r.question.id,
      r.question.statement,
      r.stance.position,
      positionLabel(r.stance.position),
      BASIS_LABEL[r.stance.basis] || r.stance.basis,
      BASIS_WEIGHT[r.stance.basis] ?? '',
      r.counts ? 'yes' : 'no',
      r.stance.summary,
      r.sources.map((s) => s.title).join(' | '),
      r.sources.map((s) => s.url).join(' | '),
    ]
      .map(csvCell)
      .join(',')
  );
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'voting-insights-score-sheet.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function workedExample(guide) {
  const q = (id) => guide.questions.find((x) => x.id === id);
  const example = [
    { q: q('q_school_funding'), answer: 2, weight: 2, position: 1, basis: 'record' },
    { q: q('q_vouchers'), answer: -1, weight: 1, position: 2, basis: 'statement' },
    { q: q('q_water'), answer: 1, weight: 0.5, position: 1, basis: 'reported' },
  ];
  const answers = {};
  const stances = {};
  let num = 0;
  let den = 0;
  const rows = example
    .map((e) => {
      answers[e.q.id] = { value: e.answer, weight: e.weight };
      stances[e.q.id] = { position: e.position, basis: e.basis };
      const agreement = 1 - Math.abs(e.answer - e.position) / 4;
      const w = e.weight * BASIS_WEIGHT[e.basis];
      num += w * agreement;
      den += w;
      return `<tr>
        <td data-label="Question">${esc(e.q.short)}</td>
        <td data-label="Your answer">${esc(positionLabel(e.answer))} (${formatScore(e.answer)})</td>
        <td data-label="Importance">${esc(IMPORTANCE.find((i) => i.value === e.weight).label)} (${e.weight})</td>
        <td data-label="Candidate position">${esc(positionLabel(e.position))} (${formatScore(e.position)})</td>
        <td data-label="Evidence">${esc(BASIS_LABEL[e.basis])} (${BASIS_WEIGHT[e.basis]})</td>
        <td data-label="Agreement" class="num">1 - |${formatScore(e.answer)} - ${formatScore(e.position)}| / 4 = ${fixed(agreement)}</td>
        <td data-label="Weight" class="num">${e.weight} x ${BASIS_WEIGHT[e.basis]} = ${fixed(w)}</td>
        <td data-label="Weighted agreement" class="num">${fixed(w * agreement)}</td>
      </tr>`;
    })
    .join('');
  const result = compare(answers, stances);
  const manual = Math.round(((num + 0.5 * PRIOR_WEIGHT) / (den + PRIOR_WEIGHT)) * 100);
  return `
    <div class="table-scroll"><table class="stance-table stack">
      <thead><tr><th>Question</th><th>Your answer</th><th>Importance</th><th>Candidate position</th><th>Evidence</th><th>Agreement</th><th>Weight</th><th>Weighted agreement</th></tr></thead>
      <tbody>${rows}
        <tr><th scope="row" colspan="6"><b>Totals</b></th><td data-label="Total weight" class="num"><b>${fixed(den)}</b></td><td data-label="Total weighted agreement" class="num"><b>${fixed(num)}</b></td></tr>
      </tbody>
    </table></div>
    <p class="formula" style="margin-top:14px">match = (${fixed(num)} + 0.5 x ${PRIOR_WEIGHT}) / (${fixed(den)} + ${PRIOR_WEIGHT}) = ${fixed(num + 0.5 * PRIOR_WEIGHT)} / ${fixed(den + PRIOR_WEIGHT)} = <b>${manual}%</b></p>
    <p class="small muted">This example is calculated live by the same code the quiz uses (result: ${result.score}%). Matches built on fewer than ${LIMITED_DATA_THRESHOLD} shared questions are labeled "limited data." This example shares three, so it is not.</p>`;
}

export async function renderScoring(view, _params, current) {
  setTitle('Scoring Logic');
  const guide = await loadGuide();
  if (!current()) return;
  const params = new URLSearchParams(location.search);
  const filters = {
    race: params.get('race') || '',
    candidate: params.get('candidate') || '',
    question: params.get('question') || '',
    basis: params.get('basis') || '',
    text: params.get('q') || '',
  };
  const allRows = sheetRows(guide);

  const officeMatrix = guide.questions
    .map(
      (q) =>
        `<tr><th scope="row"><span class="cat">${esc(q.category)}</span>${esc(q.short)}</th>${OFFICE_COLUMNS.map(
          ([label, types]) =>
            `<td data-label="${esc(label)}" class="center">${types.some((t) => q.offices.includes(t)) ? 'Counts' : ''}</td>`
        ).join('')}</tr>`
    )
    .join('');

  const partySheet = guide.questions
    .map(
      (q) =>
        `<tr><th scope="row"><span class="cat">${esc(q.category)}</span>${esc(q.short)}</th>${guide.parties
          .map((p) => {
            const s = p.stances[q.id];
            if (!s) return `<td data-label="${esc(p.short)}"><span class="pos-none">Not addressed</span></td>`;
            const srcs = s.sources.map((id) => p.sources.find((x) => x.id === id)).filter(Boolean);
            return `<td data-label="${esc(p.short)}"><span class="score-badge">Score ${formatScore(s.position)}</span><span class="small">${esc(
              s.summary
            )}</span><span class="cites">Source: ${sourceLinks(srcs).replace(/<br>/g, ', ')}</span></td>`;
          })
          .join('')}</tr>`
    )
    .join('');

  const candidateOptions = guide.races
    .flatMap((r) => r.candidates.map((c) => ({ c, r })))
    .sort((a, b) => a.c.name.localeCompare(b.c.name))
    .map(({ c, r }) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(raceTitle(r))})</option>`)
    .join('');

  view.innerHTML = `
  <div class="prose" style="max-width:none">
    <span class="eyebrow">Scoring Logic</span>
    <h1>How every match percentage is calculated</h1>
    <p class="lede" style="max-width:46em">This page shows the exact rules behind the quiz, the score assigned to every candidate on every issue, and the page each score came from, so anyone can check the work.</p>
  </div>

  <section aria-labelledby="steps-h">
    <div class="section-head"><h2 id="steps-h">The five steps</h2></div>
    <ol class="steps">
      <li><div><b>Every candidate position gets a score from -2 to +2.</b> Researchers read the candidate's votes, statements, questionnaire answers, and news coverage, and record how strongly the candidate agrees with each quiz statement. Every score links to its source. If nothing is documented, there is no score, and we never fill one in from a party label.</div></li>
      <li><div><b>Your answers use the same scale.</b> Strongly agree is +2 and Strongly disagree is -2. You also rate how important each issue is to you. Skipped questions are left out.</div></li>
      <li><div><b>Each question you share with a candidate produces an agreement value from 0 to 1.</b> Identical positions give 1. Opposite extremes give 0. Each step apart on the scale lowers agreement by one quarter.</div></li>
      <li><div><b>Agreement values are averaged with weights.</b> Questions you marked important count more, and positions backed by stronger evidence count more. A neutral 50 percent starting point keeps a candidate with very few documented positions from showing an extreme score.</div></li>
      <li><div><b>Only questions tied to the office count for each race.</b> A Railroad Commission race uses energy and land questions; a county race uses county budget questions. Every candidate in a race is measured on the same set of questions.</div></li>
    </ol>
  </section>

  <section aria-labelledby="scales-h">
    <div class="section-head"><h2 id="scales-h">The scales and weights</h2></div>
    <div class="scale-tables">
      <table class="ballot"><caption>Position score (answers and candidates)</caption>
        <thead><tr><th>Meaning</th><th class="num">Score</th></tr></thead>
        <tbody>${SCALE.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${formatScore(s.value)}</td></tr>`).join('')}</tbody></table>
      <table class="ballot"><caption>How important the issue is to you</caption>
        <thead><tr><th>Your rating</th><th class="num">Weight</th></tr></thead>
        <tbody>${IMPORTANCE.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${i.value}</td></tr>`).join('')}</tbody></table>
    </div>
    <table class="ballot" style="margin-top:16px"><caption>Evidence behind a candidate's position</caption>
      <thead><tr><th>Evidence type</th><th>What it means</th><th class="num">Weight</th></tr></thead>
      <tbody>${Object.entries(BASIS_WEIGHT)
        .map(([k, v]) => `<tr><td>${esc(BASIS_LABEL[k])}</td><td>${esc(BASIS_MEANING[k])}</td><td class="num">${v}</td></tr>`)
        .join('')}</tbody></table>
  </section>

  <section aria-labelledby="formula-h">
    <div class="section-head"><h2 id="formula-h">The formula</h2></div>
    <p class="formula">agreement = 1 - |your answer - candidate score| / 4</p>
    <p class="formula">weight = your importance rating x evidence weight</p>
    <p class="formula">match = (sum of weight x agreement + 0.5 x ${PRIOR_WEIGHT}) / (sum of weights + ${PRIOR_WEIGHT})</p>
    <p>The "+ 0.5 x ${PRIOR_WEIGHT}" and "+ ${PRIOR_WEIGHT}" terms are the neutral starting point: it acts like ${PRIOR_WEIGHT} extra questions of evidence sitting at exactly 50 percent. A match built on fewer than ${LIMITED_DATA_THRESHOLD} shared questions is labeled "limited data." The closest match in a race is the highest percentage; when the top two are within 3 points the race is marked as close.</p>
    <h3 style="margin-top:24px">Worked example</h3>
    <p>Suppose you answer three questions and a candidate has documented positions on all three:</p>
    ${workedExample(guide)}
  </section>

  <section aria-labelledby="offices-h">
    <div class="section-head"><h2 id="offices-h">Which questions count for which office</h2></div>
    <p>A question counts toward a race only when that office has real power over the issue. Party alignment uses every question.</p>
    <div class="table-scroll"><table class="stance-table stack office-matrix">
      <thead><tr><th>Question</th>${OFFICE_COLUMNS.map(([l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${officeMatrix}</tbody></table></div>
  </section>

  <section aria-labelledby="party-h">
    <div class="section-head"><h2 id="party-h">Party platform scores</h2></div>
    <p>Party alignment compares your answers with each party's official Texas platform, using the same formula. Platforms used: ${guide.parties
      .map((p) => `<a href="${esc(p.platform_url || '#')}" target="_blank" rel="noopener">${esc(p.platform_title || p.name)}</a>`)
      .join('; ')}.</p>
    <div class="table-scroll"><table class="stance-table stack">
      <thead><tr><th>Question</th>${guide.parties.map((p) => `<th>${esc(p.short)}</th>`).join('')}</tr></thead>
      <tbody>${partySheet}</tbody></table></div>
  </section>

  <section aria-labelledby="sheet-h">
    <div class="section-head"><h2 id="sheet-h">Candidate score sheet</h2><button class="btn btn-ghost btn-small" id="csv">Download as CSV</button></div>
    <p>Every documented candidate position, its score, the kind of evidence, and the exact page it came from. Select a source to open it and check it yourself.</p>
    <div class="sheet-filters">
      <div><label for="f-race">Race</label><select id="f-race"><option value="">All races</option>${GROUPS.map(
        (g) =>
          `<optgroup label="${esc(g.label)}">${guide.races
            .filter((r) => r.group === g.id)
            .map((r) => `<option value="${esc(r.id)}">${esc(raceTitle(r))}</option>`)
            .join('')}</optgroup>`
      ).join('')}</select></div>
      <div><label for="f-cand">Candidate</label><select id="f-cand"><option value="">All candidates</option>${candidateOptions}</select></div>
      <div><label for="f-q">Question</label><select id="f-q"><option value="">All questions</option>${guide.questions
        .map((q) => `<option value="${esc(q.id)}">${esc(q.short)}</option>`)
        .join('')}</select></div>
      <div><label for="f-basis">Evidence</label><select id="f-basis"><option value="">All evidence types</option>${Object.keys(
        BASIS_WEIGHT
      )
        .filter((k) => k !== 'platform')
        .map((k) => `<option value="${k}">${esc(BASIS_LABEL[k])}</option>`)
        .join('')}</select></div>
      <div><label for="f-text">Search</label><input id="f-text" type="search" placeholder="Name or word"></div>
    </div>
    <p class="small muted" id="sheet-count" aria-live="polite"></p>
    <div class="table-scroll"><table class="stance-table stack score-sheet">
      <thead><tr><th>Candidate</th><th>Question</th><th>Score</th><th>Evidence</th><th>What the record shows</th><th>Source</th></tr></thead>
      <tbody id="sheet-body"></tbody></table></div>
  </section>

  <section aria-labelledby="coverage-h">
    <div class="section-head"><h2 id="coverage-h">Coverage by candidate</h2></div>
    <p>How many of the questions that count for each office have a documented position. Low coverage means a candidate's match percentage rests on less evidence.</p>
    <table class="ballot" id="coverage"><thead><tr><th>Race</th><th>Candidate</th><th class="num">Documented</th><th class="num">Sources</th></tr></thead><tbody>${guide.races
      .flatMap((r) => {
        const n = guide.questions.filter((q) => q.offices.includes(r.office_type)).length;
        return r.candidates.map(
          (
            c
          ) => `<tr><td>${esc(raceTitle(r))}</td><td><a href="/candidate/${esc(c.id)}">${esc(c.name)}</a> ${partyTag(c.party)}</td>
            <td class="num">${guide.questions.filter((q) => q.offices.includes(r.office_type) && c.stances[q.id]).length} of ${n}</td>
            <td class="num">${c.sources.length}</td></tr>`
        );
      })
      .join('')}</tbody></table>
  </section>`;

  const ids = { race: '#f-race', candidate: '#f-cand', question: '#f-q', basis: '#f-basis', text: '#f-text' };
  for (const [k, sel] of Object.entries(ids)) $(sel, view).value = filters[k];

  function filtered() {
    const t = filters.text.trim().toLowerCase();
    return allRows
      .filter(
        (r) =>
          (!filters.race || r.race.id === filters.race) &&
          (!filters.candidate || r.candidate.id === filters.candidate) &&
          (!filters.question || r.question.id === filters.question) &&
          (!filters.basis || r.stance.basis === filters.basis) &&
          (!t || `${r.candidate.name} ${r.question.statement} ${r.stance.summary} ${raceTitle(r.race)}`.toLowerCase().includes(t))
      )
      .sort((a, b) => a.order - b.order);
  }

  function draw() {
    const rows = filtered();
    $('#sheet-count', view).textContent = `${rows.length} of ${allRows.length} documented positions shown.`;
    $('#sheet-body', view).innerHTML = rows.length
      ? rows
          .map(
            (r) => `<tr>
          <th scope="row"><a href="/candidate/${esc(r.candidate.id)}"><b>${esc(r.candidate.name)}</b></a><br>${partyTag(r.candidate.party)}<br><span class="small muted">${esc(raceTitle(r.race))}</span></th>
          <td data-label="Question">${esc(r.question.short)}${r.counts ? '' : '<br><span class="small muted">Not counted for this office</span>'}</td>
          <td data-label="Score"><span class="score-badge">${formatScore(r.stance.position)}</span><br><span class="small">${esc(positionLabel(r.stance.position))}</span></td>
          <td data-label="Evidence">${esc(BASIS_LABEL[r.stance.basis] || r.stance.basis)}<br><span class="small muted">weight ${BASIS_WEIGHT[r.stance.basis] ?? ''}</span></td>
          <td data-label="What the record shows">${esc(r.stance.summary)}</td>
          <td data-label="Source">${sourceLinks(r.sources)}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="muted">No documented positions match these filters.</td></tr>';
    const p = new URLSearchParams();
    for (const k of ['race', 'candidate', 'question', 'basis']) if (filters[k]) p.set(k, filters[k]);
    if (filters.text) p.set('q', filters.text);
    history.replaceState({}, '', `/scoring${p.toString() ? '?' + p : ''}`);
  }

  for (const [k, sel] of Object.entries(ids)) {
    $(sel, view).addEventListener(k === 'text' ? 'input' : 'change', (e) => {
      filters[k] = e.target.value;
      draw();
    });
  }
  $('#csv', view).addEventListener('click', () => downloadCsv(filtered()));
  draw();
  if (filters.race || filters.candidate || filters.question) $('#sheet-h', view).scrollIntoView({ block: 'start' });
}
