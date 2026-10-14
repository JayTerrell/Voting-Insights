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

export function positionLabel(value) {
  const hit = SCALE.find((s) => s.value === value);
  return hit ? hit.label : 'No documented position';
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

// Builds the full result object from answers and the guide dataset.
export function scoreAll(answers, guide) {
  const answered = Object.keys(answers).filter((q) => validAnswer(answers[q]));

  const parties = guide.parties.map((p) => {
    const r = compare(answers, p.stances, answered);
    return { id: p.id, name: p.short, score: r.score, overlap: r.overlap };
  });

  const races = guide.races.map((race) => {
    const qids = guide.questions
      .filter((q) => q.offices.includes(race.office_type))
      .map((q) => q.id);
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
      uncontested: race.candidates.length === 1,
      questions: qids.length,
      top,
      tie,
      candidates,
    };
  });

  return { answered: answered.length, total: guide.questions.length, parties, races };
}
