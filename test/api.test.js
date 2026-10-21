import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
process.env.AUTH_SECRET = 'test-auth-secret-0123456789abcdef-0123456789';
process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.ADMIN_EMAILS = 'boss@example.com';
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
const { pollingHttp } = await import('../server/services/polling.js');
const { generateKeyPairSync, sign: rsaSign } = await import('node:crypto');

let server;
let base;

before(async () => {
  const db = await getDb();
  if (db.dialect === 'postgres') {
    await db.exec(
      'TRUNCATE users, quiz_results, access_tokens, rate_limits, password_resets, ballot_plans, user_identities, partner_links, partner_events, site_events RESTART IDENTITY CASCADE'
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

test('a shared link shows only the summary, and top issues only when the owner allows', async () => {
  const reg = await signUp('sharer@example.com');
  const token = reg.json.token;
  const sub = await call('POST', '/api/results', { body: { answers }, token });
  const id = sub.json.share_id;

  const pub = await call('GET', `/api/results/${id}`);
  assert.equal(pub.json.owner, false);
  assert.equal(pub.json.results, undefined, 'race-by-race matches stay private');
  assert.equal(pub.json.answers, undefined);
  assert.equal(pub.json.preview.first_name, 'Ana');
  assert.ok(pub.json.preview.parties.length > 0);
  assert.deepEqual(pub.json.preview.issues, []);

  const other = await signUp('nosy@example.com');
  assert.equal((await call('PUT', `/api/results/${id}/share`, { body: { issues: true }, token: other.json.token })).status, 403);
  assert.equal((await call('PUT', `/api/results/${id}/share`, { body: { issues: 'yes' }, token })).status, 400);
  const on = await call('PUT', `/api/results/${id}/share`, { body: { issues: true }, token });
  assert.equal(on.status, 200);
  assert.equal(on.json.issues.length, 3);
  assert.equal((await call('GET', `/api/results/${id}`)).json.preview.issues.length, 3);

  for (const format of ['card', 'story']) {
    const img = await fetch(`${base}/api/share/${id}/${format}.png`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await img.arrayBuffer());
    assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]);
  }
  assert.equal((await fetch(`${base}/api/share/${id}/huge.png`)).status, 404);
  assert.equal((await fetch(`${base}/api/share/nope/card.png`)).status, 404);

  const page = await fetch(`${base}/results/${id}`).then((r) => r.text());
  assert.match(page, new RegExp(`og:image" content="[^"]*/api/share/${id}/card\\.png\\?v=2`));
});

test('partner links: request, approval, visits, attribution, and totals with a privacy floor', async () => {
  const db = await getDb();
  await db.run('DELETE FROM rate_limits');
  const boss = await signUp('boss@example.com');
  assert.equal(boss.json.user.is_admin, true, 'ADMIN_EMAILS accounts are admins');
  const p = await signUp('partner@example.com');
  assert.equal(p.json.user.is_admin, false);
  const pt = p.json.token;
  assert.equal((await call('GET', '/api/admin/partners', { token: pt })).status, 403);

  const check = async (slug) => (await call('GET', `/api/partner/check?slug=${encodeURIComponent(slug)}`, { token: pt })).json;
  assert.equal((await check('admin')).available, false);
  assert.equal((await check('ab')).available, false);
  assert.equal((await check('-bad-')).available, false);
  assert.equal((await check('Good-Link')).available, true);

  const mails = devOutbox.length;
  const noSocial = await call('POST', '/api/partner/request', {
    token: pt,
    body: { slug: 'good-link', reason: 'My church group', socials: [] },
  });
  assert.equal(noSocial.status, 400, 'at least one social page is required');
  const badUrl = await call('POST', '/api/partner/request', {
    token: pt,
    body: { slug: 'good-link', reason: 'x y z', socials: [{ site: 'X', url: 'javascript:alert(1)' }] },
  });
  assert.equal(badUrl.status, 400);
  const req = await call('POST', '/api/partner/request', {
    token: pt,
    body: {
      slug: 'Good-Link',
      reason: 'My church group',
      socials: [
        { site: 'Instagram', url: 'instagram.com/goodlink' },
        { site: 'X', url: '' },
      ],
    },
  });
  assert.equal(req.status, 201);
  assert.equal(req.json.link.slug, 'good-link');
  assert.equal(req.json.link.status, 'pending');
  assert.deepEqual(req.json.link.socials, [{ site: 'Instagram', url: 'https://instagram.com/goodlink' }]);
  const sent = devOutbox.slice(mails).map((m) => m.to);
  assert.ok(sent.includes('partner@example.com') && sent.includes('boss@example.com'), 'requester and admin are emailed');
  assert.equal(
    (
      await call('POST', '/api/partner/request', {
        token: pt,
        body: { slug: 'other', reason: 'again', socials: [{ site: 'X', url: 'x.com/a' }] },
      })
    ).status,
    409
  );

  const go = (ua = 'Mozilla/5.0 Test') => fetch(`${base}/go/good-link`, { redirect: 'manual', headers: { 'user-agent': ua } });
  assert.equal((await go()).headers.get('location'), '/', 'a pending link does not track');

  const pending = await call('GET', '/api/admin/partners?status=pending', { token: boss.json.token });
  const id = pending.json.links.find((l) => l.slug === 'good-link').id;
  const before2 = devOutbox.length;
  const ok = await call('POST', `/api/admin/partners/${id}/approve`, { token: boss.json.token, body: {} });
  assert.equal(ok.json.link.status, 'approved');
  assert.equal(devOutbox.at(-1).to, 'partner@example.com');
  assert.ok(devOutbox.length > before2);

  for (let i = 0; i < 3; i++) assert.equal((await go()).headers.get('location'), '/?ref=good-link');
  await go('Twitterbot/1.0');

  for (let i = 0; i < 11; i++) {
    const m = await signUp(`member${i}@example.com`, { partner: 'good-link' });
    await call('POST', '/api/results', { body: { answers }, token: m.json.token });
  }
  const stray = await signUp('stray@example.com', { partner: 'no-such-link' });
  assert.equal(stray.status, 201);

  const st = await call('GET', '/api/partner/stats', { token: pt });
  assert.equal(st.status, 200);
  assert.equal(st.json.stats.traffic.visits, 3, 'crawlers are not counted');
  assert.equal(st.json.stats.traffic.unique_visitors, 1);
  assert.equal(st.json.stats.conversion.sign_ups, 11);
  assert.equal(st.json.stats.conversion.quiz_completions, 11);
  assert.equal(st.json.stats.audience.county.rows[0].count, 11);
  assert.ok(st.json.stats.quiz.average_alignment.length > 0);
  assert.equal(JSON.stringify(st.json).includes('member0@example.com'), false, 'no individual leaks');

  // Below the floor, audience and quiz totals stay hidden.
  const small = await call('GET', `/api/partner/stats?from=2000-01-01&to=2000-01-02`, { token: pt });
  assert.equal(small.json.stats.audience, null);
  assert.equal(small.json.stats.quiz, null);
  assert.equal((await call('GET', '/api/partner/stats', { token: stray.json.token })).status, 404);

  const summary = await call('GET', '/api/admin/partners/summary', { token: boss.json.token });
  assert.equal(summary.json.links[0].sign_ups, 11);
  // Roles: the master admin appears in the list without searching.
  const list = await call('GET', '/api/admin/users', { token: boss.json.token });
  assert.equal(list.json.users[0].email, 'boss@example.com');
  assert.equal(list.json.users[0].role, 'master');
  const found = await call('GET', '/api/admin/users?q=partner', { token: boss.json.token });
  const pid = found.json.users[0].id;
  const bossId = list.json.users[0].id;
  const setRole = (id, role, token) => call('PUT', `/api/admin/users/${id}/role`, { token, body: { role } });

  // Read: sees numbers, cannot manage admins or download raw data.
  assert.equal((await setRole(pid, 'read', boss.json.token)).json.user.role, 'read');
  assert.equal((await call('GET', '/api/admin/overview', { token: pt })).status, 200);
  assert.equal((await call('GET', '/api/admin/partners', { token: pt })).status, 200);
  assert.equal((await setRole(pid, 'write', pt)).status, 403, 'a read admin cannot raise their own role');
  assert.equal((await call('GET', '/api/admin/users.csv', { token: pt })).status, 403);
  assert.equal((await call('GET', '/api/admin/users.csv', { token: boss.json.token })).status, 200);

  // Write: manages other admins, never the master; may lower their own role.
  await setRole(pid, 'write', boss.json.token);
  const helper = await signUp('helper@example.com');
  const hid = (await call('GET', '/api/admin/users?q=helper', { token: pt })).json.users[0].id;
  assert.equal((await setRole(hid, 'read', pt)).json.user.role, 'read');
  assert.equal((await call('GET', '/api/me', { token: helper.json.token })).json.user.admin_role, 'read');
  assert.equal((await setRole(bossId, 'read', pt)).status, 400, 'the master cannot be changed');
  assert.equal((await setRole(pid, 'read', pt)).json.user.role, 'read');
  assert.equal((await setRole(hid, null, pt)).status, 403, 'after lowering themselves they need the master');
  assert.equal((await setRole(hid, null, boss.json.token)).json.user.role, null);
  await db.run('DELETE FROM rate_limits');
});

test('site analytics: anonymous page views and the admin overview', async () => {
  const db = await getDb();
  await db.run('DELETE FROM rate_limits');
  const ua = { 'user-agent': 'Mozilla/5.0 (iPhone) Safari' };
  const track = (body, headers = ua) => call('POST', '/api/track', { body, headers });
  assert.equal((await track({ kind: 'pageview', path: '/results/AbCdEfGhIjKl?x=1', source: 'https://t.co/abc' })).status, 204);
  await track({ kind: 'pageview', path: '/candidates' });
  await track({ kind: 'quiz_start', path: '/quiz' });
  await track({ kind: 'pageview', path: '/' }, { 'user-agent': 'Googlebot/2.1' });
  await track({ kind: 'nonsense', path: '/' });
  const rows = await db.all('SELECT kind, path, source, device FROM site_events ORDER BY id');
  assert.equal(rows.length, 3, 'bots and unknown kinds are not stored');
  assert.equal(rows[0].path, '/results/:id', 'result links are not stored');
  assert.equal(rows[0].source, 'X');
  assert.equal(rows[0].device, 'Phone');

  const boss = await call('POST', '/api/sign-in', { body: { email: 'boss@example.com', password: 'correct horse battery' } });
  const plain = await signUp('viewer@example.com');
  assert.equal((await call('GET', '/api/admin/overview', { token: plain.json.token })).status, 403);
  // Saved ballots must count, not break the page.
  await call('PUT', '/api/me/plan', { token: plain.json.token, body: { starred_races: ['us-senate'], picks: {} } });
  // An admin's own browsing is left out unless asked for.
  await call('POST', '/api/track', {
    body: { kind: 'pageview', path: '/scoring' },
    token: boss.json.token,
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Firefox' },
  });
  const withAdmins = await call('GET', '/api/admin/overview?admins=include', { token: boss.json.token });
  assert.ok(withAdmins.json.traffic.pages.some((p) => p.name === '/scoring'));
  const o = await call('GET', '/api/admin/overview?group=week', { token: boss.json.token });
  assert.equal(o.json.exclude_admins, true);
  assert.equal(
    o.json.traffic.pages.some((p) => p.name === '/scoring'),
    false,
    'admin page views are excluded'
  );
  assert.equal(o.json.kpis.active_ballots >= 1, true, JSON.stringify(o.json).slice(0, 200));
  assert.equal(o.status, 200);
  assert.equal(o.json.kpis.page_views, 2);
  assert.equal(o.json.kpis.visitors, 1);
  assert.equal(o.json.kpis.quiz_starts, 1);
  assert.ok(o.json.kpis.sign_ups > 0 && o.json.kpis.quizzes_taken > 0);
  assert.equal(o.json.range.group, 'week');
  assert.ok(o.json.series.length > 0 && o.json.funnel.length === 4);
  assert.ok(o.json.traffic.pages.some((p) => p.name === '/candidates'));
  // Hour by hour: 24 slots a day (fewer today), and every view lands in one.
  const day = o.json.range.to;
  const hr = await call('GET', `/api/admin/overview?group=hour&from=${day}&to=${day}`, { token: boss.json.token });
  assert.equal(hr.json.range.group, 'hour');
  assert.match(hr.json.series[0].bucket, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
  assert.equal(
    hr.json.series.reduce((n, b) => n + b.page_views, 0),
    o.json.kpis.page_views
  );
  assert.equal(hr.json.hours.length, 24);
  assert.equal(
    hr.json.hours.reduce((n, b) => n + b.page_views, 0),
    o.json.kpis.page_views
  );
  // Long ranges fall back to days.
  const long = await call('GET', '/api/admin/overview?group=hour&from=2026-09-01&to=2026-10-20', { token: boss.json.token });
  assert.equal(long.json.range.group, 'day');
  assert.equal(long.json.range.hour_limited, true);
  const hcsv = await fetch(`${base}/api/admin/overview.csv?group=hour&from=${day}&to=${day}`, {
    headers: { Authorization: `Bearer ${boss.json.token}` },
  });
  assert.match(await hcsv.text(), /^hour,visitors[\s\S]*\n\d{4}-\d{2}-\d{2} \d{2}:00,/);
  const csv = await fetch(`${base}/api/admin/overview.csv`, { headers: { Authorization: `Bearer ${boss.json.token}` } });
  assert.match(await csv.text(), /^day,visitors,page_views/);
  await db.run('DELETE FROM rate_limits');
});

test('shared ballot picks and watchlists', async () => {
  const db = await getDb();
  await db.run('DELETE FROM rate_limits');
  const me = await signUp('lister@example.com', { first_name: 'Rosa', last_name: 'Private' });
  const token = me.json.token;
  assert.equal((await call('PUT', '/api/lists/ballot', { body: { county: 'Collin' } })).status, 401);
  // Nothing picked yet: nothing to share.
  assert.equal((await call('PUT', '/api/lists/ballot', { token, body: { county: 'Collin' } })).status, 400);
  assert.equal((await call('PUT', '/api/lists/nonsense', { token, body: { county: 'Collin' } })).status, 400);

  const g = JSON.parse(readFileSync(new URL('../data/guide.json', import.meta.url), 'utf8'));
  const races = new Map(g.races.map((r) => [r.id, r]));
  const contested = g.ballots.Collin.filter((id) => races.get(id).candidates.length > 1).slice(0, 7);
  const picks = Object.fromEntries(contested.map((id) => [id, races.get(id).candidates[0].id]));
  // A race on another county's ballot is left off this county's list.
  const elsewhere = g.races.find((r) => r.county && !g.ballots.Collin.includes(r.id));
  picks[elsewhere.id] = elsewhere.candidates[0].id;
  await call('PUT', '/api/me/plan', { token, body: { starred_races: contested.slice(0, 2), picks } });

  const shared = await call('PUT', '/api/lists/ballot', { token, body: { county: 'Collin' } });
  assert.equal(shared.status, 200);
  assert.equal(shared.json.items.length, 7);
  assert.match(shared.json.url, /\/ballot\/[\w-]{12}$/);
  const id = shared.json.share_id;

  const pub = await call('GET', `/api/lists/${id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.kind, 'ballot');
  assert.equal(pub.json.first_name, 'Rosa');
  assert.equal(pub.json.owner, false);
  assert.equal(pub.json.items[0].pick.id, picks[contested[0]]);
  assert.doesNotMatch(pub.text, /Private|lister@example/, 'no last name or email');
  assert.equal((await call('GET', `/api/lists/${id}`, { token })).json.owner, true);

  // Later changes stay private until shared again, and the link stays the same.
  await call('PUT', '/api/me/plan', { token, body: { starred_races: [], picks: { [contested[0]]: picks[contested[0]] } } });
  assert.equal((await call('GET', `/api/lists/${id}`)).json.items.length, 7);
  const again = await call('PUT', '/api/lists/ballot', { token, body: { county: 'Collin' } });
  assert.equal(again.json.share_id, id);
  assert.notEqual(again.json.version, shared.json.version);
  assert.equal((await call('GET', `/api/lists/${id}`)).json.items.length, 1);

  for (const format of ['card', 'story']) {
    const img = await fetch(`${base}/api/lists/${id}/${format}.png`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
  }
  const page = await (await fetch(`${base}/ballot/${id}`)).text();
  assert.match(page, new RegExp(`/api/lists/${id}/card.png`));
  assert.match(page, /Rosa&#39;s picks/);
  assert.match(page, /content="Collin County: /, 'the description names the list');
  // The other kind's path does not show this list.
  assert.doesNotMatch(await (await fetch(`${base}/watchlist/${id}`)).text(), /Rosa/);

  const mine = await call('GET', '/api/lists/mine', { token });
  assert.equal(mine.json.ballot.share_id, id);
  assert.equal(mine.json.watchlist, null);

  assert.equal((await call('DELETE', '/api/lists/ballot', { token })).status, 200);
  assert.equal((await call('GET', `/api/lists/${id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/lists/${id}/card.png`)).status, 404);
  await db.run('DELETE FROM rate_limits');
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
      issues: ['Education', 'Not an issue', 'Health Care', 'Education', 42],
    },
  });
  assert.equal(saved.status, 200);
  // A starred candidate from an earlier version becomes a watched office.
  assert.deepEqual(saved.json.plan.starred_races, [race.id]);
  assert.deepEqual(saved.json.plan.starred_candidates, []);
  assert.deepEqual(saved.json.plan.picks, { [race.id]: race.candidates[1].id });
  const back = await call('GET', '/api/me/plan', { token });
  assert.deepEqual(back.json.plan.picks, { [race.id]: race.candidates[1].id });
  // Issues keep their order, drop unknown areas and repeats.
  assert.deepEqual(back.json.plan.issues, ['Education', 'Health Care']);
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

test('profile photos must be small, real images', async () => {
  const reg = await signUp('photo@example.com');
  const token = reg.json.token;
  const tinyJpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');
  const ok = await call('PUT', '/api/me/avatar', { token, body: { image: tinyJpeg } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.avatar, tinyJpeg);
  const fake = 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await call('PUT', '/api/me/avatar', { token, body: { image: fake } })).status, 400);
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
  assert.equal((await call('PUT', '/api/me/avatar', { token, body: { image: svg } })).status, 400);
  const huge =
    'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200 * 1024)]).toString('base64');
  assert.ok([400, 413].includes((await call('PUT', '/api/me/avatar', { token, body: { image: huge } })).status));
  assert.equal((await call('PUT', '/api/me/avatar', { body: { image: tinyJpeg } })).status, 401);
  const removed = await call('DELETE', '/api/me/avatar', { token });
  assert.equal(removed.json.user.avatar, null);
});

test('address lookups go to the Census geocoder and report misses', async () => {
  pollingHttp.fetch = async (url) => {
    const u = new URL(url);
    assert.equal(u.host, 'geocoding.geo.census.gov');
    const hit = u.searchParams.get('address').includes('Redbud');
    return new Response(
      JSON.stringify({
        result: { addressMatches: hit ? [{ coordinates: { x: -96.6, y: 33.2 }, matchedAddress: '2010 REDBUD BLVD' }] : [] },
      })
    );
  };
  const ok = await call('GET', '/api/geocode?address=' + encodeURIComponent('2010 Redbud Blvd, McKinney, TX'));
  assert.equal(ok.status, 200);
  assert.equal(ok.json.lat, 33.2);
  assert.equal((await call('GET', '/api/geocode?address=' + encodeURIComponent('nowhere at all'))).status, 404);
  assert.equal((await call('GET', '/api/geocode?address=ab')).status, 400);
});

test('the polling place lookup is off until a Civic API key is set', async () => {
  const r = await call('GET', '/api/polling/lookup?address=' + encodeURIComponent('2010 Redbud Blvd, McKinney, TX'));
  assert.equal(r.status, 503);
  const opts = await call('GET', '/api/form-options');
  assert.equal(opts.json.polling_lookup, false);
});

test('location is allowed only for this site and map tiles only from Stadia', async () => {
  const r = await call('GET', '/api/health');
  assert.match(r.headers.get('permissions-policy'), /geolocation=\(self\)/);
  assert.match(r.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/tiles\.stadiamaps\.com/);
});
