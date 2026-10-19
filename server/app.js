// Builds the Express application. It has no listener and serves no static
// files, so the same app runs locally (server/index.js) and on Vercel (api/index.js).

import express from 'express';
import { config } from './config.js';
import { securityHeaders, noStore } from './middleware/security.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { guideRoutes } from './routes/guide.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import { pollingRoutes } from './routes/polling.js';
import { resultRoutes } from './routes/results.js';
import { shareRoutes } from './routes/share.js';
import { partnerRoutes } from './routes/partners.js';
import { adminRoutes } from './routes/admin.js';
import { pageRoutes } from './routes/pages.js';
import { healthRoutes } from './routes/health.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);

  const api = express.Router();
  // Profile photos are the only large request bodies; everything else stays small.
  const smallJson = express.json({ limit: '32kb', strict: true });
  const avatarJson = express.json({ limit: '256kb', strict: true });
  api.use((req, res, next) => (req.path === '/me/avatar' ? avatarJson : smallJson)(req, res, next));
  api.use(guideRoutes);
  api.use(healthRoutes);
  api.use(shareRoutes);
  api.use(noStore, accountRoutes);
  api.use(noStore, authRoutes);
  api.use(noStore, pollingRoutes);
  api.use(noStore, resultRoutes);
  api.use(noStore, partnerRoutes);
  api.use('/admin', noStore, adminRoutes);
  api.use(notFound);
  app.use('/api', api);

  app.use(pageRoutes);
  app.use(errorHandler);
  return app;
}
