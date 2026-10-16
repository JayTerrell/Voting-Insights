// Verifies OpenID Connect ID tokens (RS256) against a provider's published keys,
// and signs the ES256 client secret Apple requires. Uses node:crypto only.

import { createPublicKey, verify, sign } from 'node:crypto';

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export class TokenError extends Error {}

// keys: a JWKS object ({ keys: [...] }). Checks signature, issuer, audience, expiry, and nonce.
export function verifyIdToken(token, { keys, issuers, audience, nonce, now = Date.now() }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new TokenError('malformed token');
  const header = decode(parts[0]);
  const claims = decode(parts[1]);
  if (header.alg !== 'RS256') throw new TokenError('unexpected algorithm');
  const jwk = (keys?.keys || []).find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw new TokenError('unknown signing key');
  const ok = verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url')
  );
  if (!ok) throw new TokenError('bad signature');
  if (!issuers.includes(claims.iss)) throw new TokenError('wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) throw new TokenError('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new TokenError('expired');
  if (nonce && claims.nonce !== nonce) throw new TokenError('nonce mismatch');
  return claims;
}

// Apple's client secret is a short-lived JWT signed with the developer's private key.
export function appleClientSecret({ teamId, clientId, keyId, privateKey, now = Date.now() }) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const head = enc({ alg: 'ES256', kid: keyId });
  const body = enc({ iss: teamId, iat, exp: iat + 300, aud: 'https://appleid.apple.com', sub: clientId });
  const key = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}
