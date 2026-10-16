import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { verifyIdToken, appleClientSecret } from '../server/lib/jwt.js';
import { seal, unseal } from '../server/lib/signed.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims, kid = 'k1', alg = 'RS256') {
  const h = b64({ alg, kid });
  const b = b64({
    iss: 'https://accounts.google.com',
    aud: 'client',
    exp: Math.floor(Date.now() / 1000) + 60,
    nonce: 'n',
    ...claims,
  });
  return `${h}.${b}.${sign('RSA-SHA256', Buffer.from(`${h}.${b}`), privateKey).toString('base64url')}`;
}
const opts = { keys, issuers: ['https://accounts.google.com'], audience: 'client', nonce: 'n' };

test('ID tokens are verified for signature, issuer, audience, expiry, and nonce', () => {
  assert.equal(verifyIdToken(token({ sub: '1' }), opts).sub, '1');
  assert.throws(() => verifyIdToken(token({ aud: 'other' }), opts), /audience/);
  assert.throws(() => verifyIdToken(token({ iss: 'https://evil.example' }), opts), /issuer/);
  assert.throws(() => verifyIdToken(token({ exp: 1 }), opts), /expired/);
  assert.throws(() => verifyIdToken(token({ nonce: 'x' }), opts), /nonce/);
  assert.throws(() => verifyIdToken(token({}, 'k2'), opts), /signing key/);
  assert.throws(() => verifyIdToken(token({}, 'k1', 'none'), opts), /algorithm/);
  const t = token({ sub: '1' }).split('.');
  t[1] = b64({ iss: 'https://accounts.google.com', aud: 'client', exp: 9e9, nonce: 'n', sub: 'admin' });
  assert.throws(() => verifyIdToken(t.join('.'), opts), /signature/);
});

test('the Apple client secret is a valid ES256 JWT', () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = ec.privateKey.export({ format: 'pem', type: 'pkcs8' });
  const jwt = appleClientSecret({ teamId: 'TEAM', clientId: 'org.example.web', keyId: 'KEY', privateKey: pem });
  const [h, b, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  assert.equal(claims.iss, 'TEAM');
  assert.equal(claims.sub, 'org.example.web');
  assert.ok(
    verify('sha256', Buffer.from(`${h}.${b}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
  );
});

test('sealed values reject tampering and expiry', () => {
  const v = seal({ a: 1 }, 's'.repeat(32), 60_000);
  assert.equal(unseal(v, 's'.repeat(32)).a, 1);
  assert.equal(unseal(v, 't'.repeat(32)), null);
  assert.equal(unseal(`${v.split('.')[0]}.forged`, 's'.repeat(32)), null);
  assert.equal(unseal(seal({ a: 1 }, 's'.repeat(32), -1), 's'.repeat(32)), null);
});
