# ShipShape

A paperwork passport for small businesses. Every new customer, landlord or general contractor asks for the same papers: a W-9 before the first invoice, a certificate of insurance before work starts, an NDA before a meeting, a current license or permit. ShipShape lets whoever already runs the office handle that as well as a bookkeeper or broker would:

- **Keep** every document in one vault, with versions, dates and a history of every view, share and signature.
- **Fill** the official IRS Form W-9 and Common Paper's Mutual NDA from business facts confirmed once, with every field traced to its source.
- **Share** exactly the documents someone asked for as one passport link that expires, shows each time it's opened and what was downloaded, and turns off in a click.
- **Stay current**: expiry and renewal dates become deadlines, a calendar file and (on Pro) reminders 90, 30 and 7 days ahead.
- **Sign**: signature requests with ESIGN/UETA consent, a one-time code (emailed once ShipShape sends email; shown in the sample's outbox until then) and a certificate page on the signed copy.

ShipShape is document software, not a law firm. It fills facts into official and openly licensed documents, never writes or changes their clauses, and never tells anyone which document or terms to use.

## Status

The app runs as a preview: sample workspaces with a made-up business and documents.

| | |
| --- | --- |
| **Works today** (sample workspace) | Vault, versions and history; W-9 and NDA fill; passport links; deadlines and calendar file; signature requests; Saved; Sent (each passport link and signature request, and where it went: opens counted, never named), Signed copies and the workspace's History (owners and admins see all of it and export it as CSV; members see their documents' rows); export and account deletion; Collect (ask your own vendors for W-9s and certificates through upload links and see who's current; in the sample its links send made-up files, and it isn't in a plan yet); "What are they asking for?" (paste a request; while AI is off, ShipShape finds the documents it names by matching document names, with no AI and nothing sent anywhere, and shows which you have, which have expired and which are missing). The sample starts with made-up activity, made through the same code a real workspace uses: a passport link opened from two documentation-only network addresses, an NDA signed by a "(sample)" signer, and a request still waiting. Plan limits are enforced by the server for real workspaces; the sample has every Pro feature. |
| **Awaiting setup** | Accounts for real documents (security review, production database and storage); uploading your own files (PDF, PNG or JPEG up to 4 MB, with real accounts); outgoing email for reminders and signing codes (the sample's outbox shows them meanwhile); payments (checkout, portal and webhooks are checked against a simulated Stripe; the Stripe sandbox run is pending, and there are no live payments); reading a request with AI (built, opt-in AI per request, so it also finds documents a request describes without naming them; switched on after the AI security review) |
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

The sample W-9's first-page images (`public/sample/`) are made from the sample's own W-9 with its signature date left blank: `npm run sample:w9-image` (needs `pdftoppm` and `cwebp`: `brew install poppler webp`). A test fails when the sample's facts, the IRS form or how it's filled changes that page; then raise `SAMPLE_W9_IMAGES.number` in `lib/server/sample.ts`, make the images again and delete the older files.

The mark lives in `components/brand-mark.tsx`. The favicon and app icons (`app/icon.svg`, `app/icon1.png`, `app/icon2.png`, `app/apple-icon.png`) are made from it with `python3 scripts/brand-icons.py`, which needs Python Playwright and its Chromium. Run it again after changing the mark.

PGlite differs from a real server in small ways (one connection, so transactions never overlap; its own value encoding), so the suite also runs against a throwaway PostgreSQL through the production driver (verified TLS, as `shipshape_app`). A few tests run only there, such as two transactions in one workspace at once. CI (`.github/workflows/test.yml`) runs lint, the production build (`next build`) and both suites on every push and pull request to `rebuild`, on PostgreSQL 17 that accepts TCP only over TLS (`scripts/ci-postgres.sh`), and runs `npm run test:s3` against moto. A second job scans every commit for secrets with gitleaks (its image pinned by digest, the checkout read-only, no network); a finding fails the run.

`SHIPSHAPE_PG_TEST_URL` is a superuser URL on an empty server you can throw away: each test file creates its own `shipshape_test_*` database there (left behind afterwards) and the run sets `shipshape_app`'s password. The tests refuse any host but this machine (to use another, name it in `SHIPSHAPE_PG_TEST_ALLOW_HOST`), any server that holds other databases, and any Amazon RDS server, even through a tunnel.

```bash
SHIPSHAPE_PG_TEST_URL=postgres://<superuser>@localhost/postgres DATABASE_CA_CERT="$(cat ca.pem)" npm test
```

### Database setup on plain Postgres (Amazon RDS)

```bash
MIGRATE_DATABASE_URL=postgres://<master>@<host>/shipshape DATABASE_CA_CERT="$(cat rds-ca.pem)" npm run migrate
```

`scripts/migrate.ts` (Node 22.18 or later) runs `supabase/platform/plain-postgres.sql` once (the request roles, `auth.users`, `auth.uid()`), then each new migration in its own transaction as `shipshape_owner`, a role that can't log in and isn't a superuser. The master user needn't be a superuser (RDS's isn't). Each applied migration's SHA-256 is recorded; before changing anything, a run refuses when an applied migration's file has changed since or is gone, or when a new one sorts before one already applied (a branch merged late: name it with `--allow-late <file name>` to run it). The run ends by checking that `shipshape_app`, the only login the app uses, isn't a superuser, can't bypass row level security, create roles or databases, or replicate, and owns nothing (no table, function, schema or type), and that no other ShipShape role can log in; it also prints `password_encryption` and `rds.force_ssl`. The master credentials are for that run only; give `shipshape_app` its login separately. The certificate is always verified. Local databases and the tests are built by the same code (`lib/server/migrations.ts`).

## How it's built

Next.js 16 (App Router, server actions), Postgres with row level security, pdf-lib for filling and certificates, Stripe for billing.

| Path | What it is |
| --- | --- |
| `app/page.tsx`, `app/pricing`, `app/faq`, `app/status`, `app/terms`, `app/privacy` | Public site |
| `public/site/`, `scripts/site-shots.py` | The home page's product screenshots, cropped from app stills at 2x; re-run the script on new stills after the app's look changes |
| `app/app/*` | The product: home, documents, saved, sent, signed copies, history, make (fill), read a request, facts, passport, collect, deadlines, settings |
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
- Tax IDs in business facts are encrypted with AES-256-GCM using a key outside the database and shown as the last 4 digits by default; revealing one needs a recent sign-in and is recorded. A filled W-9 carries the full number, as the IRS form requires, so anyone who can open that document or a passport link to it can read it.
- Files live in one private bucket that only the server reaches (S3 in production: Block Public Access, KMS encryption, versioning; a folder locally), up to 4 MB, PDF/PNG/JPEG. Every download goes through `/api/files` with a link the server signs for 5 minutes, so no storage URL reaches a browser. Writes never overwrite a file; the one exception is a version file left behind by a transaction that lost its commit, which the next write to that version replaces (the row inserted under the document's lock proves nothing refers to it).
- Everything lives in the `app` schema, which the Supabase Data API must never serve (`scripts/probe-supabase.mjs` checks the live project); no function in it is executable by PUBLIC, and each role gets only explicit grants (a test checks that across every migration).
- Passport, signing and upload links carry their secret in the URL fragment, so it never reaches a server log; the page trades it for a short-lived, path-scoped cookie and removes it from the address bar. Only a hash is stored.
- Files vendors send through upload links are checked by content (PDF, PNG or JPEG, 4 MB), kept apart from the workspace's own documents, and always download rather than open in the browser. The database caps each link at 25 files and each workspace at 250 MiB of vendor files; owners and admins can delete a file, which removes the stored copy and is recorded in the history. In sample workspaces those links store a generated sample file, never the upload.
- PDFs sent for signature are unpacked within fixed limits: while loading, at most 4 MiB of object and cross-reference streams (real files use under 0.1 MiB) and 200,000 objects from them, each packed object one value parsed once and never a stream; while rewriting, 50 MB of page content. A PNG is read chunk by chunk before it is decoded and refused if decoding it would take over 512 MiB (an 8-bit RGB letter page scanned at 600 dpi fits), or if it has more than one size header, animation, or a chunk that runs past the file (JPEGs are copied as they are, never decoded). Each upload is built in a child process of its own, and so is the signed copy (the certificate appended to the file the signer reviewed), with 256 MB of heap, 20 seconds from when the process is ready and none of the server's secrets (its environment is only `NODE_ENV`), at most two at a time per server; nothing it makes outlives it, and if it runs out of memory only that process dies. Past any limit the file is refused as unreadable, so a small upload can't make the server build gigabytes; when both build slots stay busy for 20 seconds, or a process takes over 20 seconds to start or crashes, the sender or signer is asked to try again and nothing is signed. Only `lib/pdf/load.ts` loads uploads (`npm run lint` checks).
- The audit history is append-only and each entry hashes the one before it; entries for new document versions (signed copies included) and vendor files carry the file's SHA-256 inside the chain.
- Logs redact anything shaped like an SSN or EIN. Strict CSP with per-request nonces, no third-party scripts, no analytics; API responses carry `default-src 'none'` (file downloads set their own).
- A production deployment doesn't serve without every secret and setting it needs (session, hash and field keys, the cron secret, the database URL and its CA, an https app URL, the S3 bucket and role, account sign-in all or nothing), each checked by the code that reads it; `/api/health` answers 503 with `"config": "missing"` until then, naming nothing.
- "Today" is the person's own calendar day: the browser stores its time zone in a cookie (`ss_tz`, validated as a real zone, UTC when absent), and every expiry check, deadline count, the public passport page and the date drawn on a signed W-9 use that day. The daily reminders run at 15:00 UTC, when the UTC date is the US calendar date.
- Sample workspaces are deleted by the daily run once they are a day old (so one to two days after they were made), files included, through the same path as an account deletion. An account deletion also removes the person's own waitlist row, and the daily run removes anything still stored under a deleted workspace's id, files no row pointed at included.
- The waitlist route counts new sign-ups per UTC day, split by whether they came from a form inside the sample workspace, which takes the form saying so (`from: "sample"`, sent only by Start here's and Settings' forms) and a valid sample session (`app.waitlist_tally`, 0051): a day, a source and a number, nothing about who. A repeat address isn't counted. Read it as the master: `select day, source, joined from app.waitlist_tally order by day desc, source;`.
- Billing is off unless `BILLING_ENABLED=1`. Previews, local runs and CI take only a Stripe test key (and none in a production build with real documents on). Vercel's Production takes only real money: a restricted `rk_live_` key (never `sk_live_`), with `SHIPSHAPE_CHECKOUT_LIVE=1` exactly, final terms (`TERMS_VERSION` without `-draft`; the draft terms and pricing say no real money moves), real documents on and an https app URL; a test key there switches billing off, so a test card can't buy Pro in the production database. Anything else switches billing off before any Stripe call, and `/api/health` reports the mode (`billing`: off, test or live), whether new checkouts can start (`checkout`: off, open or paused) and whether a webhook secret is set. `SHIPSHAPE_CHECKOUT_PAUSED=1` stops new checkouts only (no Stripe call), leaving the webhook, the billing portal and account deletion working for people who already pay. Checkout also refuses a Stripe price that isn't exactly the site's, in US dollars, billed every 1 month. It refuses webhook events of the other mode. Access follows what Stripe reports now: a failed payment keeps Pro for 7 days from the first failure; a full refund or dispute ends Pro only when its charge paid for the live subscription; a duplicate checkout is cancelled and refunded; deleting an account expires its workspaces' open checkouts, then cancels every subscription Stripe has for them; a checkout completed for a deleted workspace is refused.

## Before launch

- [ ] Security review GO (gates for real documents, AI and payments)
- [ ] Production Postgres and file storage, connecting as the `shipshape_app` role (Amazon RDS + S3 is the plan; `npm run migrate` sets up the database); `node scripts/probe-aws.mjs` passes against the account (bucket privacy and expiry, encryption, backups, TLS, the app role's privileges, and that preview deployments can't reach AWS)
- [ ] Supabase Data API switched off, or serving `public` only (never `app`); `node scripts/probe-supabase.mjs` passes against the project (Data API, bucket privacy, anonymous list/download/upload refused)
- [ ] Cognito user pool (managed login, MFA required, email verification, `email` not writable by the app client) with a confidential app client, and the production role allowed `cognito-idp:AdminDeleteUser` on that pool only
- [ ] Email provider for reminders and signing codes
- [ ] A lawyer reviews `/terms` and `/privacy` (drafts), the e-sign flow, and which states ShipShape serves
- [ ] Stripe live mode after the payments review
