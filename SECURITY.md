# Security

This document lists the protections in the application and what the operator must do when deploying it.

## Protections in the code

**SQL injection.** All SQL lives in `server/db/repositories/` and uses bound parameters (`?` placeholders, converted to `$1, $2, ...` for Postgres). No query is built by joining strings with request data. The API tests send injection payloads and confirm they are stored as plain text or rejected.

**Database exposure.** On Postgres, every table has Row Level Security enabled with no policies. Hosts such as Supabase publish an automatic REST API for the `public` schema, and this setting blocks that API from reading or writing any table. The app connects as the table owner, which Row Level Security does not restrict. Database connections use TLS verified against the provider's certificate (`DATABASE_CA_CERT`).

**Input validation.** `server/lib/validation.js` checks every request field before it reaches the database or an email:

- emails are matched against a strict pattern and length;
- names have control characters and `<` `>` removed and are capped at 60 characters;
- county and age range must match the allowed lists;
- quiz answers must use known question ids and scale values;
- share ids must match their exact format.

JSON bodies are limited to 32 KB.

**Cross-site scripting.** All dynamic text in the client is escaped through `esc()` in `client/js/ui.js` before it is written to the page, and email templates escape every value. The Content Security Policy only allows scripts from the site itself, with no inline scripts and no `eval`. Source links are accepted only with `http` or `https` URLs.

**Authentication.** Browsing is open to everyone. Taking the quiz, viewing saved results, and saving a ballot plan to an account require signing in with an email address and password.

- Passwords are hashed with scrypt (N=16384, r=8, p=1, 16-byte random salt). Parameters are stored with each hash so they can be raised later. Passwords must be 8 to 200 characters; there are no composition rules, following NIST SP 800-63B, but the most common breached passwords are rejected. The site never emails a password.
- Unknown emails are checked against a dummy hash, so a sign-in takes the same time whether or not the account exists.
- A successful sign-in returns a random 256-bit token. Only its SHA-256 hash is stored. Tokens expire after 180 days, are revoked on sign-out, and every token for the account is revoked when the password changes or is reset.
- Tokens are sent in the `Authorization` header, never in cookies, so cross-site request forgery does not apply.
- Password reset links carry a one-time token in the URL fragment, which browsers never send to servers or in referrers. Reset tokens are stored hashed, expire after one hour, and are deleted on use. The "forgot password" endpoint gives the same response whether or not an account exists.
- Deleting an account requires the current password.
- Accounts created before passwords existed have no password; their owners set one through the emailed reset link. When passwords were introduced, every existing sign-in token was revoked, because those tokens had been issued for an email address alone.

**Sign in with Google and Apple.** OpenID Connect authorization code flow, implemented with `node:crypto` only (`server/services/oauth.js`, `server/lib/jwt.js`).

- A random `state`, `nonce`, and (for Google) PKCE verifier are kept in a signed, HttpOnly, ten-minute cookie scoped to `/api/auth`. The callback rejects any state that does not match.
- ID tokens are verified against the provider's published keys: RS256 signature, issuer, audience, expiry, and nonce. Other algorithms are refused.
- An identity links to an existing account only when the provider marks the email as verified. Unverified emails never take over an account.
- New users finish sign-up (county, age range, terms) with a signed ticket that expires in 30 minutes.
- The finished session token is passed to the browser in a URL fragment, which is never sent to servers or in referrers.
- `AUTH_SECRET` (at least 32 characters) signs the state cookie and tickets. Without it, the Google and Apple buttons are hidden.

**Privacy of results.**

- A shared results link shows only the first name and percentages.
- Individual answers are returned only to the signed-in owner.
- Only the owner can trigger emails.

**Rate limiting.** Sign-up, sign-in, password reset requests, result submission, email resends, ballot plan saves, account deletion, and admin exports are rate limited per client IP. Sign-in is also limited to 10 attempts per 15 minutes for each email address, and reset emails to 3 per hour per address, so spreading attempts across many IPs does not help against one account. Counters are stored in the database, so limits hold across serverless instances. Only hashes of IPs and email addresses are stored in the counters.

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
