// Postgres driver for production (Supabase, Neon, Vercel Postgres, RDS, and others).
// Queries are written with "?" placeholders and converted to $1, $2, ... here.

import pg from 'pg';

// Return BIGINT columns as numbers rather than strings. Ids and epoch
// milliseconds stay well inside the safe integer range.
pg.types.setTypeParser(20, (v) => Number(v));

const toPositional = (sql) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

// Hosts such as Supabase sign their certificates with their own certificate
// authority. When its certificate is supplied, connections are encrypted and
// fully verified against it. SSL settings in the URL are removed so they
// cannot override this.
function connectionOptions(connectionString, caCert) {
  if (!caCert) return { connectionString };
  const url = new URL(connectionString);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: { ca: caCert.replace(/\\n/g, '\n'), rejectUnauthorized: true },
  };
}

export function connect(connectionString, caCert) {
  const pool = new pg.Pool({
    ...connectionOptions(connectionString, caCert),
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
