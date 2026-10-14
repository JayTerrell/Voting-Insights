// Sign-in tokens let a device reopen saved results. Only a SHA-256 hash of each
// token is stored, so a database leak does not expose usable tokens.

import { getDb } from '../index.js';
import { randomToken, sha256 } from '../../lib/crypto.js';

const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export async function issue(userId) {
  const db = await getDb();
  const token = randomToken();
  await db.run('INSERT INTO access_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [
    sha256(token),
    userId,
    Date.now() + TOKEN_TTL_MS,
    new Date().toISOString(),
  ]);
  return token;
}

export async function findUser(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const db = await getDb();
  return db.get(
    `SELECT u.* FROM access_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.expires_at > ?`,
    [sha256(token), Date.now()]
  );
}

export async function revoke(token) {
  const db = await getDb();
  await db.run('DELETE FROM access_tokens WHERE token_hash = ?', [sha256(token)]);
}
