// Input validation. Every value from a request passes through here before it
// reaches the database or an email.

import { formOptions, questionIds, raceCandidates, candidateIds } from '../services/guide.js';
import { PASSWORD_MIN, PASSWORD_MAX } from './password.js';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const SHARE_ID_RE = /^[A-Za-z0-9_-]{12}$/;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

export const normalizeEmail = (email) =>
  String(email ?? '')
    .trim()
    .toLowerCase();

export function isEmail(email) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function requireEmail(raw) {
  const email = normalizeEmail(raw);
  if (!isEmail(email)) throw new ValidationError('Please enter a valid email address.');
  return email;
}

// Strips control characters and markup delimiters and caps the length.
export function cleanText(value, max = 60) {
  return (
    String(value ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .slice(0, max)
  );
}

export function parseProfile(body, { requireConsent = true } = {}) {
  const profile = {
    firstName: cleanText(body.first_name),
    lastName: cleanText(body.last_name),
    email: normalizeEmail(body.email),
    county: cleanText(body.county),
    ageRange: cleanText(body.age_range),
    marketingOk: body.marketing_ok === true,
  };
  if (!profile.firstName || !profile.lastName) throw new ValidationError('Please enter your first and last name.');
  if (!isEmail(profile.email)) throw new ValidationError('Please enter a valid email address.');
  if (!formOptions.counties.includes(profile.county)) throw new ValidationError('Please choose your county.');
  if (!formOptions.age_ranges.includes(profile.ageRange)) throw new ValidationError('Please choose your age range.');
  if (requireConsent && body.agree_terms !== true) {
    throw new ValidationError('Please agree to the Terms of Use and Privacy Policy to continue.');
  }
  return profile;
}

export function requirePassword(raw) {
  const password = typeof raw === 'string' ? raw : '';
  if (password.length < PASSWORD_MIN)
    throw new ValidationError(`Please choose a password of at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) throw new ValidationError(`Passwords can be at most ${PASSWORD_MAX} characters.`);
  return password;
}

// A ballot plan: starred race and candidate ids, and one chosen candidate per race.
// Unknown ids are dropped, so a plan saved before a data update still loads.
export function parsePlan(raw) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const starredRaces = [...new Set(Array.isArray(body.starred_races) ? body.starred_races : [])]
    .filter((id) => typeof id === 'string' && raceCandidates.has(id))
    .slice(0, 2000);
  const starredCandidates = [...new Set(Array.isArray(body.starred_candidates) ? body.starred_candidates : [])]
    .filter((id) => typeof id === 'string' && candidateIds.has(id))
    .slice(0, 4000);
  const picks = {};
  if (body.picks && typeof body.picks === 'object' && !Array.isArray(body.picks)) {
    for (const [raceId, candId] of Object.entries(body.picks).slice(0, 2000)) {
      if (raceCandidates.get(raceId)?.has(candId)) picks[raceId] = candId;
    }
  }
  return { starred_races: starredRaces, starred_candidates: starredCandidates, picks };
}

export const isShareId = (id) => SHARE_ID_RE.test(String(id));

// Keeps only known questions with values on the quiz scales.
export function parseAnswers(raw) {
  const answers = {};
  if (!raw || typeof raw !== 'object') return answers;
  for (const [qid, a] of Object.entries(raw)) {
    if (!questionIds.has(qid) || !a || typeof a !== 'object') continue;
    const value = Number(a.value);
    const weight = Number(a.weight);
    if (![-2, -1, 0, 1, 2].includes(value)) continue;
    answers[qid] = { value, weight: [0.5, 1, 2].includes(weight) ? weight : 1 };
  }
  return answers;
}
