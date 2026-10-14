// Checks every source URL in data/guide.json and reports the ones that fail.
//   node scripts/check-links.js [--json out.json]
// Uses curl so it respects HTTPS_PROXY and system certificates.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

const guide = JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/guide.json'), 'utf8'));
const urls = new Map();
const add = (url, where) => {
  if (!urls.has(url)) urls.set(url, []);
  urls.get(url).push(where);
};
for (const r of guide.races) {
  if (r.office) add(r.office.source.url, `office:${r.id}`);
  for (const c of r.candidates) {
    for (const s of c.sources) add(s.url, `${c.id}:${s.id}`);
    if (c.website) add(c.website, `${c.id}:website`);
  }
}
for (const p of guide.parties) {
  for (const s of p.sources) add(s.url, `party:${p.id}:${s.id}`);
  if (p.platform_url) add(p.platform_url, `party:${p.id}:platform`);
}

function check(url) {
  return new Promise((done) => {
    execFile(
      'curl',
      [
        '-s',
        '-o',
        '/dev/null',
        '-L',
        '--max-time',
        '25',
        '-A',
        'Mozilla/5.0 (compatible; VotingInsightsLinkCheck/1.0)',
        '-w',
        '%{http_code}',
        url,
      ],
      (err, stdout) => done(Number(stdout) || 0)
    );
  });
}

const list = [...urls.keys()];
const results = [];
let i = 0;
async function worker() {
  while (i < list.length) {
    const url = list[i++];
    const code = await check(url);
    results.push({ url, code, where: urls.get(url) });
  }
}
await Promise.all(Array.from({ length: 12 }, worker));

// 401/403/429 usually mean bot protection rather than a dead page.
const bad = results.filter((r) => r.code === 0 || r.code === 404 || r.code === 410 || r.code >= 500);
const blocked = results.filter((r) => [401, 403, 405, 429].includes(r.code));
console.log(
  `${results.length} urls checked: ${results.length - bad.length - blocked.length} ok, ${blocked.length} blocked by the site, ${bad.length} broken`
);
for (const r of bad) console.log(`BROKEN ${r.code} ${r.url}  (${r.where.join(', ')})`);
for (const r of blocked) console.log(`BLOCKED ${r.code} ${r.url}`);
const out = process.argv.indexOf('--json');
if (out > 0) writeFileSync(process.argv[out + 1], JSON.stringify({ bad, blocked }, null, 1));
