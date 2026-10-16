import { Router } from 'express';
import { guideJson, dataVersion, formOptions } from '../services/guide.js';
import { config } from '../config.js';
import { enabledProviders } from '../services/oauth.js';

export const guideRoutes = Router();

guideRoutes.get('/guide', (req, res) => {
  const etag = `"${dataVersion}"`;
  res.set({ 'Cache-Control': 'public, max-age=300', ETag: etag });
  if (req.get('if-none-match') === etag) return res.status(304).end();
  res.type('application/json').send(guideJson);
});

guideRoutes.get('/form-options', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ ...formOptions, contact_email: config.contactEmail, auth_providers: enabledProviders() });
});
