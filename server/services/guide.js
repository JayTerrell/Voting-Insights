// Loads the built candidate guide once per process. The data is read-only.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dataFile = (name) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));

export const guideJson = readFileSync(dataFile('guide.json'), 'utf8');
export const guide = JSON.parse(guideJson);
export const dataVersion = createHash('sha256').update(guideJson).digest('hex').slice(0, 12);
export const formOptions = JSON.parse(readFileSync(dataFile('form-options.json'), 'utf8'));
export const questionIds = new Set(guide.questions.map((q) => q.id));

export function raceTitle(race) {
  if (!race.county || race.title.includes(race.county)) return race.title;
  return `${race.title}, ${race.county} County`;
}
