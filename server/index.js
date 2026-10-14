// Local development server: the API plus the static client in one process.
// In production on Vercel, the CDN serves client/ and api/index.js runs the API.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { config } from './config.js';
import { emailConfigured } from './services/mailer.js';
import { dataVersion } from './services/guide.js';

const clientDir = fileURLToPath(new URL('../client', import.meta.url));
const app = createApp();

app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
// Client-side routes all load the single page shell.
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile('index.html', { root: clientDir }));

app.listen(config.port, () => {
  console.log(
    `Voting Insights at ${config.publicUrl} | data ${dataVersion} | ` +
      `database ${config.databaseUrl ? 'Postgres' : config.sqlitePath} | email ${emailConfigured ? 'SMTP' : 'outbox folder'}`
  );
});
