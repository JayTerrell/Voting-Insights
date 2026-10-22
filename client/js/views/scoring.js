import { $, esc, setTitle, sourceLabel, formatScore, raceTitle, scoreBadge, questionHead } from '../ui.js';
import { loadGuide } from '../api.js';
import {
  AB_SCALE,
  abValue,
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
    'side_a',
    'side_b',
    'score_a_to_b',
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
      r.question.prompt,
      r.question.a,
      r.question.b,
      abValue(r.stance.position, r.question),
      positionLabel(r.stance.position, r.question),
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
  a.download = 'votershub-score-sheet.csv';
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
  ].map((e) => ({ ...e, ans: abValue(e.answer, e.q), pos: abValue(e.position, e.q) }));
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
        <td data-label="Your answer">${esc(positionLabel(e.answer, e.q))} (${formatScore(e.ans)})</td>
        <td data-label="Importance">${esc(IMPORTANCE.find((i) => i.value === e.weight).label)} (${e.weight})</td>
        <td data-label="Candidate position">${esc(positionLabel(e.position, e.q))} (${formatScore(e.pos)})</td>
        <td data-label="Evidence">${esc(BASIS_LABEL[e.basis])} (${BASIS_WEIGHT[e.basis]})</td>
        <td data-label="Agreement" class="num">1 - |${formatScore(e.ans)} - ${formatScore(e.pos)}| / 4 = ${fixed(agreement)}</td>
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

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// The page's three sections, in order. Each is collapsible and listed in the sticky menu.
const SECTIONS = [
  { id: 'how', label: 'How scoring works', short: 'How it works' },
  { id: 'party', label: 'Party platform scores', short: 'Party scores' },
  { id: 'offices', label: 'Which questions count for which office', short: 'Office questions' },
];

function section(id, title, body, { open = false, tools = '' } = {}) {
  return `<details class="fold" id="${id}" ${open ? 'open' : ''}>
    <summary><h2 id="${id}-h">${esc(title)}</h2><span class="fold-hint" aria-hidden="true"></span></summary>
    ${tools}
    <div class="fold-body">${body}</div>
  </details>`;
}

