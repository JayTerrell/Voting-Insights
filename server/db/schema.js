// Database schema, written once for both SQLite and Postgres. Timestamps are
// ISO strings set by the application, and expiry times are epoch milliseconds,
// so the same queries work on both engines.

export function schema(dialect) {
  const id = dialect === 'postgres' ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const ref = dialect === 'postgres' ? 'BIGINT' : 'INTEGER';
  return [
    `CREATE TABLE IF NOT EXISTS users (
      id           ${id},
      first_name   TEXT NOT NULL,
      last_name    TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      county       TEXT NOT NULL,
      age_range    TEXT NOT NULL,
      marketing_ok INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS quiz_results (
      id           ${id},
      user_id      ${ref} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      share_id     TEXT NOT NULL UNIQUE,
      answers_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      data_version TEXT NOT NULL,
      emailed_at   TEXT,
      created_at   TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_results_user ON quiz_results(user_id, created_at)',
    `CREATE TABLE IF NOT EXISTS access_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    ${ref} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_tokens_user ON access_tokens(user_id)',
    `CREATE TABLE IF NOT EXISTS rate_limits (
      bucket   TEXT PRIMARY KEY,
      hits     INTEGER NOT NULL,
      reset_at BIGINT NOT NULL
    )`,
  ];
}
