# Security

This document lists the protections in the application and what the operator must do when deploying it.

## Protections in the code

**SQL injection.** All SQL lives in `server/db/repositories/` and uses bound parameters (`?` placeholders, converted to `$1, $2, ...` for Postgres). No query is built by joining strings with request data. The API tests send injection payloads and confirm they are stored as plain text or rejected.

**Input validation.** `server/lib/validation.js` checks every request field before it reaches the database or an email:

- emails are matched against a strict pattern and length;
- names have control characters and `<` `>` removed and are capped at 60 characters;
- county and age range must match the allowed lists;
- quiz answers must use known question ids and scale values;
- share ids must match their exact format.

JSON bodies are limited to 32 KB.

**Cross-site scripting.** All dynamic text in the client is escaped through `esc()` in `client/js/ui.js` before it is written to the page, and email templates escape every value. The Content Security Policy only allows scripts from the site itself, with no inline scripts and no `eval`. Source links are accepted only with `http` or `https` URLs.

**Authentication.** There are no passwords or codes, by design: entering an email address opens the saved results for that address. A device receives a random 256-bit sign-in token when it starts the quiz or opens My Results, and that token is required to submit results, email them, see individual answers, or delete the account.

- Only SHA-256 hashes of tokens are stored.
- Tokens expire after 180 days and are revoked on sign-out.
- Tokens are sent in the `Authorization` header, never in cookies, so cross-site request forgery does not apply.

**Privacy of results.**

- A shared results link shows only the first name and percentages.
- Individual answers are returned only to the owner.
- Only the owner can trigger emails.
- Because My Results opens by email alone, anyone who knows a visitor's email can see that visitor's saved results. The Privacy Policy states this plainly. Lookups are rate limited to slow automated guessing.

**Rate limiting.** Registration, email lookups, result submission, email resends, account deletion, and admin exports are rate limited per client. Counters are stored in the database, so limits hold across serverless instances. Only a hash of the client IP is stored, and counters reset within 15 minutes.

**Admin exports.** These require `ADMIN_TOKEN` (at least 24 characters) in the `Authorization` header. The comparison is constant-time, and the token is never accepted in a URL. CSV cells that a spreadsheet would treat as formulas are neutralized.

**Headers.** Every response sends:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`

API responses use `Cache-Control: no-store`, and `X-Powered-By` is disabled.

**Errors.** Internal errors are logged on the server and return a generic message, never a stack trace.

**Dependencies.** The project uses three runtime dependencies (`express`, `nodemailer`, `pg`). Run `npm audit` before each deploy.

## Operator checklist

- Set a long random `ADMIN_TOKEN` and keep it out of chat and email.
- Use a Postgres connection string with TLS (`sslmode=require`).
- Verify your email sending domain (SPF, DKIM, DMARC) with your email provider.
- Keep `.env` files out of Git. They are already listed in `.gitignore`.
- Restrict database access to the Vercel project, and enable backups with your database provider.
- Review the Privacy Policy and Terms of Use with a lawyer before launch, and set `CONTACT_EMAIL`.

## Reporting a vulnerability

Email the address in `CONTACT_EMAIL` with details. Please do not open a public issue for security problems.
