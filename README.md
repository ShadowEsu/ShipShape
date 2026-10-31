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
| **Works today** (sample workspace) | Vault, versions and history; W-9 and NDA fill; passport links; deadlines and calendar file; signature requests; export and account deletion; plan limits and Stripe billing in test mode |
| **Awaiting setup** | Accounts for real documents (security review, production database and storage); outgoing email for reminders and signing codes (they appear in the app's outbox meanwhile); live payments |
| **Planned** | "What are they asking for?" (paste a request, match it to your documents; opt-in AI per action); reading dates off certificates (opt-in AI); Collect, for gathering documents from your own vendors |

## Run it

```bash
npm install
cp .env.example .env.local   # fill in the three secrets (commands are in the file); set SHIPSHAPE_REAL_DOCS=1 locally
npm run dev                  # http://localhost:3000: website at /, app at /app ("Try the sample workspace")
```

With `DATABASE_URL` empty, the app uses PGlite (Postgres in WebAssembly) under `.data/pglite` and stores files under `.data/blobs`. Migrations in `supabase/migrations/` apply on start.

```bash
npm test        # vitest against PGlite: row level security matrix, documents, passport, deadlines, e-sign, account, billing, log redaction
npm run lint    # typecheck, plus a check that no SQL is built by string interpolation
```

## How it's built

Next.js 16 (App Router, server actions), Postgres with row level security, pdf-lib for filling and certificates, Stripe for billing.

| Path | What it is |
| --- | --- |
| `app/page.tsx`, `app/pricing`, `app/faq`, `app/status`, `app/terms`, `app/privacy` | Public site |
| `app/app/*` | The product: home, documents, make (fill), facts, passport, deadlines, settings |
| `app/p/[id]`, `app/s/[id]` | Public passport and signing pages |
| `app/api/*` | Health, waitlist, signed file downloads, reminder cron, Stripe webhook |
| `lib/server/` | Everything that touches data: documents, fill, passport, deadlines, e-sign, account, billing, sessions, storage |
| `lib/templates/`, `templates/` | Template catalog and the source files (IRS fw9.pdf, Common Paper Mutual NDA 1.0, CC BY 4.0) |
| `lib/plans.ts` | Free and Pro limits and price; the site, terms and checkout all read from here |
| `supabase/migrations/` | Schema, row level security and the few `security definer` functions public links need |
| `tests/` | One file per area; `tests/rls.test.ts` checks every table with a second workspace |

## Security model

- Every query runs inside a transaction as the user, with row level security deciding what it can see. Code that needs more (sign-in, public links, webhooks) goes through a short, named list of service paths.
- Tax IDs are encrypted with AES-256-GCM using a key outside the database and shown as the last 4 digits by default; revealing one needs a recent sign-in and is recorded.
- Files live in private storage and are served through signed links that expire after 5 minutes.
- Passport and signing links carry their secret in the URL fragment, so it never reaches a server log; the page trades it for a short-lived, path-scoped cookie and removes it from the address bar. Only a hash is stored.
- The audit history is append-only and each entry hashes the one before it.
- Logs redact anything shaped like an SSN or EIN. Strict CSP with per-request nonces, no third-party scripts, no analytics.
- Billing accepts Stripe test keys only and switches off in production once real documents are on.

## Before launch

- [ ] Security review GO (gates for real documents, AI and payments)
- [ ] Production Postgres and storage (Supabase), connecting as the `shipshape_app` role
- [ ] Email provider for reminders and signing codes
- [ ] A lawyer reviews `/terms` and `/privacy` (drafts), the e-sign flow, and which states ShipShape serves
- [ ] Stripe live mode after the payments review
