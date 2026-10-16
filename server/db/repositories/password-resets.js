// One-time password reset links. Only a hash of each token is stored, and a
// token works once, within an hour of being issued.

import { getDb } from '../index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';

const RESET_TTL_MS = 60 * 60 * 1000;

export async function issue(userId) {
  const db = await getDb();
  const token = randomToken();
  await db.run('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', [userId, Date.now()]);
  await db.run('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [
    sha256(token),
    userId,
    Date.now() + RESET_TTL_MS,
    new Date().toISOString(),
  ]);
  return token;
}

// Returns the user id for a valid token and deletes the token so it cannot be reused.
export async function consume(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const db = await getDb();
  const row = await db.get('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?', [sha256(token)]);
  if (!row) return null;
  await db.run('DELETE FROM password_resets WHERE user_id = ?', [row.user_id]);
  return Number(row.expires_at) > Date.now() ? row.user_id : null;
}
