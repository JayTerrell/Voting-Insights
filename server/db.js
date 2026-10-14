import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, randomInt } from 'node:crypto';

const DB_PATH = resolve(process.env.DATABASE_PATH || 'storage/voting-insights.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  county      TEXT NOT NULL,
  age_range   TEXT NOT NULL,
  marketing_ok INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_id     TEXT NOT NULL UNIQUE,
  answers_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  data_version TEXT NOT NULL,
  emailed_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_results_user ON quiz_results(user_id, created_at);

CREATE TABLE IF NOT EXISTS access_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS verification_codes (
  email      TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);
`);

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
}

export function createUser(u) {
  const info = db
    .prepare(
      `INSERT INTO users (first_name, last_name, email, county, age_range, marketing_ok)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(u.first_name, u.last_name, normalizeEmail(u.email), u.county, u.age_range, u.marketing_ok ? 1 : 0);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function updateUserProfile(id, u) {
  db.prepare(
    `UPDATE users SET first_name = ?, last_name = ?, county = ?, age_range = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(u.first_name, u.last_name, u.county, u.age_range, id);
}

export function issueToken(userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO access_tokens (token_hash, user_id) VALUES (?, ?)').run(sha(token), userId);
  return token;
}

export function userForToken(token) {
  if (!token || typeof token !== 'string') return null;
  return db
    .prepare('SELECT u.* FROM access_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?')
    .get(sha(token));
}

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

export function createVerificationCode(email) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(
    `INSERT INTO verification_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`
  ).run(normalizeEmail(email), sha(code), Date.now() + CODE_TTL_MS);
  return code;
}

export function checkVerificationCode(email, code) {
  const e = normalizeEmail(email);
  const row = db.prepare('SELECT * FROM verification_codes WHERE email = ?').get(e);
  if (!row || row.expires_at < Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) return false;
  if (row.code_hash !== sha(String(code || '').trim())) {
    db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?').run(e);
    return false;
  }
  db.prepare('DELETE FROM verification_codes WHERE email = ?').run(e);
  return true;
}

export function saveResult(userId, answers, results, dataVersion) {
  const shareId = randomBytes(9).toString('base64url');
  db.prepare(
    `INSERT INTO quiz_results (user_id, share_id, answers_json, results_json, data_version)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, shareId, JSON.stringify(answers), JSON.stringify(results), dataVersion);
  return getResult(shareId);
}

export function markEmailed(shareId) {
  db.prepare(`UPDATE quiz_results SET emailed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE share_id = ?`).run(shareId);
}

export function getResult(shareId) {
  return db
    .prepare(
      `SELECT r.*, u.first_name, u.last_name, u.email, u.county
       FROM quiz_results r JOIN users u ON u.id = r.user_id WHERE r.share_id = ?`
    )
    .get(shareId);
}

export function listResults(userId) {
  return db
    .prepare('SELECT share_id, results_json, created_at FROM quiz_results WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

export function exportUsers() {
  return db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.county, u.age_range, u.marketing_ok,
              u.created_at, COUNT(r.id) AS quiz_count, MAX(r.created_at) AS last_quiz_at
       FROM users u LEFT JOIN quiz_results r ON r.user_id = u.id
       GROUP BY u.id ORDER BY u.created_at`
    )
    .all();
}

export function exportResults() {
  return db
    .prepare(
      `SELECT r.id, r.share_id, u.email, u.county, u.age_range, r.data_version, r.created_at, r.emailed_at,
              r.answers_json, r.results_json
       FROM quiz_results r JOIN users u ON u.id = r.user_id ORDER BY r.created_at`
    )
    .all();
}
