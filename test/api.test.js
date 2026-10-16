import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
process.env.AUTH_SECRET = 'test-auth-secret-0123456789abcdef-0123456789';
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
delete process.env.APPLE_CLIENT_ID;
// Set TEST_DATABASE_URL to run the same tests against a Postgres database.
// Its tables are emptied first, so never point this at real data.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;

const { createApp } = await import('../server/app.js');
const { devOutbox } = await import('../server/services/mailer.js');
const { getDb, resetDb } = await import('../server/db/index.js');
const { oauthHttp } = await import('../server/services/oauth.js');
const { generateKeyPairSync, sign: rsaSign } = await import('node:crypto');

let server;
let base;

before(async () => {
  const db = await getDb();
  if (db.dialect === 'postgres') {
    await db.exec(
      'TRUNCATE users, quiz_results, access_tokens, rate_limits, password_resets, ballot_plans, user_identities RESTART IDENTITY CASCADE'
    );
  }
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
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
  password: 'correct horse battery',
  agree_terms: true,
  ...extra,
});

const signUp = (email, extra) => call('POST', '/api/sign-up', { body: profile(email, extra) });

const answers = {
  q_abortion: { value: 2, weight: 2 },
  q_vouchers: { value: -2, weight: 1 },
  q_tariffs: { value: -1, weight: 1 },
  q_gun_laws: { value: 1, weight: 1 },
  q_cannabis: { value: 2, weight: 1 },
  q_county_tax: { value: 1, weight: 1 },
};

test('sign-up creates an account and returns a token', async () => {
  const r = await signUp('ana@example.com');
  assert.equal(r.status, 201);
  assert.ok(r.json.token.length > 30);
  assert.equal(r.json.user.email, 'ana@example.com');
  const db = await getDb();
  const row = await db.get('SELECT password_hash FROM users WHERE email = ?', ['ana@example.com']);
  assert.match(row.password_hash, /^scrypt\$/);
  assert.equal(row.password_hash.includes('correct horse'), false);
});

test('an email address can hold only one account, and email alone never opens it', async () => {
  const again = await signUp('ANA@example.com', { password: 'someone else entirely' });
  assert.equal(again.status, 409);
  assert.equal(again.json.token, undefined);
  assert.equal((await call('POST', '/api/lookup', { body: { email: 'ana@example.com' } })).status, 404);
  assert.equal((await call('POST', '/api/register', { body: profile('ana@example.com') })).status, 404);
});

