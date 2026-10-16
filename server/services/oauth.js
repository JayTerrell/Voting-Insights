// Sign in with Google and Sign in with Apple (OpenID Connect, authorization code flow).
//
// 1. /api/auth/:provider/start stores a random state, nonce, and PKCE verifier in a
//    signed, HttpOnly cookie and redirects to the provider.
// 2. The provider redirects back to /api/auth/:provider/callback with a code. The
//    state must match the cookie. The code is exchanged for an ID token, whose
//    signature, issuer, audience, expiry, and nonce are verified.
// 3. A known identity signs in. A verified email that matches an existing account
//    links to it. Anyone else finishes sign-up (county, age range, terms) with a
//    signed ticket that expires in 30 minutes.

import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { randomToken } from '../lib/crypto.js';
import { seal, unseal } from '../lib/signed.js';
import { verifyIdToken, appleClientSecret } from '../lib/jwt.js';
import { cleanText } from '../lib/validation.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 30 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;

const PROVIDERS = {
  google: {
    label: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
    pkce: true,
    configured: () => Boolean(config.google.clientId && config.google.clientSecret),
    clientId: () => config.google.clientId,
    clientSecret: () => config.google.clientSecret,
  },
  apple: {
    label: 'Apple',
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    scope: 'name email',
    // Apple posts the result back as a form when name or email is requested.
    responseMode: 'form_post',
    pkce: false,
    configured: () => Boolean(config.apple.clientId && config.apple.teamId && config.apple.keyId && config.apple.privateKey),
    clientId: () => config.apple.clientId,
    clientSecret: () => appleClientSecret(config.apple),
  },
};

// Network calls go through this object so tests can stand in for the providers.
export const oauthHttp = { fetch: (...args) => fetch(...args) };

export const enabledProviders = () => (config.authSecret ? Object.keys(PROVIDERS).filter((p) => PROVIDERS[p].configured()) : []);

export const providerFor = (name) => (enabledProviders().includes(name) ? PROVIDERS[name] : null);

export const redirectUri = (name) => `${config.publicUrl}/api/auth/${name}/callback`;

const challenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');

export function startUrl(name, next) {
  const p = PROVIDERS[name];
  const state = randomToken(16);
  const nonce = randomToken(16);
  const verifier = p.pkce ? randomToken(32) : null;
  const params = new URLSearchParams({
    client_id: p.clientId(),
    redirect_uri: redirectUri(name),
    response_type: 'code',
    scope: p.scope,
    state,
    nonce,
  });
  if (p.responseMode) params.set('response_mode', p.responseMode);
  if (verifier) {
    params.set('code_challenge', challenge(verifier));
    params.set('code_challenge_method', 'S256');
  }
  if (name === 'google') params.set('prompt', 'select_account');
  const cookie = seal({ p: name, state, nonce, verifier, next }, config.authSecret, STATE_TTL_MS);
  return { url: `${p.authUrl}?${params}`, cookie };
}

const jwksCache = new Map();
async function jwks(p) {
  const hit = jwksCache.get(p.jwksUrl);
  if (hit && hit.until > Date.now()) return hit.keys;
  const res = await oauthHttp.fetch(p.jwksUrl);
  if (!res.ok) throw new Error(`could not load signing keys (${res.status})`);
  const keys = await res.json();
  jwksCache.set(p.jwksUrl, { keys, until: Date.now() + JWKS_TTL_MS });
  return keys;
}

// Verifies the callback and returns the person's identity from the ID token.
export async function finish(name, { code, state, cookie, appleUser }) {
  const p = PROVIDERS[name];
  const saved = unseal(cookie, config.authSecret);
  if (!saved || saved.p !== name || !state || saved.state !== state) throw new Error('sign-in state did not match');
  if (typeof code !== 'string' || !code || code.length > 2048) throw new Error('missing authorization code');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(name),
    client_id: p.clientId(),
    client_secret: p.clientSecret(),
  });
  if (saved.verifier) body.set('code_verifier', saved.verifier);
  const res = await oauthHttp.fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const tokens = await res.json().catch(() => ({}));
  if (!res.ok || !tokens.id_token) throw new Error(`token exchange failed (${res.status})`);

  const claims = verifyIdToken(tokens.id_token, {
    keys: await jwks(p),
    issuers: p.issuers,
    audience: p.clientId(),
    nonce: saved.nonce,
  });
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  // Apple sends the name only on the first sign-in, in the posted form, never in the token.
  let first = claims.given_name || '';
  let last = claims.family_name || '';
  if (appleUser) {
    try {
      const u = JSON.parse(appleUser);
      first = u?.name?.firstName || first;
      last = u?.name?.lastName || last;
    } catch {
      /* ignore a malformed user field */
    }
  }
  return {
    provider: name,
    subject: String(claims.sub),
    email: verified && claims.email ? String(claims.email).trim().toLowerCase() : null,
    firstName: cleanText(first),
    lastName: cleanText(last),
    next: saved.next,
  };
}

export const ticketFor = (identity) => seal(identity, config.authSecret, TICKET_TTL_MS);
export const readTicket = (ticket) => unseal(ticket, config.authSecret);
