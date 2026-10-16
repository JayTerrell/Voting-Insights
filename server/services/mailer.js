// Sends email over SMTP. Without SMTP settings (local development), messages
// are written to ./outbox as HTML files instead.

import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { resultsEmail, passwordResetEmail } from './email-templates.js';

export const emailConfigured = Boolean(config.smtp.host);

// Messages that were not sent over SMTP, kept for local preview and tests.
export const devOutbox = [];

const transport = emailConfigured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    })
  : null;

async function send(to, { subject, html, text }) {
  if (transport) {
    await transport.sendMail({ from: config.smtp.from, to, subject, html, text });
    return;
  }
  if (config.isProduction) throw new Error('SMTP is not configured');
  devOutbox.push({ to, subject, html, text });
  if (devOutbox.length > 50) devOutbox.shift();
  if (process.env.NODE_ENV === 'test') return;
  const dir = resolve('outbox');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${Date.now()}-${to.replace(/[^a-z0-9]/gi, '_')}.html`);
  writeFileSync(file, html);
  console.log(`[mail] SMTP not configured. Saved "${subject}" for ${to} to ${file}`);
}

export const sendResultsEmail = (to, payload) => send(to, resultsEmail(payload));
export const sendPasswordResetEmail = (to, payload) => send(to, passwordResetEmail(payload));
