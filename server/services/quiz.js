// Scores quiz answers, saves the result, and emails it.

import * as results from '../db/repositories/results.js';
import { scoreAll } from '../../shared/scoring.js';
import { guide, dataVersion } from './guide.js';
import { sendResultsEmail } from './mailer.js';
import { config } from '../config.js';

const MIN_ANSWERS = 5;
const EMAIL_TIMEOUT_MS = 8000;

export const shareUrl = (shareId) => `${config.publicUrl}/results/${shareId}`;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Email timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function emailResult(row) {
  await sendResultsEmail(row.email, {
    firstName: row.first_name,
    results: JSON.parse(row.results_json),
    shareUrl: shareUrl(row.share_id),
    createdAt: row.created_at,
  });
  await results.markEmailed(row.share_id);
}

// Serverless platforms may stop work once a response is sent, so the email is
// sent before responding. A mail failure is logged but does not lose the result.
export async function submit(user, answers) {
  if (Object.keys(answers).length < MIN_ANSWERS)
    return { error: `Please answer at least ${MIN_ANSWERS} questions to see meaningful results.` };
  const scored = scoreAll(answers, guide, user.county);
  const created = await results.create(user.id, answers, scored, dataVersion);
  const row = await results.findByShareId(created.share_id);
  let emailed = true;
  try {
    await withTimeout(emailResult(row), EMAIL_TIMEOUT_MS);
  } catch (err) {
    emailed = false;
    console.error('[quiz] results email failed', err.message);
  }
  return { share_id: row.share_id, created_at: row.created_at, results: scored, answers, emailed };
}

export function publicView(row, viewer) {
  const owner = Boolean(viewer && viewer.id === row.user_id);
  return {
    share_id: row.share_id,
    created_at: row.created_at,
    first_name: row.first_name,
    owner,
    results: JSON.parse(row.results_json),
    answers: owner ? JSON.parse(row.answers_json) : undefined,
    data_version: row.data_version,
    current_version: dataVersion,
  };
}

export async function listForUser(user) {
  const rows = await results.listForUser(user.id);
  return rows.map((r) => {
    const parsed = JSON.parse(r.results_json);
    return { share_id: r.share_id, created_at: r.created_at, answered: parsed.answered, parties: parsed.parties };
  });
}
