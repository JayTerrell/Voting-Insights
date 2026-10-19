import { getDb } from '../index.js';

export async function add(e) {
  const db = await getDb();
  await db.run('INSERT INTO site_events (kind, day, path, source, device, visitor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    e.kind,
    e.day,
    e.path,
    e.source,
    e.device,
    e.visitor,
    new Date().toISOString(),
  ]);
}

// Per day: page views, distinct visitors, and counts of each action.
export async function daily(from, to) {
  const db = await getDb();
  return db.all(
    `SELECT day, kind, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors
     FROM site_events WHERE day >= ? AND day <= ? GROUP BY day, kind`,
    [from, to]
  );
}

// Top values of one column for page views, counting distinct visitors per day.
export async function top(column, from, to, limit = 12) {
  const col = { path: 'path', source: 'source', device: 'device' }[column];
  const db = await getDb();
  return db.all(
    `SELECT ${col} AS name, COUNT(*) AS views, COUNT(DISTINCT day || visitor) AS visitors
     FROM site_events WHERE kind = 'pageview' AND day >= ? AND day <= ? AND ${col} IS NOT NULL
     GROUP BY ${col} ORDER BY visitors DESC, views DESC LIMIT ?`,
    [from, to, limit]
  );
}

export async function users(fromIso, toIso) {
  const db = await getDb();
  return db.all(
    `SELECT created_at, county, age_range, partner_link_id, password_hash IS NULL AS social
     FROM users WHERE created_at >= ? AND created_at < ?`,
    [fromIso, toIso]
  );
}

export async function results(fromIso, toIso) {
  const db = await getDb();
  return db.all(
    'SELECT user_id, created_at, answers_json, results_json FROM quiz_results WHERE created_at >= ? AND created_at < ? ORDER BY created_at',
    [fromIso, toIso]
  );
}

export async function plansUpdated(fromIso, toIso) {
  const db = await getDb();
  return db.all('SELECT plan_json FROM ballot_plans WHERE updated_at >= ? AND updated_at < ?', [fromIso, toIso]);
}

export async function totals() {
  const db = await getDb();
  const one = async (sql) => Number((await db.get(sql))?.n || 0);
  return {
    users: await one('SELECT COUNT(*) AS n FROM users'),
    quiz_results: await one('SELECT COUNT(*) AS n FROM quiz_results'),
    quiz_takers: await one('SELECT COUNT(DISTINCT user_id) AS n FROM quiz_results'),
    ballots: await one('SELECT COUNT(*) AS n FROM ballot_plans'),
    partner_links: await one("SELECT COUNT(*) AS n FROM partner_links WHERE status = 'approved'"),
  };
}
