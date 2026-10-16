# Deploying: Supabase, Resend, and Vercel

This guide sets up the production database (Supabase), email (Resend), and hosting (Vercel). Do the steps in order. Never paste passwords, API keys, or connection strings into chat, email, or GitHub. They belong only in Vercel's environment variables and your local `.env` file, which Git ignores.

## Part 1: Supabase (database)

The app creates its own tables the first time it connects, so there is nothing to build in the Supabase table editor.

### 1. Know your database password

You chose a database password when you created the project. If you do not have it, go to **Project Settings, Database** and select **Reset database password**. Use a long password made of letters and numbers only. Symbols such as `@`, `#`, `/`, or `%` must be URL-encoded inside a connection string, and they are a common cause of "password authentication failed" errors.

### 2. Copy the Transaction pooler connection string

1. Select the green **Connect** button at the top of the project dashboard.
2. Open the connection string section and choose the **URI** format.
3. Choose **Transaction pooler** (port **6543**). Vercel runs the app as short-lived serverless functions that open many brief connections, and the transaction pooler is built for that. The direct connection (port 5432) can run out of connections.
4. Copy the string. It looks like this, with your own project id and region host:

   ```
   postgresql://postgres.<project-id>:[YOUR-PASSWORD]@<region>.pooler.supabase.com:6543/postgres
   ```

5. Replace `[YOUR-PASSWORD]`, including the brackets, with your database password. This complete string is your `DATABASE_URL`.

### 3. Download the SSL certificate and enforce SSL

1. Go to **Project Settings, Database** and find **SSL Configuration**.
2. Select **Download certificate**. You get a small file (usually `prod-ca-2021.crt`). Open it in a text editor. Its full contents, from `-----BEGIN CERTIFICATE-----` through `-----END CERTIFICATE-----`, are your `DATABASE_CA_CERT`.
3. Turn on **Enforce SSL on incoming connections** in the same section.

Why: Supabase signs its database certificates with its own certificate authority. With this certificate, the app encrypts the connection and verifies it is really talking to Supabase.

### 4. Optional: test the connection from your computer

In the project folder, create a file named `.env`:

```
DATABASE_URL=postgresql://postgres.<project-id>:<password>@<region>.pooler.supabase.com:6543/postgres
DATABASE_CA_CERT="-----BEGIN CERTIFICATE-----
...the rest of the certificate...
-----END CERTIFICATE-----"
```

Then run:

```bash
npm install
npm run db:check
```

A successful check prints the six tables (`users`, `quiz_results`, `access_tokens`, `rate_limits`, `password_resets`, `ballot_plans`), each with "row level security on". In Supabase, **Table Editor** now shows them too. If the check fails, it prints the likely cause.

If you skip this step, the tables are created the first time someone uses the deployed site.

### 5. Security settings to confirm

- **Row Level Security** is turned on automatically for every table. Supabase publishes an automatic REST API for tables in the `public` schema, which anyone with the project's public "anon" key could call. With Row Level Security on and no policies, that API cannot read or write anything. The app connects as the database owner and is unaffected. **Advisors, Security Advisor** should show no "RLS disabled" warnings for these tables.
- **Optional, extra protection:** this app never uses Supabase's REST API, so you can turn it off. In **Project Settings**, open the **Data API** section and disable it, or remove `public` from the exposed schemas.
- **GitHub integration:** Supabase's GitHub connection is for Supabase's own migrations and branching. This app does not need it. Vercel is what deploys the code from GitHub.

### 6. Know the free plan limits

Free Supabase projects pause after about a week with no activity, and paused projects must be resumed from the dashboard. A live site with regular visitors stays active. Consider the Pro plan for launch so the database cannot pause during the election and so you get backups.

## Part 2: Resend (email)

Resend sends the results emails over SMTP.

1. **Verify a domain.** In Resend, open **Domains**, select **Add Domain**, and enter a domain you own (a subdomain like `mail.yourdomain.com` works well). Add the DNS records Resend shows (SPF, DKIM, and the optional DMARC record) at your domain registrar or DNS host, then select **Verify**. Without a verified domain, Resend only delivers to your own account email, which is fine for testing but not for visitors.
2. **Create an API key.** Open **API Keys**, select **Create API Key**, give it **Sending access**, and limit it to your verified domain. Copy the key when it is shown. Resend shows it only once.
3. **SMTP settings for this app:**

   | Variable      | Value                                                |
   | ------------- | ---------------------------------------------------- |
   | `SMTP_HOST`   | `smtp.resend.com`                                    |
   | `SMTP_PORT`   | `465`                                                |
   | `SMTP_SECURE` | `true`                                               |
   | `SMTP_USER`   | `resend`                                             |
   | `SMTP_PASS`   | your Resend API key                                  |
   | `MAIL_FROM`   | `Voting Insights <results@your-verified-domain.com>` |

   The address in `MAIL_FROM` must be on the domain you verified.

## Part 3: Vercel (hosting)

1. In Vercel, select **Add New, Project** and import the GitHub repository. Leave the framework preset as **Other**. `vercel.json` already sets the build command, output folder, API function, and security headers.
2. Before deploying, open **Environment Variables** and add these for **Production** (and **Preview** if you use preview deployments):

   | Variable                                                                       | Value                                                                                                                    |
   | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
   | `DATABASE_URL`                                                                 | From Supabase step 2                                                                                                     |
   | `DATABASE_CA_CERT`                                                             | The whole certificate from Supabase step 3. Vercel accepts multi-line values.                                            |
   | `PUBLIC_URL`                                                                   | Your site address, for example `https://voting-insights.vercel.app` or your custom domain                                |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | From Resend step 3                                                                                                       |
   | `ADMIN_TOKEN`                                                                  | A long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
   | `CONTACT_EMAIL`                                                                | The public address for corrections and privacy requests                                                                  |

3. Select **Deploy**.
4. Test the live site: create an account, take the quiz, and confirm the results email arrives. Then sign out, select **Forgot your password?** on the sign-in page, and confirm the reset email arrives. Password resets need working email, so finish Part 2 before launch. In Supabase, **Table Editor, users** should show your row.
5. Download the collected data at any time:

   ```bash
   curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<your-site>/api/admin/users.csv -o users.csv
   curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<your-site>/api/admin/results.csv -o results.csv
   ```

## Troubleshooting

| Symptom                                             | Likely cause                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `self-signed certificate in certificate chain`      | `DATABASE_CA_CERT` is missing or incomplete. Paste the entire certificate, including the BEGIN and END lines.               |
| `password authentication failed`                    | Wrong password in `DATABASE_URL`, or the password contains symbols that need URL-encoding. Reset it to letters and numbers. |
| `Tenant or user not found`                          | The username part of the pooler string must be `postgres.<project-id>`, exactly as Supabase shows it.                       |
| Results save but no email arrives                   | Check `SMTP_PASS`, and that `MAIL_FROM` uses your verified Resend domain. Resend's **Logs** page shows each attempt.        |
| The site shows "Something went wrong" on every quiz | Check the Vercel function logs. The app refuses to start on Vercel without `DATABASE_URL`.                                  |
