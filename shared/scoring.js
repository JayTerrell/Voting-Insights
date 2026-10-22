// Shared scoring logic. Imported by the browser (quiz preview) and by the server
// (the stored, canonical result). Keep this file free of DOM and Node APIs.

export const SCALE = [
  { value: 2, label: 'Strongly agree' },
  { value: 1, label: 'Agree' },
  { value: 0, label: 'Neutral or mixed' },
  { value: -1, label: 'Disagree' },
  { value: -2, label: 'Strongly disagree' },
];

export const IMPORTANCE = [
  { value: 0.5, label: 'Less important' },
  { value: 1, label: 'Important' },
  { value: 2, label: 'Very important' },
];

// How much a documented position counts, by the kind of evidence behind it.
export const BASIS_WEIGHT = {
  record: 1,
  statement: 1,
  questionnaire: 1,
  platform: 1,
  reported: 0.85,
  inferred: 0.6,
};

export const BASIS_LABEL = {
  record: 'Official record',
  statement: 'Own statement',
  questionnaire: 'Questionnaire answer',
  platform: 'Party platform',
  reported: 'News reporting',
  inferred: 'Inferred from related positions',
};

// A neutral prior equal to this much evidence weight at 50 percent. It keeps a
// candidate with one documented answer from showing 0 or 100 percent.
export const PRIOR_WEIGHT = 1.5;

// Fewer overlapping questions than this marks a match as "limited data".
export const LIMITED_DATA_THRESHOLD = 3;

// Each question offers two views, A and B. Answers and positions are stored on
// one scale from -2 to +2, and q.agree names the side at +2, so a value maps to
// a side and a strength. This keeps every saved answer and documented position
// valid however the two sides are worded.
const sideOf = (value, q) => (value > 0 ? q.agree : q.agree === 'a' ? 'b' : 'a');

// The value stored for leaning toward one side, with strength 1 or 2.
export const sideValue = (q, side, strength) => (side === q.agree ? strength : -strength);

// The five answer choices, from strongly A to strongly B.
export function choices(q) {
  return [
    { value: sideValue(q, 'a', 2), label: 'Strongly A', side: 'a' },
    { value: sideValue(q, 'a', 1), label: 'Lean A', side: 'a' },
    { value: 0, label: 'In between or not sure', side: null },
    { value: sideValue(q, 'b', 1), label: 'Lean B', side: 'b' },
    { value: sideValue(q, 'b', 2), label: 'Strongly B', side: 'b' },
  ];
}

// A value on a common scale where Strongly A is -2 and Strongly B is +2, for
// explaining scores. Distances between values are the same on either scale.
export const abValue = (value, q) => (q.agree === 'b' ? value : -value);

export const AB_SCALE = [
  { value: -2, label: 'Strongly A' },
  { value: -1, label: 'Lean A' },
  { value: 0, label: 'In between or not sure' },
  { value: 1, label: 'Lean B' },
  { value: 2, label: 'Strongly B' },
];

// Where a value sits from A (0) to B (4), for drawing a five-step scale.
export const scaleStep = (value, q) => (q.agree === 'a' ? 2 - value : 2 + value);

export function positionLabel(value, q) {
  if (typeof value !== 'number' || value < -2 || value > 2) return 'No documented position';
  if (!q?.agree) {
    const hit = SCALE.find((s) => s.value === value);
    return hit ? hit.label : 'No documented position';
  }
  if (value === 0) return 'In between or mixed';
  const side = sideOf(value, q);
  const short = side === 'a' ? q.a_short : q.b_short;
  return `${Math.abs(value) === 2 ? 'Strongly' : 'Leans'} ${side.toUpperCase()}: ${short}`;
}

function validAnswer(a) {
  return a && typeof a.value === 'number' && a.value >= -2 && a.value <= 2;
}

