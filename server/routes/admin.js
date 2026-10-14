import { Router } from 'express';
import * as users from '../db/repositories/users.js';
import * as results from '../db/repositories/results.js';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { toCsv } from '../lib/csv.js';

export const adminRoutes = Router();
adminRoutes.use(rateLimit('admin', 30, 15 * 60 * 1000), requireAdmin);

adminRoutes.get('/users.csv', async (req, res) => {
  res
    .type('text/csv')
    .attachment('users.csv')
    .send(toCsv(await users.exportAll()));
});

adminRoutes.get('/results.csv', async (req, res) => {
  res
    .type('text/csv')
    .attachment('quiz-results.csv')
    .send(toCsv(await results.exportAll()));
});
