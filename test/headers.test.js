import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECURITY_HEADERS } from '../server/middleware/security.js';

// Vercel serves the static client with the headers in vercel.json, not the
// Express ones, so the two copies must stay identical.
test('vercel.json sends the same security headers as the server', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const sent = Object.fromEntries((vercel.headers || []).flatMap((h) => h.headers).map((h) => [h.key, h.value]));
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (key in sent) assert.equal(sent[key], value, `${key} differs between vercel.json and server/middleware/security.js`);
  }
  assert.equal(sent['Content-Security-Policy'], SECURITY_HEADERS['Content-Security-Policy']);
});