// answers: { [questionId]: { value: -2..2, weight: 0.5|1|2 } }
// stances: { [questionId]: { position: -2..2, basis } }
// questionIds: optional list restricting which questions count.
export function compare(answers, stances, questionIds) {
  let num = 0;
  let den = 0;
  let overlap = 0;
  const ids = questionIds || Object.keys(answers || {});
  for (const qid of ids) {
    const a = answers[qid];
    const s = stances && stances[qid];
    if (!validAnswer(a) || !s || typeof s.position !== 'number') continue;
    const w = IMPORTANCE.some((i) => i.value === a.weight) ? a.weight : 1;
    const k = BASIS_WEIGHT[s.basis] ?? 0.6;
    const agreement = 1 - Math.abs(a.value - s.position) / 4;
    num += w * k * agreement;
    den += w * k;
    overlap += 1;
  }
  if (overlap === 0) return { score: null, overlap: 0, limited: true };
  const score = Math.round(((num + 0.5 * PRIOR_WEIGHT) / (den + PRIOR_WEIGHT)) * 100);
  return { score, overlap, limited: overlap < LIMITED_DATA_THRESHOLD };
}

// The races on a county's ballot, in ballot order. Counties whose ballot has
// not been imported get the statewide races every Texas voter sees.
export function racesForCounty(guide, county) {
  const ids = hasFullBallot(guide, county) ? guide.ballots[county] : null;
  if (!ids) return guide.races.filter((r) => r.statewide);
  const byId = new Map(guide.races.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export function hasFullBallot(guide, county) {
  return Boolean(guide.ballots && Object.hasOwn(guide.ballots, county) && Array.isArray(guide.ballots[county]));
}

// The three issue areas a voter cares most about, for the optional line on a
// shared result. Each answered question scores 60 percent on how important the
// voter said it is and 40 percent on how strongly they agreed or disagreed.
// Questions roll up to their issue area (Education, Health Care, and so on),
// so a share names topics only and never reveals how anyone answered.
export function topIssues(answers, guide, n = 3) {
  const areas = new Map();
  for (const q of guide.questions) {
    const a = answers[q.id];
    if (!validAnswer(a)) continue;
    const score = 0.6 * ((a.weight ?? 1) / 2) + 0.4 * (Math.abs(a.value) / 2);
    const area = areas.get(q.category) || { name: q.category, best: 0, total: 0 };
    area.best = Math.max(area.best, score);
    area.total += score;
    areas.set(q.category, area);
  }
  return [...areas.values()]
    .sort((x, y) => y.best - x.best || y.total - x.total || x.name.localeCompare(y.name))
    .slice(0, n)
    .map((x) => x.name);
}

// Builds the full result object from answers and the guide dataset.
export function scoreAll(answers, guide, county) {
  const answered = Object.keys(answers).filter((q) => validAnswer(answers[q]));

  const parties = guide.parties.map((p) => {
    const r = compare(answers, p.stances, answered);
    return { id: p.id, name: p.short, score: r.score, overlap: r.overlap };
  });

  const races = racesForCounty(guide, county).map((race) => {
    const qids = guide.questions.filter((q) => q.offices.includes(race.office_type)).map((q) => q.id);
    const candidates = race.candidates.map((c) => {
      const r = compare(answers, c.stances, qids);
      return { id: c.id, name: c.name, party: c.party, score: r.score, overlap: r.overlap, limited: r.limited };
    });
    const scored = candidates.filter((c) => c.score !== null);
    let top = null;
    let tie = false;
    if (race.candidates.length > 1 && scored.length) {
      const sorted = [...scored].sort((a, b) => b.score - a.score || b.overlap - a.overlap);
      top = sorted[0].id;
      tie = sorted.length > 1 && sorted[0].score - sorted[1].score < 3;
    }
    return {
      id: race.id,
      title: race.title,
      group: race.group,
      county: race.county || null,
      uncontested: race.candidates.length === 1,
      questions: qids.length,
      top,
      tie,
      candidates,
    };
  });

  return {
    answered: answered.length,
    total: guide.questions.length,
    county: county || null,
    full_ballot: hasFullBallot(guide, county),
    parties,
    races,
  };
}
