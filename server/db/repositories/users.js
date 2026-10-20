import { getDb } from '../index.js';

const now = () => new Date().toISOString();

export async function findByEmail(email) {
  const db = await getDb();
  return db.get('SELECT * FROM users WHERE email = ?', [email]);
}

export async function findById(id) {
  const db = await getDb();
  return db.get('SELECT * FROM users WHERE id = ?', [id]);
}

export async function create(p) {
  const db = await getDb();
  const ts = now();
  return db.get(
    `INSERT INTO users (first_name, last_name, email, county, age_range, marketing_ok, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [p.firstName, p.lastName, p.email, p.county, p.ageRange, p.marketingOk ? 1 : 0, p.passwordHash, ts, ts]
  );
}

export async function updateProfile(id, p) {
  const db = await getDb();
  return db.get(
    `UPDATE users SET first_name = ?, last_name = ?, county = ?, age_range = ?, marketing_ok = ?, updated_at = ?
     WHERE id = ? RETURNING *`,
    [p.firstName, p.lastName, p.county, p.ageRange, p.marketingOk ? 1 : 0, now(), id]
  );
}

export async function setAvatar(id, avatar) {
  const db = await getDb();
  return db.get('UPDATE users SET avatar = ?, updated_at = ? WHERE id = ? RETURNING *', [avatar, now(), id]);
}

export async function setPassword(id, passwordHash) {
  const db = await getDb();
  await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, now(), id]);
}

// Deletes the account. Results and tokens are removed by ON DELETE CASCADE.
export async function remove(id) {
  const db = await getDb();
  await db.run('DELETE FROM quiz_results WHERE user_id = ?', [id]);
  await db.run('DELETE FROM access_tokens WHERE user_id = ?', [id]);
  await db.run('DELETE FROM password_resets WHERE user_id = ?', [id]);
  await db.run('DELETE FROM ballot_plans WHERE user_id = ?', [id]);
  await db.run('DELETE FROM user_identities WHERE user_id = ?', [id]);
  // Their partner link goes too; people who came through it stay, unattributed.
  const links = await db.all('SELECT id FROM partner_links WHERE user_id = ?', [id]);
  for (const { id: linkId } of links) {
    await db.run('DELETE FROM partner_events WHERE link_id = ?', [linkId]);
    await db.run('UPDATE users SET partner_link_id = NULL WHERE partner_link_id = ?', [linkId]);
  }
  await db.run('DELETE FROM partner_links WHERE user_id = ?', [id]);
  await db.run('DELETE FROM users WHERE id = ?', [id]);
}

// role: 'read', 'write', or null to remove admin access.
export async function setAdminRole(id, role) {
  const db = await getDb();
  return db.get('UPDATE users SET admin_role = ?, is_admin = ?, updated_at = ? WHERE id = ? RETURNING *', [
    role,
    role ? 1 : 0,
    now(),
    id,
  ]);
}

export async function search(q) {
  const db = await getDb();
  const like = `%${String(q)
    .toLowerCase()
    .replace(/[%_\\]/g, '')}%`;
  return db.all(
    `SELECT id, first_name, last_name, email, county, is_admin, admin_role, created_at FROM users
     WHERE LOWER(email) LIKE ? OR LOWER(first_name || ' ' || last_name) LIKE ? ORDER BY created_at DESC LIMIT 25`,
    [like, like]
  );
}

// Everyone with admin access, including master admins listed by email.
export async function admins(masterEmails = []) {
  const db = await getDb();
  const marks = masterEmails.map(() => '?').join(', ');
  return db.all(
    `SELECT id, first_name, last_name, email, county, is_admin, admin_role, created_at FROM users
     WHERE admin_role IS NOT NULL OR is_admin = 1${marks ? ` OR LOWER(email) IN (${marks})` : ''}
     ORDER BY created_at`,
    masterEmails
  );
}

export async function exportAll() {
  const db = await getDb();
  return db.all(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.county, u.age_range, u.marketing_ok, u.created_at,
            COUNT(r.id) AS quiz_count, MAX(r.created_at) AS last_quiz_at
     FROM users u LEFT JOIN quiz_results r ON r.user_id = u.id
     GROUP BY u.id ORDER BY u.created_at`
  );
}
