// All runtime configuration comes from environment variables, read once here.

const env = process.env;

// Values pasted into hosting dashboards sometimes keep surrounding quotes or spaces.
const clean = (v) =>
  String(v ?? '')
    .trim()
    .replace(/^(['"])(.*)\1$/s, '$2')
    .trim();
const port = Number(env.PORT || 3000);

export const config = {
  port,
  publicUrl: (
    env.PUBLIC_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${port}`)
  ).replace(/\/$/, ''),
  isVercel: Boolean(env.VERCEL),
  isProduction: env.NODE_ENV === 'production' || Boolean(env.VERCEL),
  databaseUrl: clean(env.DATABASE_URL || env.POSTGRES_URL),
  databaseCaCert: env.DATABASE_CA_CERT || '',
  sqlitePath: env.DATABASE_PATH || 'storage/votershub.db',
  adminToken: env.ADMIN_TOKEN || '',
  // Accounts that are always admins. Others are made admins on the Admin page.
  adminEmails: (env.ADMIN_EMAILS || 'sjayshun@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  contactEmail: env.CONTACT_EMAIL || null,
  trustProxy: env.TRUST_PROXY ?? (env.VERCEL ? true : 1),
  // Signs short-lived Google and Apple sign-in state. Required for those buttons to appear.
  authSecret: env.AUTH_SECRET || '',
  google: {
    clientId: clean(env.GOOGLE_CLIENT_ID),
    clientSecret: clean(env.GOOGLE_CLIENT_SECRET),
  },
  apple: {
    clientId: clean(env.APPLE_CLIENT_ID),
    teamId: clean(env.APPLE_TEAM_ID),
    keyId: clean(env.APPLE_KEY_ID),
    privateKey: env.APPLE_PRIVATE_KEY || '',
  },
  // Optional: Google Civic Information API, for address-based polling place lookups.
  civicApiKey: clean(env.GOOGLE_CIVIC_API_KEY),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : Number(env.SMTP_PORT) === 465,
    from: env.MAIL_FROM || 'VotersHub <no-reply@localhost>',
  },
};

if (config.adminToken && config.adminToken.length < 24) {
  throw new Error('ADMIN_TOKEN must be at least 24 characters.');
}

if (config.authSecret && config.authSecret.length < 32) {
  throw new Error('AUTH_SECRET must be at least 32 characters.');
}
