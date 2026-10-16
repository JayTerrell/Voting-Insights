import { getDb } from '../index.js';

export async function findUser(provider, subject) {
  const db = await getDb();
  return db.get(`SELECT u.* FROM user_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?`, [
    provider,
    subject,
  ]);
}

export async function link(provider, subject, userId, email) {
  const db = await getDb();
  await db.run(
    `INSERT INTO user_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [provider, subject, userId, email || null, new Date().toISOString()]
  );
}

export async function providersFor(userId) {
  const db = await getDb();
  const rows = await db.all('SELECT provider FROM user_identities WHERE user_id = ? ORDER BY provider', [userId]);
  return rows.map((r) => r.provider);
}
