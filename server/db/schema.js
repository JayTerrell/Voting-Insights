// Database schema, written once for both SQLite and Postgres. Timestamps are
// ISO strings set by the application, and expiry times are epoch milliseconds,
// so the same queries work on both engines.

const TABLES = [
  'users',
  'quiz_results',
  'access_tokens',
  'rate_limits',
  'password_resets',
  'ballot_plans',
  'user_identities',
  'partner_links',
  'partner_events',
];

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
      password_hash TEXT,
      avatar        TEXT,
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
      share_issues INTEGER NOT NULL DEFAULT 0,
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
    `CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    ${ref} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id)',
    // Google and Apple accounts linked to a user. The subject is the provider's stable user id.
    `CREATE TABLE IF NOT EXISTS user_identities (
      provider   TEXT NOT NULL,
      subject    TEXT NOT NULL,
      user_id    ${ref} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email      TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, subject)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id)',
    // Starred races and candidates, and mock ballot choices, as one JSON document per account.
    `CREATE TABLE IF NOT EXISTS ballot_plans (
      user_id    ${ref} PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_json  TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    // Partner links: a person asks for votershub.info/go/<slug>, an admin approves it.
    `CREATE TABLE IF NOT EXISTS partner_links (
      id          ${id},
      user_id     ${ref} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug        TEXT NOT NULL UNIQUE,
      reason      TEXT NOT NULL,
      socials_json TEXT,
      status      TEXT NOT NULL,
      note        TEXT,
      created_at  TEXT NOT NULL,
      decided_at  TEXT,
      decided_by  ${ref}
    )`,
    'CREATE INDEX IF NOT EXISTS idx_partner_links_user ON partner_links(user_id)',
    // Anonymous activity that came through a partner link: visits, shares, polling lookups.
    // visitor is a hash that changes every day, so it counts daily unique visitors
    // and cannot be traced back to a person.
    `CREATE TABLE IF NOT EXISTS partner_events (
      id         ${id},
      link_id    ${ref} NOT NULL REFERENCES partner_links(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      day        TEXT NOT NULL,
      visitor    TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_partner_events_link ON partner_events(link_id, day)',
    `CREATE TABLE IF NOT EXISTS rate_limits (
      bucket   TEXT PRIMARY KEY,
      hits     INTEGER NOT NULL,
      reset_at BIGINT NOT NULL
    )`,
    // On Postgres hosts with an automatic REST API (such as Supabase), Row
    // Level Security with no policies blocks that API from every table. The
    // app connects as the table owner, which RLS does not restrict.
    ...(dialect === 'postgres' ? TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`) : []),
  ];
}

// Changes to tables created by earlier versions. Each step checks before it acts,
// so running them on every start is safe.
async function hasColumn(db, table, column) {
  return db.dialect === 'postgres'
    ? db.get(
        `SELECT 1 AS x FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
        [table, column]
      )
    : db.get(`SELECT 1 AS x FROM pragma_table_info('${table}') WHERE name = ?`, [column]);
}

export async function migrate(db) {
  const hasPassword =
    db.dialect === 'postgres'
      ? await db.get(
          `SELECT 1 AS x FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'password_hash'`
        )
      : await db.get(`SELECT 1 AS x FROM pragma_table_info('users') WHERE name = 'password_hash'`);
  if (!hasPassword) {
    await db.exec(`ALTER TABLE users ADD COLUMN ${db.dialect === 'postgres' ? 'IF NOT EXISTS ' : ''}password_hash TEXT`);
    // Sign-in tokens issued before passwords existed were handed out for an
    // email address alone, so every one of them is revoked.
    await db.exec('DELETE FROM access_tokens');
  }
  // Profile photos: a small cropped JPEG stored as a data URL.
  if (!(await hasColumn(db, 'users', 'avatar'))) {
    await db.exec(`ALTER TABLE users ADD COLUMN ${db.dialect === 'postgres' ? 'IF NOT EXISTS ' : ''}avatar TEXT`);
  }
  // Admins, and the partner link that brought someone to the site (set once, at sign-up).
  if (!(await hasColumn(db, 'users', 'is_admin'))) {
    await db.exec(
      `ALTER TABLE users ADD COLUMN ${db.dialect === 'postgres' ? 'IF NOT EXISTS ' : ''}is_admin INTEGER NOT NULL DEFAULT 0`
    );
  }
  if (!(await hasColumn(db, 'users', 'partner_link_id'))) {
    await db.exec(
      `ALTER TABLE users ADD COLUMN ${db.dialect === 'postgres' ? 'IF NOT EXISTS ' : ''}partner_link_id ${db.dialect === 'postgres' ? 'BIGINT' : 'INTEGER'}`
    );
  }
  // The social accounts a partner plans to share on, for the admin's review.
  if (!(await hasColumn(db, 'partner_links', 'socials_json'))) {
    await db.exec(`ALTER TABLE partner_links ADD COLUMN ${db.dialect === 'postgres' ? 'IF NOT EXISTS ' : ''}socials_json TEXT`);
  }
  // Whether a shared result also shows the person's top three issues (off by default).
  if (!(await hasColumn(db, 'quiz_results', 'share_issues'))) {
    await db.exec(
      `ALTER TABLE quiz_results ADD COLUMN ${db.dialect === 'postgres' ? 'IF NOT EXISTS ' : ''}share_issues INTEGER NOT NULL DEFAULT 0`
    );
  }
}
