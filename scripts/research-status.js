// Lists candidates that still need research, so new counties can be filled in.
//   node scripts/research-status.js [County]
// With a county name, only races on that county's ballot are listed.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const races = JSON.parse(readFileSync(join(root, 'data/races.json'), 'utf8'));
const researched = new Set();
const dir = join(root, 'data/research');
for (const f of existsSync(dir) ? readdirSync(dir) : []) {
  if (!f.endsWith('.json')) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8')).candidates || []) researched.add(c.id);
}

const county = process.argv[2];
let list = races;
if (county) {
  const file = join(root, 'data/ballots', county.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json');
  if (!existsSync(file)) {
    console.error(`No ballot imported for ${county}. Run scripts/import-ballot.js first.`);
    process.exit(1);
  }
  const ids = new Set(JSON.parse(readFileSync(file, 'utf8')).race_ids);
  list = races.filter((r) => ids.has(r.id));
}

let missing = 0;
for (const r of list) {
  const todo = r.candidates.filter((c) => !researched.has(c.id));
  if (!todo.length) continue;
  missing += todo.length;
  console.log(`${r.id}  (${r.title}${r.county ? ', ' + r.county + ' County' : ''})`);
  for (const c of todo) console.log(`    ${c.id}  ${c.name} (${c.party})`);
}
const total = list.reduce((n, r) => n + r.candidates.length, 0);
console.log(`\n${total - missing} of ${total} candidates researched, ${missing} remaining.`);
