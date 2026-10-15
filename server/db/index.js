// Opens the database once per process and creates tables if needed.
// DATABASE_URL selects Postgres; otherwise a local SQLite file is used.

import { config } from '../config.js';
import { schema } from './schema.js';

let ready;

export function getDb() {
  if (config.isVercel && !config.databaseUrl) {
    // Serverless functions have no persistent disk, so SQLite data would vanish.
    const err = new Error('Saving and loading results is not available yet because the database has not been set up.');
    err.status = 503;
    err.expose = true;
    return Promise.reject(err);
  }
  if (!ready) {
    ready = (async () => {
      const db = config.databaseUrl
        ? (await import('./postgres.js')).connect(config.databaseUrl, config.databaseCaCert)
        : (await import('./sqlite.js')).connect(config.sqlitePath);
      for (const statement of schema(db.dialect)) await db.exec(statement);
      return db;
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

// For tests: close the current connection so the next getDb() opens a new one.
export async function resetDb() {
  if (ready) (await ready).close();
  ready = null;
}
