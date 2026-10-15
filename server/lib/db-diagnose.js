// Turns a database connection error into a short, safe explanation. Messages
// name the likely misconfiguration but never echo secrets from the settings.

const RULES = [
  [(e) => /not been set up/.test(e.message), 'DATABASE_URL is not set on this deployment. Add it in Vercel, then redeploy.'],
  [
    (e) => e.code === 'ERR_INVALID_URL' || /Invalid URL/i.test(e.message),
    'DATABASE_URL is not a valid address. A password containing symbols such as @ # / % ? breaks it; use letters and numbers only.',
  ],
  [
    (e) => e.code === '28P01' || /password authentication failed/i.test(e.message),
    'The database rejected the password in DATABASE_URL. Reset the database password in Supabase (letters and numbers only) and update DATABASE_URL.',
  ],
  [
    (e) => /Tenant or user not found/i.test(e.message),
    'Supabase did not recognize the user. The user part of DATABASE_URL must be postgres.<project-id>, exactly as the Transaction pooler string shows it.',
  ],
  [
    (e) => ['ENOTFOUND', 'EAI_AGAIN'].includes(e.code),
    'The database host name in DATABASE_URL was not found. Copy the Transaction pooler string again.',
  ],
  [
    (e) => ['ENETUNREACH', 'EHOSTUNREACH'].includes(e.code) || /ENETUNREACH/.test(e.message),
    'The database host is unreachable from Vercel. Use the Transaction pooler string (port 6543), not the direct connection.',
  ],
  [(e) => e.code === 'ECONNREFUSED', 'The database refused the connection. Check the host and that the port is 6543.'],
  [
    (e) => e.code === 'ETIMEDOUT' || /timeout/i.test(e.message),
    'The connection timed out. Check the host and that the port is 6543, and that the Supabase project is not paused.',
  ],
  [
    (e) => /PEM|no start line|ERR_OSSL|bad base64|asn1/i.test(`${e.code} ${e.message}`),
    'DATABASE_CA_CERT could not be read. Paste the whole certificate file, from -----BEGIN CERTIFICATE----- to -----END CERTIFICATE-----.',
  ],
  [
    (e) => /self.signed|certificate|unable to verify|UNABLE_TO_GET_ISSUER|CERT_/i.test(`${e.code} ${e.message}`),
    'The database certificate could not be verified. Set DATABASE_CA_CERT to the certificate downloaded from Supabase (Project Settings, Database, SSL Configuration).',
  ],
  [
    (e) => /does not support SSL/i.test(e.message),
    'The database does not accept SSL connections. Check that DATABASE_URL points at Supabase.',
  ],
];

export function diagnoseDbError(err) {
  const rule = RULES.find(([test]) => test(err));
  return rule
    ? rule[1]
    : `Unexpected database error${err.code ? ` (code ${err.code})` : ''}. Check the Vercel runtime logs for details.`;
}