test('sign-in needs the right password', async () => {
  const ok = await call('POST', '/api/sign-in', { body: { email: 'Ana@Example.com', password: 'correct horse battery' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.token);
  const bad = await call('POST', '/api/sign-in', { body: { email: 'ana@example.com', password: 'wrong password' } });
  assert.equal(bad.status, 401);
  const unknown = await call('POST', '/api/sign-in', { body: { email: 'nobody@example.com', password: 'whatever123' } });
  assert.equal(unknown.status, 401);
  assert.equal(bad.json.error, unknown.json.error, 'wrong password and unknown email look the same');
});

test('passwords must be at least 8 characters', async () => {
  assert.equal((await signUp('short@example.com', { password: 'abc' })).status, 400);
  assert.equal((await signUp('missing@example.com', { password: undefined })).status, 400);
});

test('input is validated and consent is required', async () => {
  assert.equal((await signUp('bad')).status, 400);
  assert.equal((await signUp('x@example.com', { county: 'Atlantis' })).status, 400);
  // Only counties with a loaded ballot can be chosen.
  assert.equal((await signUp('x@example.com', { county: 'Loving' })).status, 400);
  assert.equal((await signUp('x@example.com', { agree_terms: false })).status, 400);
  const malformed = await fetch(base + '/api/sign-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{nope',
  });
  assert.equal(malformed.status, 400);
});

test('SQL injection attempts are treated as plain data', async () => {
  const inj = await call('POST', '/api/sign-in', { body: { email: "a@b.com' OR '1'='1", password: "' OR '1'='1" } });
  assert.equal(inj.status, 400);
  const inj2 = await call('POST', '/api/sign-in', { body: { email: 'ana@example.com', password: "' OR '1'='1" } });
  assert.equal(inj2.status, 401);
  const share = await call('GET', `/api/results/${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(share.status, 404);
  const name = "Robert'); DROP TABLE users;--";
  const r = await signUp('bobby@example.com', { first_name: name });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.first_name, name);
  const db = await getDb();
  const count = await db.get('SELECT COUNT(*) AS n FROM users');
  assert.ok(count.n >= 2);
});

test('markup is stripped from names', async () => {
  const r = await signUp('xss@example.com', { first_name: '<script>alert(1)</script>' });
  assert.equal(r.json.user.first_name.includes('<'), false);
});

test('results are saved, emailed, and only the owner sees answers', async () => {
  const reg = await signUp('owner@example.com');
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

  const other = await signUp('other@example.com');
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
  const reg = await signUp('few@example.com');
  const few = await call('POST', '/api/results', {
    body: { answers: { q_abortion: { value: 2, weight: 1 } } },
    token: reg.json.token,
  });
  assert.equal(few.status, 400);
});

test('admin exports require the admin token in a header and escape formulas', async () => {
  assert.equal((await call('GET', '/api/admin/users.csv')).status, 401);
  assert.equal((await call('GET', '/api/admin/users.csv?token=test-admin-token-0123456789abcdef')).status, 401);
  await signUp('csv@example.com', { first_name: '=HYPERLINK("x")' });
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

test('password guessing is rate limited per email address', async () => {
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call('POST', '/api/sign-in', { body: { email: 'owner@example.com', password: `guess-${i}-xyz` } });
  }
  assert.equal(last.status, 429);
});

test('password reset works once, signs out other devices, and does not reveal accounts', async () => {
  const reg = await signUp('reset@example.com');
  const before = devOutbox.length;
  const known = await call('POST', '/api/password/forgot', { body: { email: 'reset@example.com' } });
  const unknown = await call('POST', '/api/password/forgot', { body: { email: 'ghost@example.com' } });
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, unknown.json);
  assert.equal(devOutbox.length, before + 1);
  const mail = devOutbox.at(-1);
  assert.equal(mail.to, 'reset@example.com');
  const token = mail.text.match(/#token=([A-Za-z0-9_-]+)/)[1];

  const done = await call('POST', '/api/password/reset', { body: { token, password: 'a brand new password' } });
  assert.equal(done.status, 200);
  assert.ok(done.json.token);
  assert.equal((await call('GET', '/api/me', { token: reg.json.token })).status, 401, 'old sessions end');
  const reuse = await call('POST', '/api/password/reset', { body: { token, password: 'another password' } });
  assert.equal(reuse.status, 400);
  const signIn = await call('POST', '/api/sign-in', { body: { email: 'reset@example.com', password: 'a brand new password' } });
  assert.equal(signIn.status, 200);
});

test('accounts from before passwords must set one by email', async () => {
  const db = await getDb();
  const ts = new Date().toISOString();
  await db.run(
    `INSERT INTO users (first_name, last_name, email, county, age_range, marketing_ok, created_at, updated_at)
     VALUES ('Old', 'Account', 'legacy@example.com', 'Collin', '25-34', 0, ?, ?)`,
    [ts, ts]
  );
  const signIn = await call('POST', '/api/sign-in', { body: { email: 'legacy@example.com', password: 'anything at all' } });
  assert.equal(signIn.status, 401);
  assert.match(signIn.json.error, /Forgot your password/);
  const claim = await signUp('legacy@example.com');
  assert.equal(claim.status, 409);
  assert.equal(claim.json.token, undefined);
});

test('profile updates keep the email address and require sign-in', async () => {
  const reg = await signUp('profile@example.com');
  assert.equal((await call('PATCH', '/api/me', { body: { first_name: 'X' } })).status, 401);
  const r = await call('PATCH', '/api/me', {
    token: reg.json.token,
    body: { ...profile('attacker@example.com'), first_name: 'Ann', county: 'Dallas', age_range: '45-54' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.email, 'profile@example.com');
  assert.equal(r.json.user.county, 'Dallas');
});

test('ballot plans save only known races and candidates', async () => {
  const reg = await signUp('plan@example.com');
  const token = reg.json.token;
  assert.equal((await call('GET', '/api/me/plan')).status, 401);
  const empty = await call('GET', '/api/me/plan', { token });
  assert.deepEqual(empty.json.plan.picks, {});
  const { guide } = await import('../server/services/guide.js');
  const race = guide.races.find((r) => r.candidates.length > 1);
  const other = guide.races.find((r) => r.id !== race.id);
  const saved = await call('PUT', '/api/me/plan', {
    token,
    body: {
      starred_races: [race.id, 'not-a-race', race.id],
      starred_candidates: [race.candidates[0].id, '<script>'],
      picks: { [race.id]: race.candidates[1].id, [other.id]: race.candidates[0].id, bogus: 'x' },
    },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.plan.starred_races, [race.id]);
  assert.deepEqual(saved.json.plan.starred_candidates, [race.candidates[0].id]);
  assert.deepEqual(saved.json.plan.picks, { [race.id]: race.candidates[1].id });
  const back = await call('GET', '/api/me/plan', { token });
  assert.deepEqual(back.json.plan.picks, { [race.id]: race.candidates[1].id });
});

test('sign out revokes the token and deletion removes the account', async () => {
  const reg = await signUp('gone@example.com');
  const token = reg.json.token;
  await call('POST', '/api/results', { body: { answers }, token });
  assert.equal((await call('DELETE', '/api/me', { token, body: { password: 'wrong one' } })).status, 401);
  assert.equal((await call('DELETE', '/api/me', { token, body: { password: 'correct horse battery' } })).status, 200);
  assert.equal((await call('GET', '/api/me', { token })).status, 401);
  const db = await getDb();
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM users WHERE email = ?', ['gone@example.com'])).n, 0);

  const reg2 = await signUp('signout@example.com');
  assert.equal((await call('POST', '/api/sign-out', { token: reg2.json.token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: reg2.json.token })).status, 401);
});

test('common passwords are rejected', async () => {
  assert.equal((await signUp('common@example.com', { password: 'password123' })).status, 400);
  assert.equal((await signUp('common2@example.com', { password: 'aaaaaaaaaa' })).status, 400);
});

test('sign-up sends a welcome email that never contains the password', async () => {
  const before = devOutbox.length;
  await signUp('welcome@example.com', { password: 'a quiet river morning' });
  const mail = devOutbox.slice(before).find((m) => m.to === 'welcome@example.com');
  assert.ok(mail, 'welcome email sent');
  assert.equal(mail.html.includes('a quiet river morning') || mail.text.includes('a quiet river morning'), false);
});

// ---------- Google sign-in, with a stand-in for Google ----------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims) {
  const head = b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: 'test-google-client',
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  });
  return `${head}.${body}.${rsaSign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

async function googleFlow(claims, { tamperState = false } = {}) {
  const start = await fetch(`${base}/api/auth/google/start?next=/quiz`, { redirect: 'manual' });
  assert.equal(start.status, 303);
  const to = new URL(start.headers.get('location'));
  assert.equal(to.host, 'accounts.google.com');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  assert.match(start.headers.get('set-cookie'), /HttpOnly/);
  const nonce = to.searchParams.get('nonce');
  oauthHttp.fetch = async (url, init) => {
    if (url.includes('certs')) return new Response(JSON.stringify({ keys: [jwk] }));
    const body = new URLSearchParams(init.body);
    assert.ok(body.get('code_verifier'), 'PKCE verifier sent');
    return new Response(JSON.stringify({ id_token: idToken({ nonce, ...claims }) }));
  };
  const state = tamperState ? 'wrong-state' : to.searchParams.get('state');
  const cb = await fetch(`${base}/api/auth/google/callback?code=abc&state=${state}`, {
    redirect: 'manual',
    headers: { cookie },
  });
  assert.equal(cb.status, 303);
  return cb.headers.get('location');
}

test('Google sign-in creates an account after the voter adds county and age', async () => {
  const providers = await call('GET', '/api/form-options');
  assert.deepEqual(providers.json.auth_providers, ['google']);
  const loc = await googleFlow({
    sub: 'g-123',
    email: 'New.Person@Gmail.com',
    email_verified: true,
    given_name: 'New',
    family_name: 'Person',
  });
  assert.match(loc, /^\/finish-sign-up#ticket=/);
  const ticket = new URLSearchParams(loc.split('#')[1]).get('ticket');
  const pending = await call('POST', '/api/auth/pending', { body: { ticket } });
  assert.equal(pending.json.email, 'new.person@gmail.com');
  assert.equal(pending.json.first_name, 'New');
  const done = await call('POST', '/api/auth/complete', {
    body: { ticket, first_name: 'New', last_name: 'Person', county: 'Collin', age_range: '25-34', agree_terms: true },
  });
  assert.equal(done.status, 201);
  assert.equal(done.json.user.email, 'new.person@gmail.com');
  assert.equal(done.json.user.has_password, false);

  // The second time, Google signs straight in.
  const again = await googleFlow({ sub: 'g-123', email: 'new.person@gmail.com', email_verified: true });
  assert.match(again, /^\/auth\/complete#token=[A-Za-z0-9_-]{40,}&next=%2Fquiz$/);
  const token = new URLSearchParams(again.split('#')[1]).get('token');
  const me = await call('GET', '/api/me', { token });
  assert.deepEqual(me.json.providers, ['google']);
  // Without a password, deleting the account needs the email address typed out.
  assert.equal((await call('DELETE', '/api/me', { token, body: { confirm_email: 'wrong@example.com' } })).status, 401);
});

test('Google sign-in links to an existing account with the same verified email', async () => {
  const loc = await googleFlow({ sub: 'g-ana', email: 'ana@example.com', email_verified: true });
  assert.match(loc, /^\/auth\/complete#token=/);
});

test('Google sign-in rejects a mismatched state or an unverified email link', async () => {
  assert.equal(
    await googleFlow({ sub: 'g-x', email: 'x@example.com', email_verified: true }, { tamperState: true }),
    '/sign-in?error=failed'
  );
  // An unverified email never links to the existing account.
  const loc = await googleFlow({ sub: 'g-evil', email: 'ana@example.com', email_verified: false });
  assert.match(loc, /^\/finish-sign-up#ticket=/);
  const ticket = new URLSearchParams(loc.split('#')[1]).get('ticket');
  const done = await call('POST', '/api/auth/complete', {
    body: { ticket, first_name: 'E', last_name: 'V', county: 'Collin', age_range: '25-34', agree_terms: true },
  });
  assert.equal(done.status, 400);
  const forged = await call('POST', '/api/auth/pending', { body: { ticket: ticket.slice(0, -2) + 'xx' } });
  assert.equal(forged.status, 400);
});
