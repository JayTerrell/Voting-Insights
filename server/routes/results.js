import { Router } from 'express';
import * as quiz from '../services/quiz.js';
import * as results from '../db/repositories/results.js';
import { parseAnswers, isShareId } from '../lib/validation.js';
import { optionalUser, requireUser } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const MINUTES_15 = 15 * 60 * 1000;
export const resultRoutes = Router();

resultRoutes.post('/results', rateLimit('results', 30, MINUTES_15), requireUser, async (req, res) => {
  const outcome = await quiz.submit(req.user, parseAnswers(req.body?.answers));
  if (outcome.error) return res.status(400).json({ error: outcome.error });
  res.status(201).json(outcome);
});

resultRoutes.get('/results/:id', rateLimit('view', 120, MINUTES_15), optionalUser, async (req, res) => {
  const row = isShareId(req.params.id) ? await results.findByShareId(req.params.id) : null;
  if (!row) return res.status(404).json({ error: 'We could not find those results.' });
  res.json(quiz.publicView(row, req.user));
});

resultRoutes.post('/results/:id/email', rateLimit('email', 5, MINUTES_15), requireUser, async (req, res) => {
  const row = isShareId(req.params.id) ? await results.findByShareId(req.params.id) : null;
  if (!row || row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the person who took this quiz can email it.' });
  }
  await quiz.emailResult(row);
  res.json({ sent: true, to: row.email });
});

resultRoutes.get('/my-results', requireUser, async (req, res) => {
  res.json({ user: { first_name: req.user.first_name, email: req.user.email }, results: await quiz.listForUser(req.user) });
});