export async function renderScoring(view, _params, current) {
  setTitle('Scoring Logic');
  const guide = await loadGuide();
  if (!current()) return;

  const categories = [...new Set(guide.questions.map((q) => q.category))];

  const officeMatrix = guide.questions
    .map(
      (q) =>
        `<tr><th scope="row"><span class="cat">${esc(q.category)}</span>${esc(q.short)}</th>${OFFICE_COLUMNS.map(
          ([label, types]) =>
            `<td data-label="${esc(label)}" class="center">${types.some((t) => q.offices.includes(t)) ? 'Counts' : ''}</td>`
        ).join('')}</tr>`
    )
    .join('');

  // Party scores, grouped by issue category so the list can be jumped through.
  const partyCell = (p, q) => {
    const st = p.stances[q.id];
    if (!st) return `<td data-label="${esc(p.short)}"><span class="pos-none">Not addressed</span></td>`;
    const srcs = st.sources.map((id) => p.sources.find((x) => x.id === id)).filter(Boolean);
    return `<td data-label="${esc(p.short)}"><span class="pos">${scoreBadge(st.position, q)}${esc(positionLabel(st.position, q))}</span><span class="small">${esc(
      st.summary
    )}</span><span class="cites">Source: ${sourceLinks(srcs).replace(/<br>/g, ', ')}</span></td>`;
  };
  const partySheet = categories
    .map((cat) => {
      const qs = guide.questions.filter((q) => q.category === cat);
      return `<tbody class="cat-group" id="party-${slug(cat)}">
        <tr class="cat-row"><th colspan="${guide.parties.length + 1}" scope="rowgroup">${esc(cat)}</th></tr>
        ${qs
          .map(
            (q) =>
              `<tr id="party-q-${esc(q.id)}"><th scope="row">${questionHead(q)}</th>${guide.parties.map((p) => partyCell(p, q)).join('')}</tr>`
          )
          .join('')}</tbody>`;
    })
    .join('');

  const howBody = `
    <ol class="steps">
      <li><div><b>Every question offers two views, A and B.</b> Each is worded the way its own supporters would put it, and neither is presented as the right answer.</div></li>
      <li><div><b>Every candidate position gets a place on a five-step scale from A to B.</b> Researchers read the candidate's votes, statements, questionnaire answers, and news coverage, and record which view the candidate leans toward and how strongly. Every position links to its source. If nothing is documented, there is no position, and we never fill one in from a party label.</div></li>
      <li><div><b>Your answers use the same scale.</b> Strongly A counts as -2, Lean A as -1, In between as 0, Lean B as +1, and Strongly B as +2. You also rate how important each issue is to you. Skipped questions are left out.</div></li>
      <li><div><b>Each question you share with a candidate produces an agreement value from 0 to 1.</b> Identical positions give 1. Opposite extremes give 0. Each step apart on the scale lowers agreement by one quarter.</div></li>
      <li><div><b>Agreement values are averaged with weights.</b> Questions you marked important count more, and positions backed by stronger evidence count more. A neutral 50 percent starting point keeps a candidate with very few documented positions from showing an extreme score.</div></li>
      <li><div><b>Only questions tied to the office count for each race.</b> A Railroad Commission race uses energy and land questions; a county race uses county budget questions. Every candidate in a race is measured on the same set of questions.</div></li>
    </ol>
    <h3>The scales and weights</h3>
    <div class="scale-tables">
      <table class="ballot"><caption>Position on the A to B scale (answers and candidates)</caption>
        <thead><tr><th>Meaning</th><th class="num">Score</th></tr></thead>
        <tbody>${AB_SCALE.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${formatScore(x.value)}</td></tr>`).join('')}</tbody></table>
      <table class="ballot"><caption>How important the issue is to you</caption>
        <thead><tr><th>Your rating</th><th class="num">Weight</th></tr></thead>
        <tbody>${IMPORTANCE.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${i.value}</td></tr>`).join('')}</tbody></table>
    </div>
    <table class="ballot" style="margin-top:16px"><caption>Evidence behind a candidate's position</caption>
      <thead><tr><th>Evidence type</th><th>What it means</th><th class="num">Weight</th></tr></thead>
      <tbody>${Object.entries(BASIS_WEIGHT)
        .map(([k, v]) => `<tr><td>${esc(BASIS_LABEL[k])}</td><td>${esc(BASIS_MEANING[k])}</td><td class="num">${v}</td></tr>`)
        .join('')}</tbody></table>
    <h3>The formula</h3>
    <p class="formula">agreement = 1 - |your answer - candidate score| / 4</p>
    <p class="formula">weight = your importance rating x evidence weight</p>
    <p class="formula">match = (sum of weight x agreement + 0.5 x ${PRIOR_WEIGHT}) / (sum of weights + ${PRIOR_WEIGHT})</p>
    <p>The "+ 0.5 x ${PRIOR_WEIGHT}" and "+ ${PRIOR_WEIGHT}" terms are the neutral starting point: it acts like ${PRIOR_WEIGHT} extra questions of evidence sitting at exactly 50 percent. A match built on fewer than ${LIMITED_DATA_THRESHOLD} shared questions is labeled "limited data." The closest match in a race is the highest percentage; when the top two are within 3 points the race is marked as close.</p>
    <h3>Worked example</h3>
    <p>Suppose you answer three questions and a candidate has documented positions on all three:</p>
    ${workedExample(guide)}
    <h3>Check every score yourself</h3>
    <p>Each candidate's profile lists every documented position with where it sits from A to B, its evidence type, and a link to the exact source. To review all of them at once, download the full score sheet: every candidate, question, score, evidence type, and source link (${sheetRows(guide).length} rows).</p>
    <p><button class="btn btn-ghost btn-small" id="csv" type="button">Download the full score sheet (CSV)</button></p>`;

  const partyTools = `<div class="fold-tools" role="navigation" aria-label="Jump to an issue">
      <div class="chip-row">${categories
        .map((c) => `<a class="chip" href="#party-${slug(c)}" data-jump="party-${slug(c)}">${esc(c)}</a>`)
        .join('')}</div>
      <div class="jump-row">
        <label class="sr-only" for="party-jump">Jump to an issue</label>
        <select id="party-jump"><option value="">Jump to an issue</option>${categories
          .map(
            (c) =>
              `<optgroup label="${esc(c)}">${guide.questions
                .filter((q) => q.category === c)
                .map((q) => `<option value="party-q-${esc(q.id)}">${esc(q.short)}</option>`)
                .join('')}</optgroup>`
          )
          .join('')}</select>
        <a class="small" href="#party" data-jump="party">Section top</a>
      </div>
    </div>`;

  const partyBody = `
    <p>Party alignment compares your answers with each party's official Texas platform, using the same formula. Platforms used: ${guide.parties
      .map((p) => `<a href="${esc(p.platform_url || '#')}" target="_blank" rel="noopener">${esc(p.platform_title || p.name)}</a>`)
      .join('; ')}.</p>
    <div class="table-scroll"><table class="stance-table stack party-sheet">
      <thead><tr><th>Question</th>${guide.parties.map((p) => `<th>${esc(p.short)}</th>`).join('')}</tr></thead>
      ${partySheet}</table></div>`;

  const officeBody = `
    <p>A question counts toward a race only when that office has real power over the issue. Party alignment uses every question.</p>
    <div class="table-scroll"><table class="stance-table stack office-matrix">
      <thead><tr><th>Question</th>${OFFICE_COLUMNS.map(([l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${officeMatrix}</tbody></table></div>`;

  view.innerHTML = `<div id="scoring-root">
  <div class="prose" style="max-width:none">
    <span class="eyebrow">Scoring Logic</span>
    <h1>How every match percentage is calculated</h1>
    <p class="lede" style="max-width:46em">The exact rules behind the quiz, each party's score on every issue, and which questions count for each office. Open any section below, or use the menu to jump between them.</p>
  </div>
  <nav class="subnav" aria-label="On this page">
    <div class="subnav-links">${SECTIONS.map(
      (x) =>
        `<a href="#${x.id}" data-jump="${x.id}"><span class="long-label">${esc(x.label)}</span><span class="short-label">${esc(x.short)}</span></a>`
    ).join('')}</div>
    <div class="subnav-actions">
      <button type="button" class="linkish" id="fold-all">Expand all</button>
      <a href="#top" data-jump="top" class="subnav-top">Top</a>
    </div>
  </nav>
  ${section('how', 'How scoring works', howBody, { open: true })}
  ${section('party', 'Party platform scores', partyBody, { tools: partyTools })}
  ${section('offices', 'Which questions count for which office', officeBody)}
  </div>`;

  const root = $('#scoring-root', view);
  const folds = [...root.querySelectorAll('details.fold')];

  // Opening a section from the menu, a chip, or the issue list scrolls to it.
  function jump(id) {
    if (id === 'top') return window.scrollTo({ top: 0, behavior: 'smooth' });
    const target = document.getElementById(id);
    if (!target) return;
    const fold = target.closest('details.fold');
    if (fold && !fold.open) fold.open = true;
    // Land just below the sticky bars. The masthead compacts once the page scrolls,
    // so use its compact height when it has not compacted yet.
    const masthead = document.querySelector('.masthead');
    const mastheadH = document.body.classList.contains('scrolled') ? masthead.offsetHeight : window.innerWidth < 720 ? 100 : 58;
    const inIssues = target.closest('.party-sheet') !== null;
    const offset = mastheadH + $('.subnav', root).offsetHeight + (inIssues ? $('.fold-tools', root).offsetHeight : 0) + 8;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  root.addEventListener('click', (e) => {
    const link = e.target.closest('[data-jump]');
    if (!link) return;
    e.preventDefault();
    jump(link.dataset.jump);
  });
  $('#party-jump', root).addEventListener('change', (e) => {
    if (e.target.value) jump(e.target.value);
    e.target.value = '';
  });

  const foldAll = $('#fold-all', root);
  const syncFoldAll = () => {
    foldAll.textContent = folds.every((f) => f.open) ? 'Collapse all' : 'Expand all';
  };
  foldAll.addEventListener('click', () => {
    const open = !folds.every((f) => f.open);
    folds.forEach((f) => (f.open = open));
    syncFoldAll();
  });
  folds.forEach((f) => f.addEventListener('toggle', syncFoldAll));
  syncFoldAll();

  // The menu marks the section currently on screen.
  const links = [...root.querySelectorAll('.subnav-links a')];
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.classList.toggle('current', a.dataset.jump === entry.target.id));
      }
    },
    { rootMargin: '-35% 0px -60% 0px' }
  );
  folds.forEach((f) => spy.observe(f));

  // The issue chips mark the category currently on screen.
  const chips = [...root.querySelectorAll('.chip')];
  const chipRow = $('.chip-row', root);
  const markChip = (id) => {
    let active;
    chips.forEach((c) => {
      const on = c.dataset.jump === id;
      c.classList.toggle('current', on);
      if (on) active = c;
    });
    // On phones the chips scroll sideways; keep the current one in view.
    if (active && chipRow.scrollWidth > chipRow.clientWidth) {
      chipRow.scrollTo({ left: active.offsetLeft - chipRow.clientWidth / 2 + active.offsetWidth / 2, behavior: 'smooth' });
    }
  };
  root.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) markChip(chip.dataset.jump);
  });
  const chipSpy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) markChip(entry.target.id);
    },
    { rootMargin: '-40% 0px -55% 0px' }
  );
  root.querySelectorAll('.cat-group').forEach((g) => chipSpy.observe(g));

  // Jump targets land below the sticky menus, whatever their height.
  const tools = $('.fold-tools', root);
  const subnav = $('.subnav', root);
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      root.style.setProperty('--subnav-h', `${subnav.offsetHeight}px`);
      root.style.setProperty('--tools-h', `${tools.offsetHeight}px`);
    }).observe(root);
  }

  $('#csv', root).addEventListener('click', () => downloadCsv(sheetRows(guide)));

  // Links such as /scoring#party open that section.
  if (location.hash) requestAnimationFrame(() => jump(location.hash.slice(1)));
}
