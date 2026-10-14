import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
// Set TEST_DATABASE_URL to run the same tests against a Postgres database.
// Its tables are emptied first, so never point this at real data.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;

const { createApp } = await import('../server/app.js');
const { devOutbox } = await import('../server/services/mailer.js');
const { getDb, resetDb } = await import('../server/db/index.js');

let server;
let base;

before(async () => {
  const db = await getDb();
  if (db.dialect === 'postgres') {
    await db.exec('TRUNCATE users, quiz_results, access_tokens, verification_codes, rate_limits RESTART IDENTITY CASCADE');
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await resetDb();
});

async function call(method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const profile = (email, extra = {}) => ({
  first_name: 'Ana',
  last_name: 'Lopez',
  email,
  county: 'Collin',
  age_range: '25-34',
  agree_terms: true,
  ...extra,
});

const answers = {
  q_abortion: { value: 2, weight: 2 },
  q_vouchers: { value: -2, weight: 1 },
  q_tariffs: { value: -1, weight: 1 },
  q_gun_laws: { value: 1, weight: 1 },
  q_cannabis: { value: 2, weight: 1 },
  q_county_tax: { value: 1, weight: 1 },
};

test('registration creates an account and returns a token', async () => {
  const r = await call('POST', '/api/register', { body: profile('ana@example.com') });
  assert.equal(r.status, 200);
  assert.ok(r.json.token.length > 30);
  assert.equal(r.json.user.email, 'ana@example.com');
});

test('a reused email opens the same account without a code', async () => {
  const r = await call('POST', '/api/register', { body: profile('ANA@example.com', { county: 'Travis' }) });
  assert.equal(r.status, 200);
  assert.ok(r.json.token);
  assert.equal(r.json.user.email, 'ana@example.com');
  assert.equal(r.json.user.county, 'Travis');
});

test('My Results opens by email and reports unknown emails', async () => {
  const found = await call('POST', '/api/lookup', { body: { email: 'Ana@Example.com' } });
  assert.equal(found.status, 200);
  assert.ok(found.json.token);
  assert.ok(Array.isArray(found.json.results));
  const missing = await call('POST', '/api/lookup', { body: { email: 'nobody@example.com' } });
  assert.equal(missing.status, 404);
});

test('input is validated and consent is required', async () => {
  assert.equal((await call('POST', '/api/register', { body: profile('bad') })).status, 400);
  assert.equal((await call('POST', '/api/register', { body: profile('x@example.com', { county: 'Atlantis' }) })).status, 400);
  assert.equal((await call('POST', '/api/register', { body: profile('x@example.com', { agree_terms: false }) })).status, 400);
  const malformed = await fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{nope',
  });
  assert.equal(malformed.status, 400);
});

test('SQL injection attempts are treated as plain data', async () => {
  const inj = await call('POST', '/api/lookup', { body: { email: "a@b.com' OR '1'='1" } });
  assert.equal(inj.status, 400);
  const share = await call('GET', `/api/results/${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(share.status, 404);
  const name = "Robert'); DROP TABLE users;--";
  const r = await call('POST', '/api/register', { body: profile('bobby@example.com', { first_name: name }) });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.first_name, name);
  const db = await getDb();
  const count = await db.get('SELECT COUNT(*) AS n FROM users');
  assert.ok(count.n >= 2);
});

test('markup is stripped from names', async () => {
  const r = await call('POST', '/api/register', {
    body: profile('xss@example.com', { first_name: '<script>alert(1)</script>' }),
  });
  assert.equal(r.json.user.first_name.includes('<'), false);
});

test('results are saved, emailed, and only the owner sees answers', async () => {
  const reg = await call('POST', '/api/register', { body: profile('owner@example.com') });
  const token = reg.json.token;
  const before = devOutbox.length;
  const sub = await call('POST', '/api/results', { body: { answers }, token });
  assert.equal(sub.status, 201);
  assert.equal(sub.json.emailed, true);
  assert.equal(devOutbox.length, before + 1);
  assert.match(sub.json.share_id, /^[A-Za-z0-9_-]{12}$/);
  assert.ok(sub.json.results.races.length > 40, 'Collin ballot races are scored');

  const pub = await call('GET', `/api/results/${sub.json.share_id}`);
  assert.equal(pub.json.owner, false);
  assert.equal(pub.json.answers, undefined);
  assert.equal(JSON.stringify(pub.json).includes('owner@example.com'), false);

  const mine = await call('GET', `/api/results/${sub.json.share_id}`, { token });
  assert.equal(mine.json.owner, true);
  assert.deepEqual(mine.json.answers.q_abortion, { value: 2, weight: 2 });

  const other = await call('POST', '/api/register', { body: profile('other@example.com') });
  const steal = await call('POST', `/api/results/${sub.json.share_id}/email`, { token: other.json.token });
  assert.equal(steal.status, 403);

  const list = await call('GET', '/api/my-results', { token });
  assert.equal(list.json.results.length, 1);

  const page = await fetch(`${base}/results/${sub.json.share_id}`).then((r) => r.text());
  assert.match(page, /Ana&#39;s 2026 Texas ballot alignment/);
});

test('submitting needs a valid token and enough answers', async () => {
  assert.equal((await call('POST', '/api/results', { body: { answers } })).status, 401);
  assert.equal((await call('POST', '/api/results', { body: { answers }, token: 'x'.repeat(43) })).status, 401);
  const reg = await call('POST', '/api/register', { body: profile('few@example.com') });
  const few = await call('POST', '/api/results', {
    body: { answers: { q_abortion: { value: 2, weight: 1 } } },
    token: reg.json.token,
  });
  assert.equal(few.status, 400);
});

test('admin exports require the admin token in a header and escape formulas', async () => {
  assert.equal((await call('GET', '/api/admin/users.csv')).status, 401);
  assert.equal((await call('GET', '/api/admin/users.csv?token=test-admin-token-0123456789abcdef')).status, 401);
  await call('POST', '/api/register', { body: profile('csv@example.com', { first_name: '=HYPERLINK("x")' }) });
  const csv = await call('GET', '/api/admin/users.csv', { token: 'test-admin-token-0123456789abcdef' });
  assert.equal(csv.status, 200);
  assert.match(csv.text, /"'=HYPERLINK\(""x""\)"/);
});

test('security headers are set and API responses are not cached', async () => {
  const r = await call('GET', '/api/my-results');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('email lookups are rate limited', async () => {
  let last;
  for (let i = 0; i < 21; i++) last = await call('POST', '/api/lookup', { body: { email: 'ana@example.com' } });
  assert.equal(last.status, 429);
});

test('sign out revokes the token and deletion removes the account', async () => {
  const reg = await call('POST', '/api/register', { body: profile('gone@example.com') });
  const token = reg.json.token;
  await call('POST', '/api/results', { body: { answers }, token });
  assert.equal((await call('DELETE', '/api/me', { token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token })).status, 401);

  const reg2 = await call('POST', '/api/register', { body: profile('signout@example.com') });
  assert.equal((await call('POST', '/api/sign-out', { token: reg2.json.token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: reg2.json.token })).status, 401);
});
