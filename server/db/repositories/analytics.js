import { getDb } from '../index.js';

export async function add(e) {
  const db = await getDb();
  await db.run(
    'INSERT INTO site_events (kind, day, path, source, device, visitor, staff, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [e.kind, e.day, e.path, e.source, e.device, e.visitor, e.staff ? 1 : 0, new Date().toISOString()]
  );
}

// When admins are excluded, so is anything the same visitor did that day, which
// covers pages an admin opened before signing in on the same device.
const NOT_STAFF = `NOT EXISTS (SELECT 1 FROM site_events s WHERE s.staff = 1 AND s.day = e.day AND s.visitor = e.visitor)`;
const staffFilter = (exclude) => (exclude ? ` AND ${NOT_STAFF}` : '');

// Admin accounts: anyone with an admin role, plus the master emails.
function notAdmin(alias, masters) {
  const marks = masters.map(() => '?').join(', ');
  return {
    sql: ` AND ${alias}.admin_role IS NULL AND ${alias}.is_admin = 0${marks ? ` AND LOWER(${alias}.email) NOT IN (${marks})` : ''}`,
    params: masters,
  };
}
const accountFilter = (alias, masters) => (masters ? notAdmin(alias, masters) : { sql: '', params: [] });

// Per day: page views, distinct visitors, and counts of each action.
export async function daily(from, to, excludeStaff = false) {
  const db = await getDb();
  return db.all(
    `SELECT e.day AS day, e.kind AS kind, COUNT(*) AS n, COUNT(DISTINCT e.visitor) AS visitors
     FROM site_events e WHERE e.day >= ? AND e.day <= ?${staffFilter(excludeStaff)} GROUP BY e.day, e.kind`,
    [from, to]
  );
}

// Top values of one column for page views, counting distinct visitors per day.
export async function top(column, from, to, excludeStaff = false, limit = 12) {
  const col = { path: 'path', source: 'source', device: 'device' }[column];
  const db = await getDb();
  return db.all(
    `SELECT e.${col} AS name, COUNT(*) AS views, COUNT(DISTINCT e.day || e.visitor) AS visitors
     FROM site_events e WHERE e.kind = 'pageview' AND e.day >= ? AND e.day <= ? AND e.${col} IS NOT NULL${staffFilter(excludeStaff)}
     GROUP BY e.${col} ORDER BY visitors DESC, views DESC LIMIT ?`,
    [from, to, limit]
  );
}

// masters: pass the master admin emails to leave admin accounts out, or null to include everyone.
export async function users(fromIso, toIso, masters = null) {
  const db = await getDb();
  const f = accountFilter('u', masters);
  return db.all(
    `SELECT u.created_at, u.county, u.age_range, u.partner_link_id, u.password_hash IS NULL AS social
     FROM users u WHERE u.created_at >= ? AND u.created_at < ?${f.sql}`,
    [fromIso, toIso, ...f.params]
  );
}

export async function results(fromIso, toIso, masters = null) {
  const db = await getDb();
  const f = accountFilter('u', masters);
  return db.all(
    `SELECT r.user_id, r.created_at, r.answers_json, r.results_json FROM quiz_results r JOIN users u ON u.id = r.user_id
     WHERE r.created_at >= ? AND r.created_at < ?${f.sql} ORDER BY r.created_at`,
    [fromIso, toIso, ...f.params]
  );
}

export async function plansUpdated(fromIso, toIso, masters = null) {
  const db = await getDb();
  const f = accountFilter('u', masters);
  return db.all(
    `SELECT p.plan_json, p.updated_at FROM ballot_plans p JOIN users u ON u.id = p.user_id
     WHERE p.updated_at >= ? AND p.updated_at < ?${f.sql}`,
    [fromIso, toIso, ...f.params]
  );
}

export async function totals(masters = null) {
  const db = await getDb();
  const f = accountFilter('u', masters);
  const one = async (sql) => Number((await db.get(sql, f.params))?.n || 0);
  return {
    users: await one(`SELECT COUNT(*) AS n FROM users u WHERE 1 = 1${f.sql}`),
    quiz_results: await one(`SELECT COUNT(*) AS n FROM quiz_results r JOIN users u ON u.id = r.user_id WHERE 1 = 1${f.sql}`),
    quiz_takers: await one(
      `SELECT COUNT(DISTINCT r.user_id) AS n FROM quiz_results r JOIN users u ON u.id = r.user_id WHERE 1 = 1${f.sql}`
    ),
    ballots: await one(`SELECT COUNT(*) AS n FROM ballot_plans p JOIN users u ON u.id = p.user_id WHERE 1 = 1${f.sql}`),
    partner_links: Number((await db.get("SELECT COUNT(*) AS n FROM partner_links WHERE status = 'approved'"))?.n || 0),
  };
}
