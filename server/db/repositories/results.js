import { getDb } from '../index.js';
import { randomToken } from '../../lib/crypto.js';

export async function create(userId, answers, results, dataVersion) {
  const db = await getDb();
  return db.get(
    `INSERT INTO quiz_results (user_id, share_id, answers_json, results_json, data_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [userId, randomToken(9), JSON.stringify(answers), JSON.stringify(results), dataVersion, new Date().toISOString()]
  );
}

export async function findByShareId(shareId) {
  const db = await getDb();
  return db.get(
    `SELECT r.*, u.first_name, u.email
     FROM quiz_results r JOIN users u ON u.id = r.user_id WHERE r.share_id = ?`,
    [shareId]
  );
}

export async function listForUser(userId) {
  const db = await getDb();
  return db.all('SELECT share_id, results_json, created_at FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC', [
    userId,
  ]);
}

export async function setShareIssues(shareId, on) {
  const db = await getDb();
  await db.run('UPDATE quiz_results SET share_issues = ? WHERE share_id = ?', [on ? 1 : 0, shareId]);
}

export async function markEmailed(shareId) {
  const db = await getDb();
  await db.run('UPDATE quiz_results SET emailed_at = ? WHERE share_id = ?', [new Date().toISOString(), shareId]);
}

export async function exportAll() {
  const db = await getDb();
  return db.all(
    `SELECT r.id, r.share_id, u.email, u.county, u.age_range, r.data_version, r.created_at, r.emailed_at,
            r.answers_json, r.results_json
     FROM quiz_results r JOIN users u ON u.id = r.user_id ORDER BY r.created_at`
  );
}
