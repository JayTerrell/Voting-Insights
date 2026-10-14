// One-time email verification codes. Stored hashed, expire after 15 minutes,
// and lock after five wrong guesses.

import { getDb } from '../index.js';
import { randomCode, sha256, safeEqual } from '../../lib/crypto.js';

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function create(email) {
  const db = await getDb();
  const code = randomCode();
  await db.run(
    `INSERT INTO verification_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    [email, sha256(code), Date.now() + CODE_TTL_MS]
  );
  return code;
}

export async function consume(email, code) {
  const db = await getDb();
  const row = await db.get('SELECT * FROM verification_codes WHERE email = ?', [email]);
  if (!row || Number(row.expires_at) < Date.now() || row.attempts >= MAX_ATTEMPTS) return false;
  if (!safeEqual(row.code_hash, sha256(String(code).trim()))) {
    await db.run('UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?', [email]);
    return false;
  }
  await db.run('DELETE FROM verification_codes WHERE email = ?', [email]);
  return true;
}
