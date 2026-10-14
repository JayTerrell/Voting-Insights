// Account rules: one account per email; reusing an email on a new device
// requires a code sent to that address.

import * as users from '../db/repositories/users.js';
import * as tokens from '../db/repositories/tokens.js';
import * as codes from '../db/repositories/codes.js';
import { sendCodeEmail } from './mailer.js';
import { ValidationError, parseProfile } from '../lib/validation.js';

export const publicUser = (u) => ({
  first_name: u.first_name,
  last_name: u.last_name,
  email: u.email,
  county: u.county,
  age_range: u.age_range,
});

async function sendCode(email) {
  const code = await codes.create(email);
  await sendCodeEmail(email, code);
}

// Returns { token, user } for a new account or a recognized device, or
// { verify: true } when the email already belongs to an account.
export async function register(profile, currentUser, currentToken) {
  const existing = await users.findByEmail(profile.email);
  if (!existing) {
    const user = await users.create(profile);
    return { token: await tokens.issue(user.id), user: publicUser(user) };
  }
  if (currentUser && currentUser.id === existing.id) {
    const user = await users.updateProfile(existing.id, profile);
    return { token: currentToken, user: publicUser(user) };
  }
  await sendCode(profile.email);
  return { verify: true };
}

// Sends a code only if the account exists. Callers respond the same way either
// way, so the form cannot reveal who has an account.
export async function requestCode(email) {
  if (await users.findByEmail(email)) await sendCode(email);
}

export async function verify(email, code, profileBody) {
  const valid = await codes.consume(email, code);
  const user = valid ? await users.findByEmail(email) : null;
  if (!user) throw new ValidationError('That code is incorrect or has expired.');
  let current = user;
  if (profileBody) {
    try {
      current = await users.updateProfile(user.id, parseProfile({ ...profileBody, email }, { requireConsent: false }));
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
    }
  }
  return { token: await tokens.issue(user.id), user: publicUser(current) };
}

export const signOut = (token) => tokens.revoke(token);

export const deleteAccount = (user) => users.remove(user.id);
