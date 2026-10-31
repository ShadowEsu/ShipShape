# ShipShape

A paperwork passport for small businesses. Every new customer, landlord or general contractor asks for the same papers: a W-9 before the first invoice, a certificate of insurance before work starts, an NDA before a meeting, a current license or permit. ShipShape lets whoever already runs the office handle that as well as a bookkeeper or broker would:

- **Keep** every document in one vault, with versions, dates and a history of every view, share and signature.
- **Fill** the official IRS Form W-9 and Common Paper's Mutual NDA from business facts confirmed once, with every field traced to its source.
- **Share** exactly the documents someone asked for as one passport link that expires, shows who opened it, and turns off in a click.
- **Stay current**: expiry and renewal dates become deadlines, a calendar file and (on Pro) reminders 90, 30 and 7 days ahead.
- **Sign**: signature requests with ESIGN/UETA consent, an emailed one-time code and a certificate page on the signed copy.

ShipShape is document software, not a law firm. It fills facts into official and openly licensed documents, never writes or changes their clauses, and never tells anyone which document or terms to use.

## Status

The app runs as a preview: sample workspaces with a made-up business and documents.

| | |
| --- | --- |
| **Works today** (sample workspace) | Vault, versions and history; W-9 and NDA fill; passport links; deadlines and calendar file; signature requests; export and account deletion; plan limits; Collect (ask your own vendors for W-9s and certificates through upload links and see who's current; in the sample its links send made-up files, and it isn't in a plan yet) |
| **Awaiting setup** | Accounts for real documents (security review, production database and storage); outgoing email for reminders and signing codes (they appear in the app's outbox meanwhile); payments (checkout, portal and webhooks are checked against a simulated Stripe; the Stripe sandbox run is pending, and there are no live payments); "What are they asking for?" (paste a request, see which documents it asks for and which you have; built, opt-in AI per request, switched on after the AI security review) |
| **Planned** | Reading dates off certificates (opt-in AI) |

## Run it

Needs Node 24, the version production runs on (`engines` in `package.json`).

```bash
npm install
cp .env.example .env.local   # fill in the three secrets (commands are in the file); set SHIPSHAPE_REAL_DOCS=1 locally
npm run dev                  # http://localhost:3000: website at /, app at /app ("Try the sample workspace")
```

With `DATABASE_URL` empty, the app uses PGlite (Postgres in WebAssembly) under `.data/pglite` and stores files under `.data/blobs`. On start it sets the database up the way a production one is set up (below) and applies any new migration from `supabase/migrations/`.

```bash
npm test        # vitest against PGlite: row level security matrix, documents, passport, collect, deadlines, e-sign, account, billing, AI, log redaction, file stores
npm run lint    # typecheck, plus a check that no SQL is built by string interpolation
```

`npm test` checks the S3 file store offline; `npm run test:s3` runs the same file-store checks against an S3 API on port 5917. Locally that's [moto](https://github.com/getmoto/moto) in its own virtualenv: `python3 -m venv .moto && .moto/bin/pip install "moto[server]==5.2.5" && .moto/bin/moto_server -p 5917`.

### Database setup on plain Postgres (Amazon RDS)

```bash
MIGRATE_DATABASE_URL=postgres://<master>@<host>/shipshape DATABASE_CA_CERT="$(cat rds-ca.pem)" npm run migrate
```

`scripts/migrate.ts` (Node 22.18 or later) runs `supabase/platform/plain-postgres.sql` once (the request roles, `auth.users`, `auth.uid()`), then each new migration in its own transaction as `shipshape_owner`, a role that can't log in and isn't a superuser. The master user needn't be a superuser (RDS's isn't). The run ends by checking that `shipshape_app`, the only login the app uses, isn't a superuser, can't bypass row level security and owns nothing (no table, function, schema or type), and that no other ShipShape role can log in; it also prints `password_encryption` and `rds.force_ssl`. The master credentials are for that run only; give `shipshape_app` its login separately. The certificate is always verified. Local databases and the tests are built by the same code (`lib/server/migrations.ts`).

## How it's built

Next.js 16 (App Router, server actions), Postgres with row level security, pdf-lib for filling and certificates, Stripe for billing.

| Path | What it is |
| --- | --- |
| `app/page.tsx`, `app/pricing`, `app/faq`, `app/status`, `app/terms`, `app/privacy` | Public site |
| `app/app/*` | The product: home, documents, make (fill), read a request, facts, passport, collect, deadlines, settings |
| `app/p/[id]`, `app/s/[id]`, `app/c/[id]` | Public passport, signing and vendor upload pages |
| `app/api/*` | Health, waitlist, signed file downloads, reminder cron, Stripe webhook |
| `lib/server/` | Everything that touches data: documents, fill, passport, collect, deadlines, e-sign, AI, account, billing, sessions, storage |
| `lib/templates/`, `templates/` | Template catalog and the source files (IRS fw9.pdf, Common Paper Mutual NDA 1.0, CC BY 4.0) |
| `lib/plans.ts` | Free and Pro limits and price; the site, terms and checkout all read from here |
| `supabase/migrations/` | Schema, row level security and the few `security definer` functions public links need |
| `supabase/platform/` | What plain Postgres needs before the migrations (Supabase has it built in) |
| `tests/` | One file per area; `tests/rls.test.ts` checks every table with a second workspace |

## Security model

- Accounts sign in through Amazon Cognito's managed login (authorization code with PKCE, state and nonce held in a 10-minute cookie only `/auth/callback` receives). The server verifies the ID token itself (RS256 with the pool's published keys, issuer, audience, expiry, nonce, a verified email), maps it to one user, and then issues its own 12-hour session cookie. Every sign-in asks for the password again, and the session records when it happened, so actions that need a recent sign-in measure a real one. Deleting an account cancels billing, records the request, then deletes the Cognito user before any data goes, so nobody can sign back in to an emptied account; whatever step can't finish (Cognito or the database unreachable), the daily run finishes once the request is 15 minutes old, so a deletion completes without the person coming back. Where Cognito isn't set up, only the sample workspace opens.
- Settings → Sign out on every device ends every session the person has, copies included: a session issued before that moment is refused on its next request (checked in the query that loads the workspace). For an account that may be compromised, support does the same and also signs the user out in Cognito (`AdminUserGlobalSignOut`) and resets the password, so no new session can be made with the old one.
- Every query runs inside a transaction as the user, with row level security deciding what it can see. Code that needs more (sign-in, public links, webhooks) goes through a short, named list of service paths.
- Tax IDs are encrypted with AES-256-GCM using a key outside the database and shown as the last 4 digits by default; revealing one needs a recent sign-in and is recorded.
- Files live in one private bucket that only the server reaches (S3 in production: Block Public Access, KMS encryption, versioning; a folder locally), up to 10 MB, PDF/PNG/JPEG. Every download goes through `/api/files` with a link the server signs for 5 minutes, so no storage URL reaches a browser. Writes never overwrite a file.
- Everything lives in the `app` schema, which the Supabase Data API must never serve (`scripts/probe-supabase.mjs` checks the live project); no function in it is executable by PUBLIC, and each role gets only explicit grants (a test checks that across every migration).
- Passport, signing and upload links carry their secret in the URL fragment, so it never reaches a server log; the page trades it for a short-lived, path-scoped cookie and removes it from the address bar. Only a hash is stored.
- Files vendors send through upload links are checked by content (PDF, PNG or JPEG, 10 MB), kept apart from the workspace's own documents, and always download rather than open in the browser. The database caps each link at 25 files and each workspace at 250 MiB of vendor files; owners and admins can delete a file, which removes the stored copy and is recorded in the history. In sample workspaces those links store a generated sample file, never the upload.
- PDFs sent for signature are unpacked within fixed limits: while loading, at most 4 MiB of object and cross-reference streams (real files use under 0.1 MiB) and 200,000 objects from them, each packed object one value parsed once and never a stream; while rewriting, 50 MB of page content. Each upload is built in a child process of its own, with 256 MB of heap, 20 seconds and none of the server's secrets (its environment is only `NODE_ENV`), at most two at a time per server; nothing it makes outlives it, and if it runs out of memory only that process dies. Past any limit the file is refused as unreadable, so a small upload can't make the server build gigabytes; when both build slots stay busy for 20 seconds, the sender is asked to try again. Only `lib/pdf/load.ts` loads uploads (`npm run lint` checks).
- The audit history is append-only and each entry hashes the one before it; entries for new document versions (signed copies included) and vendor files carry the file's SHA-256 inside the chain.
- Logs redact anything shaped like an SSN or EIN. Strict CSP with per-request nonces, no third-party scripts, no analytics.
- Billing accepts Stripe test keys only, refuses live-mode webhook events, and switches off in production once real documents are on. Access follows what Stripe reports now: a failed payment keeps Pro for 7 days from the first failure; a full refund or dispute ends Pro only when its charge paid for the live subscription; a duplicate checkout is cancelled and refunded; deleting an account cancels every subscription Stripe has for its workspaces.

## Before launch

- [ ] Security review GO (gates for real documents, AI and payments)
- [ ] Production Postgres and file storage, connecting as the `shipshape_app` role (Amazon RDS + S3 is the plan; `npm run migrate` sets up the database); `node scripts/probe-aws.mjs` passes against the account (bucket privacy and expiry, encryption, backups, TLS, the app role's privileges, and that preview deployments can't reach AWS)
- [ ] Supabase Data API switched off, or serving `public` only (never `app`); `node scripts/probe-supabase.mjs` passes against the project (Data API, bucket privacy, anonymous list/download/upload refused)
- [ ] Cognito user pool (managed login, MFA required, email verification, `email` not writable by the app client) with a confidential app client, and the production role allowed `cognito-idp:AdminDeleteUser` on that pool only
- [ ] Email provider for reminders and signing codes
- [ ] A lawyer reviews `/terms` and `/privacy` (drafts), the e-sign flow, and which states ShipShape serves
- [ ] Stripe live mode after the payments review
