import { getDb } from '../index.js';

const now = () => new Date().toISOString();

const LINK_WITH_OWNER = `SELECT l.*, u.first_name, u.last_name, u.email
  FROM partner_links l JOIN users u ON u.id = l.user_id`;

export async function findBySlug(slug) {
  const db = await getDb();
  return db.get(`${LINK_WITH_OWNER} WHERE l.slug = ?`, [slug]);
}

export async function findById(id) {
  const db = await getDb();
  return db.get(`${LINK_WITH_OWNER} WHERE l.id = ?`, [id]);
}

// The person's newest request, whatever its status.
export async function latestForUser(userId) {
  const db = await getDb();
  return db.get('SELECT * FROM partner_links WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
}

export async function create(userId, slug, reason) {
  const db = await getDb();
  return db.get(
    `INSERT INTO partner_links (user_id, slug, reason, status, created_at) VALUES (?, ?, ?, 'pending', ?) RETURNING *`,
    [userId, slug, reason, now()]
  );
}

// A rejected request frees its slug for anyone, including the same person.
export async function removeRejected(slug) {
  const db = await getDb();
  await db.run(`DELETE FROM partner_links WHERE slug = ? AND status = 'rejected'`, [slug]);
}

export async function decide(id, status, adminId, note) {
  const db = await getDb();
  return db.get('UPDATE partner_links SET status = ?, decided_at = ?, decided_by = ?, note = ? WHERE id = ? RETURNING *', [
    status,
    now(),
    adminId,
    note || null,
    id,
  ]);
}

export async function list(status) {
  const db = await getDb();
  return status
    ? db.all(`${LINK_WITH_OWNER} WHERE l.status = ? ORDER BY l.id DESC`, [status])
    : db.all(`${LINK_WITH_OWNER} ORDER BY l.id DESC`);
}

export async function addEvent(linkId, kind, day, visitor) {
  const db = await getDb();
  await db.run('INSERT INTO partner_events (link_id, kind, day, visitor, created_at) VALUES (?, ?, ?, ?, ?)', [
    linkId,
    kind,
    day,
    visitor,
    now(),
  ]);
}

export async function events(linkId, from, to) {
  const db = await getDb();
  return db.all('SELECT kind, day, visitor FROM partner_events WHERE link_id = ? AND day >= ? AND day <= ?', [linkId, from, to]);
}

// People who signed up through the link, with their latest quiz result and ballot plan.
export async function members(linkId) {
  const db = await getDb();
  return db.all('SELECT id, county, age_range, created_at FROM users WHERE partner_link_id = ?', [linkId]);
}

export async function memberResults(linkId) {
  const db = await getDb();
  return db.all(
    `SELECT r.user_id, r.answers_json, r.results_json, r.created_at FROM quiz_results r
     JOIN users u ON u.id = r.user_id WHERE u.partner_link_id = ? ORDER BY r.created_at`,
    [linkId]
  );
}

export async function memberPlans(linkId) {
  const db = await getDb();
  return db.all(
    `SELECT p.user_id, p.plan_json FROM ballot_plans p JOIN users u ON u.id = p.user_id WHERE u.partner_link_id = ?`,
    [linkId]
  );
}

export async function attribute(userId, linkId) {
  const db = await getDb();
  await db.run('UPDATE users SET partner_link_id = ? WHERE id = ? AND partner_link_id IS NULL', [linkId, userId]);
}
