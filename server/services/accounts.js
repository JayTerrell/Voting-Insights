// Accounts: one per email address, opened with a password or with a linked
// Google or Apple account. Accounts without a password (created before passwords
// existed, or through Google or Apple) can set one through the emailed reset
// link, which proves they control the address.

import * as users from '../db/repositories/users.js';
import * as tokens from '../db/repositories/tokens.js';
import * as resets from '../db/repositories/password-resets.js';
import * as plans from '../db/repositories/ballot-plans.js';
import * as identities from '../db/repositories/identities.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { sendPasswordResetEmail, sendWelcomeEmail } from './mailer.js';
import { ticketFor, readTicket } from './oauth.js';
import { config } from '../config.js';

export const publicUser = (u) => ({
  first_name: u.first_name,
  last_name: u.last_name,
  email: u.email,
  county: u.county,
  age_range: u.age_range,
  marketing_ok: Boolean(u.marketing_ok),
  has_password: Boolean(u.password_hash),
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

// A welcome note confirms the account and tells the owner of the address if
// someone else used it. A mail failure never blocks sign-up.
async function welcome(user, method) {
  try {
    await sendWelcomeEmail(user.email, {
      firstName: user.first_name,
      method,
      siteUrl: config.publicUrl,
      resetUrl: `${config.publicUrl}/forgot-password`,
    });
  } catch (err) {
    console.error('[accounts] welcome email failed', err.message);
  }
}

export async function signUp(profile, password) {
  const existing = await users.findByEmail(profile.email);
  if (existing) {
    throw new AccountError(
      existing.password_hash ? 'An account with this email address already exists. Sign in instead.' : NO_PASSWORD,
      409,
      existing.password_hash ? 'exists' : 'needs_password'
    );
  }
  const user = await users.create({ ...profile, passwordHash: await hashPassword(password) });
  await welcome(user, 'password');
  return session(user);
}

const NO_PASSWORD =
  'This account does not have a password yet. Continue with Google or Apple if you used them, or use "Forgot your password?" to set one.';

// After Google or Apple confirms who someone is: sign in a linked account, link a
// matching verified email, or hand back a ticket to finish signing up.
export async function signInWithIdentity(identity) {
  const linked = await identities.findUser(identity.provider, identity.subject);
  if (linked) return { session: await session(linked) };
  if (identity.email) {
    const byEmail = await users.findByEmail(identity.email);
    if (byEmail) {
      await identities.link(identity.provider, identity.subject, byEmail.id, identity.email);
      return { session: await session(byEmail) };
    }
  }
  return { ticket: ticketFor(identity) };
}

export function pendingSignUp(ticket) {
  const identity = readTicket(ticket);
  if (!identity) throw new AccountError('This sign-up link has expired. Please start again.', 400);
  return identity;
}

export async function completeSignUp(ticket, profile) {
  const identity = pendingSignUp(ticket);
  if (!identity.email) {
    throw new AccountError(
      'Your Google or Apple account did not share a verified email address, which we need for your account.',
      400
    );
  }
  // The person may have created an account another way while this form was open.
  const existing = await users.findByEmail(identity.email);
  const user = existing || (await users.create({ ...profile, email: identity.email, passwordHash: null }));
  await identities.link(identity.provider, identity.subject, user.id, identity.email);
  if (!existing) await welcome(user, identity.provider);
  return session(user);
}

export const linkedProviders = (user) => identities.providersFor(user.id);

const BAD_SIGN_IN = 'That email address and password do not match an account.';

export async function signIn(email, password) {
  const user = await users.findByEmail(email);
  // verifyPassword runs even for unknown emails so both cases take the same time.
  const ok = await verifyPassword(password, user?.password_hash);
  if (!user || !ok) {
    if (user && !user.password_hash) throw new AccountError(NO_PASSWORD, 401, 'needs_password');
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

// Accounts opened only with Google or Apple can add a password without a current one.
export async function changePassword(user, current, next) {
  if (user.password_hash && !(await verifyPassword(current, user.password_hash))) {
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

// Deleting needs the password, or for accounts without one, the email address typed out.
export async function deleteAccount(user, { password, confirmEmail }) {
  if (user.password_hash) {
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new AccountError('Enter your current password to delete your account.', 401);
    }
  } else if (
    String(confirmEmail || '')
      .trim()
      .toLowerCase() !== user.email
  ) {
    throw new AccountError('Type your email address exactly to confirm.', 401);
  }
  await users.remove(user.id);
}

const EMPTY_PLAN = { starred_races: [], starred_candidates: [], picks: {}, updated_at: null };
export const getPlan = async (user) => (await plans.find(user.id)) || EMPTY_PLAN;
export const savePlan = (user, plan) => plans.save(user.id, plan);
