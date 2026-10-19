// Google and Apple sign-in routes. The finished session token reaches the browser
// in the URL fragment of /auth/complete, which is never sent to any server.

import express, { Router } from 'express';
import * as oauth from '../services/oauth.js';
import * as accounts from '../services/accounts.js';
import { parseProfile } from '../lib/validation.js';
import { rateLimit } from '../middleware/rate-limit.js';

const MINUTES_15 = 15 * 60 * 1000;
const COOKIE = 'vi_oauth';
export const authRoutes = Router();

// Only same-site paths are accepted as the page to return to.
const safeNext = (next) => (/^\/[\w\-/]*$/.test(String(next || '')) && !String(next).startsWith('//') ? next : '/profile');

// SameSite=None lets the cookie return on Apple's cross-site form post. It is
// HttpOnly, scoped to /api/auth, signed, and expires in ten minutes.
const setStateCookie = (res, value) =>
  res.append('Set-Cookie', `${COOKIE}=${value}; Path=/api/auth; Max-Age=600; HttpOnly; Secure; SameSite=None`);
const clearStateCookie = (res) =>
  res.append('Set-Cookie', `${COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=None`);

function readCookie(req, name) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

authRoutes.get('/auth/providers', (req, res) => {
  res.json({ providers: oauth.enabledProviders() });
});

authRoutes.get('/auth/:provider/start', rateLimit('oauth-start', 30, MINUTES_15), (req, res) => {
  if (!oauth.providerFor(req.params.provider)) return res.redirect(303, '/sign-in?error=unavailable');
  const { url, cookie } = oauth.startUrl(req.params.provider, safeNext(req.query.next));
  setStateCookie(res, cookie);
  res.set('Cache-Control', 'no-store');
  res.redirect(303, url);
});

async function callback(req, res) {
  const name = req.params.provider;
  const params = { ...req.query, ...(req.body || {}) };
  clearStateCookie(res);
  res.set('Cache-Control', 'no-store');
  if (!oauth.providerFor(name)) return res.redirect(303, '/sign-in?error=unavailable');
  // The person pressed Cancel on the provider's page.
  if (params.error) return res.redirect(303, '/sign-in?error=cancelled');
  try {
    const identity = await oauth.finish(name, {
      code: params.code,
      state: params.state,
      cookie: readCookie(req, COOKIE),
      appleUser: typeof params.user === 'string' ? params.user : null,
    });
    const next = encodeURIComponent(safeNext(identity.next));
    const outcome = await accounts.signInWithIdentity(identity);
    if (outcome.session) return res.redirect(303, `/auth/complete#token=${outcome.session.token}&next=${next}`);
    return res.redirect(303, `/finish-sign-up#ticket=${outcome.ticket}&next=${next}`);
  } catch (err) {
    console.error(`[auth] ${name} sign-in failed:`, err.message);
    return res.redirect(303, '/sign-in?error=failed');
  }
}

authRoutes.get('/auth/:provider/callback', rateLimit('oauth-callback', 30, MINUTES_15), callback);
authRoutes.post(
  '/auth/:provider/callback',
  rateLimit('oauth-callback', 30, MINUTES_15),
  express.urlencoded({ extended: false, limit: '8kb' }),
  callback
);

// What the finish-sign-up form shows: the name and email the provider shared.
authRoutes.post('/auth/pending', rateLimit('oauth-pending', 30, MINUTES_15), (req, res) => {
  const id = accounts.pendingSignUp(String(req.body?.ticket || ''));
  res.json({ provider: id.provider, email: id.email, first_name: id.firstName, last_name: id.lastName });
});

authRoutes.post('/auth/complete', rateLimit('oauth-complete', 20, MINUTES_15), async (req, res) => {
  const body = req.body || {};
  const ticket = String(body.ticket || '');
  const identity = accounts.pendingSignUp(ticket);
  const profile = identity.email ? parseProfile({ ...body, email: identity.email }) : null;
  res.status(201).json(await accounts.completeSignUp(ticket, profile));
});
