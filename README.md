# Voting Insights: Texas 2026

A nonpartisan candidate guide and issue alignment quiz for the November 3, 2026 Texas general election. Ballot rosters come from Texas Secretary of State Ballot Certification Reports. Collin County (report dated October 14, 2026) is fully loaded. Other counties can be added from their own reports, as described in [docs/ADDING_A_COUNTY.md](docs/ADDING_A_COUNTY.md). Voters in counties not yet loaded see the statewide races.

The site has these sections:

- **Issue Quiz** (`/`, `/quiz`). Visitors enter their first name, last name, email, county, and age range, then answer 31 issue statements and rate how important each one is. Results show a match percentage for every candidate in every race and an alignment score for each party's official Texas platform. Results are saved, emailed, cached on the device, and can be shared.
- **Candidates** (`/candidates`). Races grouped by level. Each race page compares its candidates side by side (office duties, priorities, promises, record, documented positions, and numbered sources). Each candidate also has a profile page.
- **Compare by Issue** (`/issues`). Pick a quiz issue or another topic from a dropdown, or type any word to search everything recorded about every candidate.
- **My Results** (`/my-results`). Lists every saved attempt, with timestamps, for an email address. A device that already holds a sign-in token sees the list right away. A new device must enter a 6-digit code sent to that email.
- **Methodology, Terms of Use, and Privacy Policy.**

## Running locally

Requires Node.js 22.13 or newer. The database uses the built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
npm run build:data   # merges data/ into data/guide.json
npm start            # http://localhost:3000
npm test             # scoring and ballot import tests
```

Without SMTP settings, outgoing emails (results and verification codes) are written to `./outbox/` as HTML files, and verification codes are also printed to the server log.

## Configuration

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `PUBLIC_URL` | Public base URL used in share links and emails, for example `https://vote.example.org` |
| `DATABASE_PATH` | SQLite file path (default `storage/voting-insights.db`). Put this on a persistent disk. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | Outgoing mail server. Any SMTP provider works (Postmark, SendGrid, Amazon SES, Mailgun, Resend). |
| `MAIL_FROM` | From address, for example `Voting Insights <results@vote.example.org>` |
| `ADMIN_TOKEN` | Long random string that unlocks the CSV exports |
| `CONTACT_EMAIL` | Public corrections and privacy contact shown in the Terms and Privacy Policy |
| `TRUST_PROXY` | Express trust proxy setting (default `1`, correct behind most hosting proxies) |

## Collected data

The `users` table stores first name, last name, email (unique, case-insensitive), county, age range, update-email opt-in, and timestamps. The `quiz_results` table stores each attempt's answers, computed results, data version, share id, and timestamp. Export both as CSV:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-site/api/admin/users.csv -o users.csv
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-site/api/admin/results.csv -o results.csv
```

## Data files

| File | Contents |
|---|---|
| `data/races.json` | Every race and candidate, stored once even when a race spans several counties |
| `data/ballots/<county>.json` | The race ids on each county's ballot, in ballot order (written by `scripts/import-ballot.js`) |
| `data/name-overrides.json` | Corrections for names the importer cannot case correctly |
| `data/questions.json` | The 31 quiz statements, each with balanced background text and the offices it applies to |
| `data/offices.json` | What each office does, its term, and an official source |
| `data/research/*.json` | Candidate research (priorities, promises, record, stances, sources) and party platform mappings |
| `data/guide.json` | Built output served to the site. Regenerate it with `npm run build:data` after editing any file above. |

To add a county, run `node scripts/import-ballot.js report.pdf`, then `node scripts/research-status.js <County>` to list who still needs research. See [docs/ADDING_A_COUNTY.md](docs/ADDING_A_COUNTY.md) and [docs/RESEARCH_SPEC.md](docs/RESEARCH_SPEC.md).

The build script drops any claim that does not cite a source listed for that candidate, rejects positions outside the -2 to 2 scale, and removes em and en dashes. It prints a warning for each item it drops. `npm run check:links` checks every source URL.

## Scoring

The scoring code lives in `public/js/scoring.js` and is shared by the browser and the server. For each question that both the visitor and a candidate have a position on:

```
agreement = 1 - |answer - position| / 4
weight    = importance (0.5, 1, 2) x evidence weight (1.0 record/statement/questionnaire/platform, 0.85 reported, 0.6 inferred)
match     = (sum(weight x agreement) + 0.5 x 1.5) / (sum(weight) + 1.5)
```

The 1.5 term is a neutral prior that keeps a candidate with only one or two documented positions from showing an extreme score. A race counts only the questions tied to that office. Matches built on fewer than three questions are labeled "limited data."
