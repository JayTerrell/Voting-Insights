// Prepares client/ for deployment: copies the shared modules the browser imports
// and the built guide data.
// data/guide.json is built separately (npm run build:data) and committed, so a
// deploy never changes the data version on its own.
//   node scripts/build.js

import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = join(root, 'client/js/shared');

if (!existsSync(join(root, 'data/guide.json'))) {
  console.error('data/guide.json is missing. Run "npm run build:data" first.');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(root, 'shared'), target, { recursive: true });

// The candidate guide is public and read-only, so it is served as a static
// file from the CDN. Guide pages then work even before the database is set up.
const dataTarget = join(root, 'client/data');
mkdirSync(dataTarget, { recursive: true });
// Published without indentation; the CDN compresses it further.
writeFileSync(join(dataTarget, 'guide.json'), JSON.stringify(JSON.parse(readFileSync(join(root, 'data/guide.json'), 'utf8'))));
// The county list offered to visitors is the set of counties with a loaded ballot.
const guide = JSON.parse(readFileSync(join(root, 'data/guide.json'), 'utf8'));
const { age_ranges } = JSON.parse(readFileSync(join(root, 'data/form-options.json'), 'utf8'));
writeFileSync(
  join(dataTarget, 'form-options.json'),
  JSON.stringify({ age_ranges, counties: Object.keys(guide.ballots || {}).sort() })
);
console.log('Copied shared/ to client/js/shared/ and guide data to client/data/');

// Polling places: one file per county plus a small index, published as static
// files. Geocoded by scripts/geocode-polling.py and refreshed during early voting.
const pollingSrc = join(root, 'data/polling');
const pollingTarget = join(dataTarget, 'polling');
rmSync(pollingTarget, { recursive: true, force: true });
mkdirSync(pollingTarget, { recursive: true });
const index = [];
if (existsSync(pollingSrc)) {
  for (const f of readdirSync(pollingSrc)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const county = JSON.parse(readFileSync(join(pollingSrc, f), 'utf8'));
    writeFileSync(join(pollingTarget, f), JSON.stringify(county));
    index.push({
      county: county.county,
      file: f,
      model: county.model,
      checked_at: county.checked_at,
      early_sites: county.early_voting?.sites?.length || 0,
      election_day_sites: county.election_day?.sites?.length || 0,
    });
  }
}
writeFileSync(
  join(pollingTarget, 'index.json'),
  JSON.stringify({ counties: index.sort((a, b) => a.county.localeCompare(b.county)) })
);
console.log(`Published polling places for ${index.length} counties`);
