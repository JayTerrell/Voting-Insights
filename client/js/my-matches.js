// The signed-in voter's most recent quiz answers, and their matches for any
// race. Answers come from this device when the quiz was taken here, otherwise
// from the account, so matches show on every device and every county's ballot.

import { api, session, resultCache } from './api.js';
import { scoreRace } from './shared/scoring.js';

let pending = null;
let pendingFor = null;

const latestCached = () =>
  Object.values(resultCache.all())
    .filter((r) => r.owner && r.answers)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;

async function fetchLatest() {
  const { results } = await api.myResults();
  const newest = [...(results || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!newest) return null;
  const full = await api.result(newest.share_id);
  if (full?.owner) resultCache.put(full);
  return full?.owner ? full : null;
}

// Resolves to the answers object, or null when the voter has not taken the quiz.
export async function myAnswers() {
  if (!session.token) return null;
  const cached = latestCached();
  if (cached) return cached.answers;
  if (!pending || pendingFor !== session.token) {
    pendingFor = session.token;
    pending = fetchLatest().catch(() => null);
  }
  const full = await pending;
  return full?.answers || null;
}

// Each candidate's match by id, plus the closest match and whether it is too close to call.
export function raceMatch(answers, guide, race) {
  if (!answers || race.candidates.length < 2) return null;
  const r = scoreRace(answers, guide, race);
  const byCandidate = Object.fromEntries(r.candidates.map((c) => [c.id, c]));
  return { byCandidate, top: r.top, tie: r.tie };
}
