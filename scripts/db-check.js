// Checks the database connection and creates the tables if needed.
//   npm run db:check          (reads DATABASE_URL and DATABASE_CA_CERT from .env)
// Prints each table with its row count and whether Row Level Security is on.

import { getDb, resetDb } from '../server/db/index.js';
import { config } from '../server/config.js';

if (!config.databaseUrl) {
  console.log(`DATABASE_URL is not set, so the local SQLite file ${config.sqlitePath} is used.`);
}

try {
  const db = await getDb();
  console.log(`Connected to ${db.dialect === 'postgres' ? 'Postgres' : 'SQLite'}. Tables are ready.`);
  const tables = ['users', 'quiz_results', 'access_tokens', 'rate_limits', 'password_resets', 'ballot_plans', 'user_identities'];
  for (const t of tables) {
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM ${t}`);
    let rls = '';
    if (db.dialect === 'postgres') {
      const row = await db.get('SELECT relrowsecurity FROM pg_class WHERE relname = ? AND relkind = ?', [t, 'r']);
      rls = row?.relrowsecurity ? ', row level security on' : ', ROW LEVEL SECURITY OFF';
    }
    console.log(`  ${t}: ${n} rows${rls}`);
  }
  await resetDb();
} catch (err) {
  console.error('Database check failed:', err.message);
  if (/self-signed|certificate/i.test(err.message)) {
    console.error('Set DATABASE_CA_CERT to the certificate from your database provider (see docs/DEPLOYING.md).');
  }
  if (/password authentication/i.test(err.message)) {
    console.error('The database password in DATABASE_URL is wrong. Special characters must be URL-encoded.');
  }
  process.exit(1);
}
