// Password hashing with scrypt from node:crypto. Stored format:
//   scrypt$<N>$<r>$<p>$<salt base64url>$<hash base64url>
// Parameters are stored with each hash so they can be raised later without
// breaking existing passwords.

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

const derive = (password, salt, n, r, p) =>
  new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, { N: n, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// A real hash of a random password, so checking an unknown email takes as long
// as checking a known one.
const DUMMY = hashPassword(randomBytes(16).toString('hex'));

export async function verifyPassword(password, stored) {
  const target = typeof stored === 'string' && stored.startsWith('scrypt$') ? stored : await DUMMY;
  const [, n, r, p, salt, hash] = target.split('$');
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(String(password), Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return target === stored && key.length === expected.length && timingSafeEqual(key, expected);
}
