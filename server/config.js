// All runtime configuration comes from environment variables, read once here.

const env = process.env;
const port = Number(env.PORT || 3000);

export const config = {
  port,
  publicUrl: (
    env.PUBLIC_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${port}`)
  ).replace(/\/$/, ''),
  isVercel: Boolean(env.VERCEL),
  isProduction: env.NODE_ENV === 'production' || Boolean(env.VERCEL),
  databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || '',
  databaseCaCert: env.DATABASE_CA_CERT || '',
  sqlitePath: env.DATABASE_PATH || 'storage/voting-insights.db',
  adminToken: env.ADMIN_TOKEN || '',
  contactEmail: env.CONTACT_EMAIL || null,
  trustProxy: env.TRUST_PROXY ?? (env.VERCEL ? true : 1),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : Number(env.SMTP_PORT) === 465,
    from: env.MAIL_FROM || 'Voting Insights <no-reply@localhost>',
  },
};

if (config.adminToken && config.adminToken.length < 24) {
  throw new Error('ADMIN_TOKEN must be at least 24 characters.');
}
