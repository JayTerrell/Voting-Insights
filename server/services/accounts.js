// Accounts: one per email address, opened with a password. Accounts created
// before passwords existed have no password yet; their owners set one through
// the emailed reset link, which proves they control the address.

import * as users from '../db/repositories/users.js';
import * as tokens from '../db/repositories/tokens.js';
import * as resets from '../db/repositories/password-resets.js';
import * as plans from '../db/repositories/ballot-plans.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { sendPasswordResetEmail } from './mailer.js';
import { config } from '../config.js';

export const publicUser = (u) => ({
  first_name: u.first_name,
  last_name: u.last_name,
  email: u.email,
  county: u.county,
  age_range: u.age_range,
  marketing_ok: Boolean(u.marketing_ok),
});

export class AccountError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.expose = true;
    this.code = code;
  }
}

const session = async (user) => ({ token: await tokens.issue(user.id), user: publicUser(user) });

export async function signUp(profile, password) {
  const existing = await users.findByEmail(profile.email);
  if (existing) {
    throw new AccountError(
      existing.password_hash
        ? 'An account with this email address already exists. Sign in instead.'
        : 'This email address has results saved from before accounts had passwords. Use "Forgot your password?" to set one.',
      409,
      existing.password_hash ? 'exists' : 'needs_password'
    );
  }
  const user = await users.create({ ...profile, passwordHash: await hashPassword(password) });
  return session(user);
}

const BAD_SIGN_IN = 'That email address and password do not match an account.';

export async function signIn(email, password) {
  const user = await users.findByEmail(email);
  // verifyPassword runs even for unknown emails so both cases take the same time.
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok) {
    if (user && !user.password_hash) {
      throw new AccountError(
        'This account was created before passwords were added. Use "Forgot your password?" to set one.',
        401,
        'needs_password'
      );
    }
    throw new AccountError(BAD_SIGN_IN, 401);
  }
  return session(user);
}

// Always succeeds from the caller's point of view, so it cannot be used to
// learn which email addresses have accounts.
export async function requestPasswordReset(email) {
  const user = await users.findByEmail(email);
  if (!user) return;
  const token = await resets.issue(user.id);
  try {
    // The token travels in the URL fragment, which browsers never send to servers or in referrers.
    await sendPasswordResetEmail(user.email, {
      firstName: user.first_name,
      resetUrl: `${config.publicUrl}/reset-password#token=${token}`,
    });
  } catch (err) {
    console.error('[accounts] password reset email failed', err.message);
  }
}

export async function resetPassword(token, password) {
  const userId = await resets.consume(token);
  if (!userId) throw new AccountError('This reset link has expired or was already used. Request a new one.', 400);
  await users.setPassword(userId, await hashPassword(password));
  await tokens.revokeAll(userId);
  return session(await users.findById(userId));
}

export async function changePassword(user, current, next) {
  if (!(await verifyPassword(current, user.password_hash))) {
    throw new AccountError('Your current password is not correct.', 401);
  }
  await users.setPassword(user.id, await hashPassword(next));
  await tokens.revokeAll(user.id);
  return session(user);
}

export async function updateProfile(user, profile) {
  return publicUser(await users.updateProfile(user.id, profile));
}

export const signOut = (token) => tokens.revoke(token);

export async function deleteAccount(user, password) {
  if (!(await verifyPassword(password, user.password_hash))) {
    throw new AccountError('Enter your current password to delete your account.', 401);
  }
  await users.remove(user.id);
}

const EMPTY_PLAN = { starred_races: [], starred_candidates: [], picks: {}, updated_at: null };
export const getPlan = async (user) => (await plans.find(user.id)) || EMPTY_PLAN;
export const savePlan = (user, plan) => plans.save(user.id, plan);
