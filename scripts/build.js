// Prepares client/ for deployment: copies the shared modules the browser imports
// and the built guide data.
// data/guide.json is built separately (npm run build:data) and committed, so a
// deploy never changes the data version on its own.
//   node scripts/build.js

import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
cpSync(join(root, 'data/guide.json'), join(dataTarget, 'guide.json'));
// The county list offered to visitors is the set of counties with a loaded ballot.
const guide = JSON.parse(readFileSync(join(root, 'data/guide.json'), 'utf8'));
const { age_ranges } = JSON.parse(readFileSync(join(root, 'data/form-options.json'), 'utf8'));
writeFileSync(
  join(dataTarget, 'form-options.json'),
  JSON.stringify({ age_ranges, counties: Object.keys(guide.ballots || {}).sort() })
);
console.log('Copied shared/ to client/js/shared/ and guide data to client/data/');
