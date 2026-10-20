import { getDb } from '../index.js';

export async function findByShareId(shareId) {
  const db = await getDb();
  return db.get(
    `SELECT l.user_id, l.kind, l.share_id, l.county, l.items_json, l.created_at, l.updated_at, u.first_name
     FROM list_shares l JOIN users u ON u.id = l.user_id WHERE l.share_id = ?`,
    [shareId]
  );
}

export async function listForUser(userId) {
  const db = await getDb();
  return db.all('SELECT kind, share_id, county, items_json, updated_at FROM list_shares WHERE user_id = ?', [userId]);
}

export async function find(userId, kind) {
  const db = await getDb();
  return db.get('SELECT share_id FROM list_shares WHERE user_id = ? AND kind = ?', [userId, kind]);
}

// A second share of the same kind replaces the list and keeps the link.
export async function save(userId, kind, shareId, county, items) {
  const db = await getDb();
  const ts = new Date().toISOString();
  await db.run(
    `INSERT INTO list_shares (user_id, kind, share_id, county, items_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, kind) DO UPDATE SET county = excluded.county, items_json = excluded.items_json, updated_at = excluded.updated_at`,
    [userId, kind, shareId, county, JSON.stringify(items), ts, ts]
  );
}

export async function remove(userId, kind) {
  const db = await getDb();
  await db.run('DELETE FROM list_shares WHERE user_id = ? AND kind = ?', [userId, kind]);
}
