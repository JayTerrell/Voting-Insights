// Prepares client/ for deployment by copying shared modules the browser imports.
// data/guide.json is built separately (npm run build:data) and committed, so a
// deploy never changes the data version on its own.
//   node scripts/build.js

import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
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
console.log('Copied shared/ to client/js/shared/');
