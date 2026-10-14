// Postgres driver for production (Neon, Supabase, Vercel Postgres, RDS, and others).
// Queries are written with "?" placeholders and converted to $1, $2, ... here.

import pg from 'pg';

// Return BIGINT columns as numbers rather than strings. Ids and epoch
// milliseconds stay well inside the safe integer range.
pg.types.setTypeParser(20, (v) => Number(v));

const toPositional = (sql) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

export function connect(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  return {
    dialect: 'postgres',
    async all(sql, params = []) {
      return (await pool.query(toPositional(sql), params)).rows;
    },
    async get(sql, params = []) {
      return (await pool.query(toPositional(sql), params)).rows[0] ?? null;
    },
    async run(sql, params = []) {
      return { changes: (await pool.query(toPositional(sql), params)).rowCount };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}
