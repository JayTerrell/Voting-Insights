// Loads the built candidate guide once per process. The data is read-only.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dataFile = (name) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));

export const guideJson = readFileSync(dataFile('guide.json'), 'utf8');
export const guide = JSON.parse(guideJson);
export const dataVersion = createHash('sha256').update(guideJson).digest('hex').slice(0, 12);
// Visitors may only choose counties whose full ballot is loaded.
export const servedCounties = Object.keys(guide.ballots || {}).sort();
export const formOptions = {
  age_ranges: JSON.parse(readFileSync(dataFile('form-options.json'), 'utf8')).age_ranges,
  counties: servedCounties,
};
export const questionIds = new Set(guide.questions.map((q) => q.id));
// Race id to the set of its candidate ids, for validating saved ballot plans.
export const raceCandidates = new Map(guide.races.map((r) => [r.id, new Set(r.candidates.map((c) => c.id))]));
export const candidateIds = new Set(guide.races.flatMap((r) => r.candidates.map((c) => c.id)));
export const candidateRace = new Map(guide.races.flatMap((r) => r.candidates.map((c) => [c.id, r.id])));

export function raceTitle(race) {
  if (!race.county || race.title.includes(race.county)) return race.title;
  return `${race.title}, ${race.county} County`;
}
