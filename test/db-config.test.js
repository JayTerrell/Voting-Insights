import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePem } from '../server/db/postgres.js';
import { diagnoseDbError } from '../server/lib/db-diagnose.js';

const BODY = 'MIIDxTCCAq2gAwIBAgIQAqxcJmoLQJuPC3nyrkYldzANBgkqhkiG9w0BAQUFADBsMQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5j';
const pem = `-----BEGIN CERTIFICATE-----\n${BODY.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

test('certificates survive common paste mistakes', () => {
  assert.equal(normalizePem(pem), pem);
  assert.equal(normalizePem(`"${pem.trim()}"`), pem);
  assert.equal(normalizePem(pem.replace(/\n/g, '\r\n')), pem);
  assert.equal(normalizePem(pem.replace(/\n/g, ' ')), pem);
  assert.equal(normalizePem(pem.replace(/\n/g, '\\n')), pem);
  assert.equal(normalizePem('not a certificate'), '');
});

test('database errors map to plain explanations', () => {
  assert.match(diagnoseDbError({ code: '28P01', message: 'password authentication failed for user' }), /rejected the password/);
  assert.match(diagnoseDbError({ code: 'XX000', message: 'Tenant or user not found' }), /postgres\.<project-id>/);
  assert.match(
    diagnoseDbError({ code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'self-signed certificate in certificate chain' }),
    /DATABASE_CA_CERT/
  );
  assert.match(diagnoseDbError({ code: 'ENETUNREACH', message: 'connect ENETUNREACH' }), /Transaction pooler/);
  assert.match(diagnoseDbError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }), /host name/);
  assert.match(diagnoseDbError({ code: 'ERR_INVALID_URL', message: 'Invalid URL' }), /letters and numbers/);
  assert.match(diagnoseDbError({ code: 'ZZZ', message: 'weird' }), /code ZZZ/);
});
