// A status check for the operator: /api/health reports whether the database is
// reachable and, if not, the likely cause. It reveals no settings or secrets.

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { config } from '../config.js';
import { emailConfigured } from '../services/mailer.js';
import { dataVersion } from '../services/guide.js';
import { diagnoseDbError } from '../lib/db-diagnose.js';

export const healthRoutes = Router();

healthRoutes.get('/health', async (req, res) => {
  const report = {
    status: 'ok',
    data_version: dataVersion,
    database: { engine: config.databaseUrl ? 'postgres' : 'sqlite', certificate_set: Boolean(config.databaseCaCert) },
    email: emailConfigured ? 'configured' : 'not configured',
  };
  try {
    if (/YOUR-PASSWORD/i.test(config.databaseUrl)) {
      throw Object.assign(new Error('placeholder'), { placeholder: true });
    }
    const db = await getDb();
    await db.get('SELECT 1 AS ok');
    report.database.connected = true;
  } catch (err) {
    console.error('[health] database check failed', err);
    report.status = 'error';
    report.database.connected = false;
    report.database.problem = err.placeholder
      ? 'DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Replace it, brackets included, with the database password.'
      : diagnoseDbError(err);
  }
  res
    .set('Cache-Control', 'no-store')
    .status(report.status === 'ok' ? 200 : 503)
    .json(report);
});
