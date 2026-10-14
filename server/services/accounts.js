// Account rules: one account per email address. Entering an email that already
// has an account opens that account on this device and updates its profile.

import * as users from '../db/repositories/users.js';
import * as tokens from '../db/repositories/tokens.js';
import * as quiz from './quiz.js';

export const publicUser = (u) => ({
  first_name: u.first_name,
  last_name: u.last_name,
  email: u.email,
  county: u.county,
  age_range: u.age_range,
});

// Starts a quiz session: creates the account, or reuses the existing one for this email.
export async function register(profile) {
  const existing = await users.findByEmail(profile.email);
  const user = existing ? await users.updateProfile(existing.id, profile) : await users.create(profile);
  return { token: await tokens.issue(user.id), user: publicUser(user) };
}

// Opens saved results for an email address. Returns null when no account exists.
export async function openByEmail(email) {
  const user = await users.findByEmail(email);
  if (!user) return null;
  return { token: await tokens.issue(user.id), user: publicUser(user), results: await quiz.listForUser(user) };
}

export const signOut = (token) => tokens.revoke(token);

export const deleteAccount = (user) => users.remove(user.id);
