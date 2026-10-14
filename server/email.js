import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const {
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  MAIL_FROM = 'Voting Insights <no-reply@localhost>',
} = process.env;

export const emailConfigured = Boolean(SMTP_HOST);

const transport = emailConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE ? SMTP_SECURE === 'true' : Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

// Without SMTP settings, messages are written to ./outbox so they can be previewed.
async function send({ to, subject, html, text }) {
  if (transport) {
    await transport.sendMail({ from: MAIL_FROM, to, subject, html, text });
    return;
  }
  const dir = resolve('outbox');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${Date.now()}-${to.replace(/[^a-z0-9]/gi, '_')}.html`);
  writeFileSync(file, `<!-- To: ${to} | Subject: ${subject} -->\n${html}`);
  console.log(`[email] SMTP not configured. Saved "${subject}" for ${to} to ${file}`);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const NAVY = '#13294B';
const RED = '#9E1B32';
const PAPER = '#F7F4EC';
const INK = '#1B1F24';
const RULE = '#CFC7B4';
const MUTED = '#5B6270';
const PARTY_COLOR = { Republican: '#9E1B32', Democratic: '#1F4E8C', Libertarian: '#8A6D1F', Green: '#2E6B3F' };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Arial, sans-serif";

function bar(score, color) {
  const pct = Math.max(0, Math.min(100, score ?? 0));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${RULE};background:#FFFDF8">
    <tr><td width="${pct}%" style="background:${color};height:10px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

function shell(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFDF8;border:1px solid ${RULE}">
<tr><td style="height:4px;background:${NAVY};font-size:0">&nbsp;</td></tr>
<tr><td style="height:4px;background:#FFFDF8;font-size:0">&nbsp;</td></tr>
<tr><td style="height:4px;background:${RED};font-size:0">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px 28px;font-family:${SERIF}">
  <div style="font-family:${SANS};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${MUTED}">Voting Insights &middot; Collin County, Texas</div>
  <h1 style="margin:8px 0 0 0;font-size:24px;font-weight:normal;color:${NAVY}">${esc(title)}</h1>
</td></tr>
${inner}
<tr><td style="padding:20px 28px 28px 28px;border-top:1px solid ${RULE};font-family:${SANS};font-size:12px;color:${MUTED};line-height:1.6">
  Voting Insights is an independent, nonpartisan guide. Match percentages compare your answers with documented public positions and do not endorse any candidate or party.
  General Election Day is Tuesday, November 3, 2026. Early voting runs October 19 through October 30.
</td></tr>
</table></td></tr></table></body></html>`;
}

export function resultsEmail({ firstName, results, shareUrl, guide, createdAt }) {
  const dateStr = new Date(createdAt).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'long',
    timeStyle: 'short',
  });
  const parties = [...results.parties]
    .filter((p) => p.score !== null)
    .map(
      (p) => `<tr><td style="padding:6px 0;font-family:${SANS};font-size:14px;width:120px">${esc(p.name)}</td>
        <td style="padding:6px 8px">${bar(p.score, PARTY_COLOR[p.name] || NAVY)}</td>
        <td style="padding:6px 0;font-family:${SANS};font-size:14px;width:48px;text-align:right"><b>${p.score}%</b></td></tr>`
    )
    .join('');

  const raceTitle = Object.fromEntries(guide.races.map((r) => [r.id, r.title]));
  const contested = results.races.filter((r) => !r.uncontested);
  const races = contested
    .map((r) => {
      const rows = r.candidates
        .map((c) => {
          const isTop = r.top === c.id;
          const score = c.score === null ? 'Not enough data' : `${c.score}%${c.limited ? ' (limited data)' : ''}`;
          return `<tr><td style="padding:3px 0;font-family:${SANS};font-size:13px;${isTop ? 'font-weight:bold;' : ''}">${esc(c.name)} <span style="color:${MUTED};font-weight:normal">(${esc(c.party)})</span></td>
            <td style="padding:3px 0;font-family:${SANS};font-size:13px;text-align:right;${isTop ? 'font-weight:bold;' : ''}">${score}</td></tr>`;
        })
        .join('');
      return `<tr><td style="padding:12px 0 4px 0;border-top:1px solid ${RULE}">
        <div style="font-family:${SERIF};font-size:15px;color:${NAVY};margin-bottom:4px">${esc(raceTitle[r.id] || r.title)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
    })
    .join('');

  const html = shell(
    'Your ballot alignment results',
    `<tr><td style="padding:8px 28px 0 28px;font-family:${SANS};font-size:14px;line-height:1.6">
      <p style="margin:0 0 12px 0">${esc(firstName)}, here are your results from ${esc(dateStr)} Central Time. You answered ${results.answered} of ${results.total} questions.</p>
      <p style="margin:0 0 16px 0"><a href="${esc(shareUrl)}" style="color:${NAVY}">View your full results online</a> to see every race, read candidate profiles, and check the sources behind each position.</p>
    </td></tr>
    <tr><td style="padding:8px 28px 0 28px">
      <div style="font-family:${SERIF};font-size:18px;color:${NAVY};border-bottom:2px solid ${NAVY};padding-bottom:4px;margin-bottom:8px">Party platform alignment</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${parties}</table>
    </td></tr>
    <tr><td style="padding:20px 28px 0 28px">
      <div style="font-family:${SERIF};font-size:18px;color:${NAVY};border-bottom:2px solid ${NAVY};padding-bottom:4px">Contested races</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${races}</table>
    </td></tr>
    <tr><td style="padding:16px 28px 8px 28px;font-family:${SANS};font-size:13px;color:${MUTED};line-height:1.6">
      Uncontested races are listed on the website. A bold name marks the closest documented match in that race. "Limited data" means fewer than three of your answers could be compared with that candidate's public record.
    </td></tr>`
  );

  const text = [
    `Your ballot alignment results (${dateStr} CT)`,
    '',
    'Party platform alignment:',
    ...results.parties.filter((p) => p.score !== null).map((p) => `  ${p.name}: ${p.score}%`),
    '',
    ...contested.flatMap((r) => [
      raceTitle[r.id] || r.title,
      ...r.candidates.map((c) => `  ${c.name} (${c.party}): ${c.score === null ? 'not enough data' : c.score + '%'}`),
    ]),
    '',
    `Full results: ${shareUrl}`,
  ].join('\n');

  return { subject: 'Your Collin County ballot alignment results', html, text };
}

export function codeEmail(code) {
  const html = shell(
    'Your verification code',
    `<tr><td style="padding:8px 28px 16px 28px;font-family:${SANS};font-size:14px;line-height:1.6">
      <p>Use this code to view your saved quiz results. It expires in 15 minutes.</p>
      <p style="font-family:${SERIF};font-size:32px;letter-spacing:6px;color:${NAVY};margin:16px 0">${esc(code)}</p>
      <p style="color:${MUTED}">If you did not request this code, you can ignore this message.</p>
    </td></tr>`
  );
  return { subject: `Your Voting Insights code: ${code}`, html, text: `Your Voting Insights code is ${code}. It expires in 15 minutes.` };
}

export async function sendResultsEmail(to, payload) {
  const msg = resultsEmail(payload);
  await send({ to, ...msg });
}

export async function sendCodeEmail(to, code) {
  const msg = codeEmail(code);
  await send({ to, ...msg });
}
