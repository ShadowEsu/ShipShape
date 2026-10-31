# Privacy, Security & Compliance for ShipShape (Next.js/Vercel + Supabase + Claude API) — as of Oct 2026

Scope note: US focus. Research done 2026-10-11. Items not verified against a primary source this session are explicitly placed under "Inferences" (reasoned recommendations / general practice) or "Gaps". Where sources conflict, both are given.

## 1. Encryption architecture (envelope encryption, per-tenant keys, KMS, field-level SSN/EIN, client-side/zero-knowledge tradeoffs)

### Takeaway
Rely on provider at-rest encryption (Supabase AES-256) as the baseline, then add application-layer envelope encryption for the highest-risk fields (SSN/EIN/bank account numbers) and document blobs using a cloud KMS (AWS KMS `GenerateDataKey` + tenant-ID encryption context). Full zero-knowledge/client-side encryption is incompatible with ShipShape's core value proposition (Claude reading/filling documents server-side) and should not be promised.

### Cited Findings
- Supabase states customer data is encrypted at rest with AES-256 and in transit via TLS — [Supabase Security](https://supabase.com/security)
- Supabase project APIs (Auth, Data API, Storage, Realtime, Edge Functions) "accept only HTTPS connections using TLS 1.2 or TLS 1.3"; Postgres SSL enforcement can be turned on to reject non-SSL clients — [Supabase Platform Security docs](https://supabase.com/docs/guides/security/platform-security)
- Supabase explicitly does NOT recommend its in-database Transparent Column Encryption / Server Key Management "due to their high level of operational complexity and misconfiguration risk," and says default at-rest encryption "likely is sufficient for your compliance needs e.g. SOC2 & HIPAA" — [Supabase column-encryption / pgsodium doc](https://supabase.com/docs/guides/database/column-encryption)
- AWS KMS envelope pattern: `GenerateDataKey` returns a plaintext data key plus its KMS-encrypted copy (encrypt locally with plaintext, store only the encrypted copy); `GenerateDataKeyWithoutPlaintext` returns only the encrypted copy for pre-generated keys — [OneUptime KMS envelope guide, Feb 2026](https://oneuptime.com/blog/post/2026-02-12-kms-envelope-encryption/view); [AWS CLI generate-data-key reference](https://docs.aws.amazon.com/cli/v1/reference/kms/generate-data-key.html)
- Decryption fails (`InvalidCiphertextException`) unless the exact, case-sensitive encryption context used at encryption is supplied; AWS strongly recommends using encryption context (symmetric keys only) — [AWS CLI generate-data-key](https://docs.aws.amazon.com/cli/v1/reference/kms/generate-data-key.html); [AWS SDK GenerateDataKey docs](https://docs.aws.amazon.com/sdk-for-sap-abap/v1/api/latest/kms/operation/GENERATEDATAKEY.html)
- Putting a tenant ID in the encryption context causes decryption with another tenant's ID to fail — a practical cryptographic tenant-isolation pattern within one shared KMS key; data keys can be cached (AWS Encryption SDK does this) to cut latency/cost — [OneUptime KMS envelope guide](https://oneuptime.com/blog/post/2026-02-12-kms-envelope-encryption/view)
- KMS keys are region-specific (older community source; verify) — [GitHub gist](https://gist.github.com/Spaider/8fd0c97fd4785011032bc8144d00b8cc)
- Supabase notes that after rotating the pgsodium/Vault root key you can no longer decrypt legacy data encrypted under the old key (troubleshooting page edited 2026-09-11) — illustrates key-management risk of in-DB crypto — [Supabase troubleshooting: rotating pgsodium & Vault root keys](https://supabase.com/docs/guides/troubleshooting/issues-with-rotating-pgsodium-and-vault-root-encryption-keys-efeb47)

### Inferences
- Recommended layered design (general security practice, not from a single source):
  1. Baseline: Supabase AES-256 at rest + TLS 1.2/1.3 + SSL enforcement + network restrictions.
  2. Field-level encryption in the app tier (Next.js server / Edge Function, never the browser) for SSN, EIN, ITIN, bank account/routing numbers, and signature images: AES-256-GCM with a per-tenant data key wrapped by AWS KMS (or GCP Cloud KMS equivalent), encryption context = `{tenant_id, record_type}`. Store `ciphertext`, `wrapped_dek`, `key_version`.
  3. Store a separate non-reversible lookup value (HMAC-SHA256 with a KMS-protected secret) plus a display value (last 4 digits only) so the UI and de-dup/search never need decryption — mirrors IRS truncation (see Q5).
  4. Encrypt document blobs in Supabase Storage with per-object or per-tenant DEKs if contractual promises require "encrypted with keys unique to your account"; otherwise rely on Storage's at-rest encryption and private buckets + short-lived signed URLs.
  5. Keep KMS decrypt permission only on a narrow server role; log every decrypt (CloudTrail) — gives a real "access log" feature for customers.
  6. Per-tenant KMS keys (one CMK per tenant) enable crypto-shredding on account deletion and future BYOK for enterprise, but cost ~$1/key/month on AWS (price from general knowledge — verify) and add quota/ops overhead; one shared CMK + per-tenant DEKs + encryption context is the pragmatic startup default; crypto-shred by deleting the tenant's wrapped DEKs.
- Client-side / zero-knowledge encryption tradeoffs: breaks (a) Claude AI extraction/filling (server must see plaintext to send to the API), (b) server-side search/filtering/dedupe, (c) sharing with third parties (requires key exchange/public-key infra), (d) account recovery (lost password = lost data unless escrow, which defeats "zero knowledge"), (e) server-side virus scanning and PDF thumbnailing, (f) support/debugging. Possible narrow use: an optional "vault" for documents the user never wants AI-processed. Do not use the phrase "zero-knowledge" or "end-to-end encrypted" in marketing given the architecture.
- Avoid pgsodium TCE entirely (see Q2); Supabase Vault is fine for storing app secrets (API keys, HMAC pepper), not for bulk PII encryption.

### Gaps
- Did not verify current AWS KMS / GCP Cloud KMS per-key and per-request pricing or quotas this session.
- No authoritative source found comparing per-tenant CMKs vs shared CMK + encryption context for SaaS (AWS prescriptive guidance on SaaS tenant isolation would be the source to check).
- Did not verify whether Supabase Storage supports customer-managed keys (BYOK) as of 2026.

## 2. Supabase specifics (RLS, Vault, pgsodium status, storage encryption, SOC 2/HIPAA, residency, backups, audit logs, MFA)

### Takeaway
Supabase is SOC 2 Type 2 and offers a HIPAA BAA (Team/Enterprise), encrypts at rest with AES-256, and has org-level MFA/SSO enforcement, SSL enforcement, network restrictions and PrivateLink. pgsodium is "pending deprecation" with no new usage recommended; Vault remains supported with an unchanged interface. RLS correctness is ShipShape's single biggest security dependency.

### Cited Findings
- Supabase is "SOC2 Type 2 compliant and HIPAA compliant"; PHI may be stored once a BAA is signed; "Enterprise and Team customers can request to sign our BAA on the dashboard"; data encrypted at rest with AES-256 and in transit via TLS — [Supabase Security](https://supabase.com/security)
- HIPAA add-on pricing reported inconsistently by third parties: Team ($599/mo) add-on per one source, ~$350/mo over Pro per another — unverified, check Supabase pricing — [AccountableHQ 2026](https://www.accountablehq.com/post/is-supabase-hipaa-compliant-in-2026-baa-phi-and-security-explained); [Blaze](https://www.blaze.tech/post/is-supabase-hipaa-compliant)
- Shared-responsibility items customers must configure themselves (per third-party summary of Supabase's HIPAA guidance): mark projects HIPAA, enforce MFA, enable Point-in-Time Recovery, enable SSL enforcement and network restrictions — [AccountableHQ 2026](https://www.accountablehq.com/post/is-supabase-hipaa-compliant-in-2026-baa-phi-and-security-explained)
- Org owners "can choose to enforce MFA for all team members"; SSO can be enforced for dashboard sign-in; network restrictions on Postgres/pooler "are enforced before traffic reaches the database"; PrivateLink via AWS VPC Lattice keeps DB traffic off the public internet — [Supabase Platform Security](https://supabase.com/docs/guides/security/platform-security)
- pgsodium is labelled "pending deprecation"; Supabase "DOES NOT RECOMMEND any new usage of pgsodium"; no date given, deprecation expected "in the near future" with owners contacted to migrate; Vault "won't be impacted" — internals move off pgsodium but "the interface and API will remain unchanged" — [Supabase pgsodium doc](https://supabase.com/docs/guides/database/extensions/pgsodium.md); [Supabase column encryption doc](https://supabase.com/docs/guides/database/column-encryption)
- Column encryption in Supabase became SQL-only (changelog) — [Supabase changelog #18849](https://supabase.com/changelog/18849-column-encryption-is-sql-only-now)
- Self-hosted Supabase does not get these platform controls by default — [AccountableHQ 2026](https://www.accountablehq.com/post/is-supabase-hipaa-compliant-in-2026-baa-phi-and-security-explained)

### Inferences
- RLS best practices (general Supabase/Postgres practice; not re-verified this session): enable RLS on every table in exposed schemas (Supabase's Security Advisor flags tables without it); write policies keyed on `auth.uid()` and an `org_id` membership table; wrap `auth.uid()` as `(select auth.uid())` for performance; index policy columns; never ship the `service_role` key to the browser or to `NEXT_PUBLIC_*` env vars; put sensitive tables (SSN ciphertext, bank details) in a non-exposed schema reachable only via server-side code or `SECURITY DEFINER` functions with explicit checks; add Storage RLS policies on `storage.objects` with tenant-prefixed paths; write automated RLS tests (pgTAP) that try cross-tenant reads.
- Storage: private buckets only; short-TTL signed URLs (minutes) for viewing; never public buckets for W-9s/COIs.
- Backups: enable PITR (paid add-on) for a document-of-record product; document that deleted data persists in backups for the backup window and say so in the privacy policy (FTC retention-schedule lesson, Q7).
- Audit logs: Supabase Auth audit logs + Postgres logs are not a customer-facing access log; build an app-level append-only `audit_events` table (who viewed/downloaded/shared/decrypted which document) — this doubles as a SOC 2 control and a user-facing feature.
- End-user MFA: Supabase Auth supports TOTP MFA (general knowledge; verify) — require it for account admins and before revealing full SSN/EIN or bank numbers (step-up).
- Data residency: pick a US region (e.g., us-east-1) at project creation; region is not changeable without migration (general knowledge; verify).

### Gaps
- Did not fetch Supabase's official pages on RLS, PITR/backup retention by plan, audit-log retention, platform audit logs (Team/Enterprise), region list, or end-user MFA — specifics (plan gating, retention days) unverified.
- Exact HIPAA add-on price and which plan is required are unconfirmed (third-party sources conflict). HIPAA is likely irrelevant to ShipShape unless health data is stored.

## 3. Vercel security/compliance basics

### Takeaway
Vercel has SOC 2 Type 2 (Security, Confidentiality, Availability) and ISO 27001:2022; it is a reasonable host for the Next.js tier, but sensitive data should transit, not rest, on Vercel (no PII in logs, caches, or env vars).

### Cited Findings
- Vercel holds a SOC 2 Type 2 attestation covering Security, Confidentiality and Availability, and is ISO 27001:2022 certified (certificate in Schellman directory) — [Vercel compliance docs](https://vercel.com/docs/security/compliance)
- Vercel KB stresses that report scope and the shared-responsibility boundary matter as much as the yes/no SOC 2 answer — [Vercel KB: Is Vercel SOC 2 compliant](https://vercel.com/kb/guide/is-vercel-soc-2-compliant)
- One third-party post flagged a Vercel page still referencing ISO 27001:2013 (those certificates lapsed 31 Oct 2025); check certificate revision — [Vercel compliance docs search result summary](https://vercel.com/docs/security/compliance)
- HIPAA/BAA: third-party guidance says not to place PHI on Vercel without a BAA covering in-scope services; another cites Secure Compute for HIPAA; no Vercel-published BAA terms found — [AccountableHQ on Vercel](https://www.accountablehq.com/post/vercel-hipaa-compliance-is-vercel-compliant-baa-phi-and-what-you-need-to-know)

### Inferences
- Practical Vercel controls: mark secrets as Sensitive env vars, never prefix secrets with `NEXT_PUBLIC_`; scrub request bodies/PII from runtime logs and log drains; set `Cache-Control: private, no-store` on any route returning document data; enable Deployment Protection for preview deployments (previews connected to prod Supabase are a common leak); enable WAF/bot protection on auth routes; require team SSO/2FA; keep Claude API calls in server routes only (Anthropic ZDR orgs cannot use CORS anyway — Q4).
- Vercel functions run in Vercel-chosen regions by default; pin the function region near the Supabase region (US) for latency and a cleaner data-flow map.

### Gaps
- Did not verify Vercel's official encryption-at-rest statement, log retention periods by plan, or current BAA availability/plan.

## 4. Anthropic API data handling (retention, training, ZDR, Files API, inference geography)

### Takeaway
API data is not used for training without express permission; standard commercial retention is "within 30 days" per the privacy center (one platform doc implies no retention by default except Covered Models — conflict flagged). ZDR is available by contacting sales and covers `/v1/messages` (incl. inline PDFs) but NOT the Files API, Batches, or code execution. `inference_geo: "us"` keeps inference in the US at 1.1x price; workspace (storage) geo is US-only.

### Cited Findings
- Commercial/API default: "we automatically delete inputs and outputs on our backend within 30 days of receipt or generation" (article dated July 1, 2026); exceptions: longer-retention services under your control (e.g., Files API), separate agreement (e.g., ZDR), Usage Policy flags (inputs/outputs up to 2 years; trust & safety classification scores up to 7 years), legal requirements — [Anthropic Privacy Center: commercial retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- Platform doc commitments: "Retained data is never used for model training without your express permission"; "Conversation content (your prompts and Claude's outputs) is not retained by default; the exception is Covered Models, which require 30-day retention" — [Claude Platform: API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention). CONFLICT: this "not retained by default" wording differs from the privacy-center "deleted within 30 days" statement; treat 30 days as the safe assumption for disclosures unless ZDR is contracted.
- Covered Models (Claude Fable 5.1, Mythos 5.1, Fable 5, Mythos 5) require 30-day retention and are not available under ZDR unless expressly authorized — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- ZDR: "Anthropic does not store customer prompts or responses at rest after the API response is returned"; request via Anthropic sales; enabled per organization; covers Messages and Token Counting APIs for eligible features; not Console/playground; CORS not supported for ZDR orgs (must proxy via backend) — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- Feature eligibility: Files API (`/v1/files`) is NOT ZDR- or HIPAA-eligible — "Files retained until explicitly deleted or they reach their configured expiration"; PDF support via `/v1/messages` is eligible ("HIPAA eligibility applies to PDFs sent inline through the Messages API, not through the Files API"); prompt caching eligible (KV cache/hashes held in memory, prompts/outputs not stored); Batch API, Files API and code execution are "fundamentally stateful" and outside ZDR — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- Even with ZDR/HIPAA, flagged content may be retained up to 2 years, and data may be retained where required by law — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- HIPAA-ready API: BAA can be reviewed/executed in Claude Console for eligible orgs — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- `inference_geo`: `"global"` (default) or `"us"` ("Inference runs only in US-based infrastructure"); supported on Claude 4.6+ models (older models return 400); US-only priced at 1.1x across input/output/cache tokens; workspace defaults/allow-lists (`allowed_inference_geos`, `default_inference_geo`) configurable in Console/Admin API; Batch API supports it; response `usage.inference_geo` reports where inference ran — [Claude Platform: Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
- Workspace geo (where data is stored at rest) is set at workspace creation, cannot be changed, and "us" is currently the only option — [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)
- Data residency (`inference_geo` on `/v1/messages`) is ZDR-eligible — [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

### Inferences
- For ShipShape: send W-9/COI PDFs inline (base64) on `/v1/messages`, do not use the Files API for customer documents (or delete files immediately after use); avoid Batch API for sensitive docs if pursuing ZDR; set workspace `allowed_inference_geos: ["us"]`; apply for ZDR once volume justifies a sales conversation; avoid Covered Models for SSN-bearing documents if ZDR is a promise.
- Minimize what is sent: redact/mask SSN/EIN before sending to Claude when the task doesn't need it (e.g., COI expiry extraction), or extract the TIN with deterministic OCR/regex locally and only send the rest.
- List Anthropic as a subprocessor in the privacy policy/DPA with purpose "AI document processing," retention (30 days or zero under ZDR), and no-training commitment — and phrase ShipShape's promise as "our AI providers are contractually prohibited from training on your documents," which is supported by Anthropic's stated commitment.

### Gaps
- Did not fetch Anthropic's Commercial Terms of Service text directly (the no-training commitment above comes from the platform docs).
- ZDR eligibility criteria/minimum spend are not documented publicly.
- Resolution of the "not retained by default" vs "within 30 days" wording conflict was not found.

## 5. US laws: CCPA/CPRA, other state laws, FTC Safeguards Rule, breach notification, IRS TIN guidance, age gating

### Takeaway
At launch ShipShape is likely below CCPA thresholds and a B2B "processor/service provider" for most document data, but state breach-notification laws apply from day one (SSN + name and account numbers are triggering elements in every state). The FTC Safeguards Rule likely does not directly apply unless ShipShape engages in financial activities, but its controls are the de facto benchmark and customers who are covered (e.g., tax preparers) will flow it down contractually. FTC Act Section 5 applies to all privacy/security promises regardless.

### Cited Findings
- CCPA revenue threshold is $26,625,000 (adjusted from $25M effective Jan 1, 2025); adjusted every two years — [Drata CCPA 2026](https://drata.com/learn/ccpa/compliance-software); [Alston & Bird, Aug 2026](https://www.alston.com/en/insights/publications/2026/08/california-ccpa-cybersecurity-risk-audits)
- CPPA regulations adopted July 24, 2025, effective Jan 1, 2026, require annual cybersecurity audits and risk assessments for covered businesses: audit triggers are ≥50% revenue from selling/sharing PI, or revenue threshold + 250,000+ consumers/households or sensitive PI of 50,000+ consumers; first audit certifications due April 1, 2028 (>$100M revenue), April 1, 2029 ($50–100M), April 1, 2030 (<$50M); risk assessments for pre-2026 processing due by Dec 31, 2027, first submission April 1, 2028 (sources differ on which revenue year sets tiers) — [Alston & Bird, Aug 2026](https://www.alston.com/en/insights/publications/2026/08/california-ccpa-cybersecurity-risk-audits); [Mondaq](https://www.mondaq.com/privacy-cyber-data-strategy-advisory-%7C-california-raises-the-bar-new-cybersecurity-audit-and-risk-assessment-take-effect/1832366); [BrightDefense](https://www.brightdefense.com/news/california-ccpa-cybersecurity-audit-deadline-in-2026/)
- State comprehensive privacy laws: tracker dated Oct 1, 2026 counts 23 states enacted under IAPP/FPF methodology (24 including Florida's narrower law), ~20 in effect (19 excluding Florida); Oklahoma and Louisiana effective Jan 1, 2027, Alabama May 1, 2027, Vermont Jan 1, 2028. Earlier 2026 sources cite 20 states — counts depend on enacted vs. in effect — [privacyterms.io 2026](https://privacyterms.io/how-many-us-states-have-privacy-laws-in-2026); [privacyterms.io list](https://privacyterms.io/us-state-privacy-laws-2026); [Clym comparison](https://www.clym.io/blog/us-privacy-law-comparison-map) (secondary trackers, not IAPP directly)
- FTC Safeguards Rule scope is activity-based: applies to businesses of any size "significantly engaged" in financial products/services (e.g., mortgage brokers, nonbank lenders, professional tax preparers, check cashers), and to entities receiving customer info of other financial institutions; 2021 amendments added "finders" — [Morgan Lewis, 2021](https://www.morganlewis.com/pubs/2021/11/expanded-safeguards-rule-applicable-to-more-financial-institutions-gives-more-specificity-on-security-requirements); [Bradley, 2021](https://www.bradley.com/insights/publications/2021/11/ftc-finalizes-updated-safeguards-rule-under-glba-to-dramatically-expand-data-security-requirements-and-scope-of-rule)
- Institutions maintaining customer information on fewer than 5,000 consumers are exempt from certain Safeguards Rule provisions — [FTC "Safeguards Rule: What Your Business Needs to Know" (SC-hosted copy)](https://consumerfinance.sc.gov/sites/consumerfinance/files/Documents/FTC%20Safeguards%20Rule_%20What%20Your%20Business%20Needs%20to%20Know%20_%20Federal%20Trade%20Commission.pdf)
- Breach notification: all 50 states, DC, Guam, Puerto Rico and USVI have laws requiring notice of breaches of personal information; typical PI definition = name + SSN, driver's license/state ID, or account/credit/debit number (with access code); some states add medical/health insurance info; ~two dozen states have expanded definitions — [NCSL Security Breach Notification Laws](https://www.ncsl.org/technology-and-communication/security-breach-notification-laws); [DigitalEdge state-by-state](https://www.digitaledge.net/u-s-data-breach-laws-state-by-state/). (A Bitsight post claiming Alabama and South Dakota lack laws is outdated — [Bitsight](https://www.bitsight.com/blog/data-breach-notification-laws).)
- IRS TIN truncation: filers may truncate SSNs/ITINs/EINs/ATINs on payee statements (e.g., 1099, 1098, 5498 series; Copy B) to reduce identity theft; not allowed on Form W-2, on copies filed with IRS/state/local governments, and a person may not truncate its own TIN on documents it furnishes to others (incl. Form W-9); final regs effective July 15, 2014 — [IRS: Truncated TINs](https://www.irs.gov/government-entities/federal-state-local-governments/truncated-taxpayer-identification-numbers); [Marcum on 2014 final regs](https://marcumllp.com/insights/irs-issues-final-regulations-on-ability-to-use-truncated-tax-identification-numbers)

### Inferences
- CCPA: ShipShape itself likely falls below $26.6M revenue / 100,000-consumer thresholds at launch (100k threshold from general knowledge — verify), but SMB customers' contracts will demand CCPA "service provider" terms; adopt a DPA template now. Note that sole-proprietor W-9s contain consumer SSNs, which are "sensitive personal information" under CPRA.
- Safeguards Rule: ShipShape (document management for contractors/vendors) is probably not a "financial institution," but if it ever facilitates payments, lending, or tax preparation, or serves tax-preparer customers who send client data, it may be a service provider whom covered customers must oversee — so align the security program to 16 CFR 314.4 elements (qualified individual, written risk assessment, MFA, encryption, access controls, annual pen test, 30-day FTC notice of 500+ consumer breaches — elements from general knowledge, verify on ecfr.gov).
- Breach planning: W-9 data (name + SSN) is a notification trigger in every state, so an incident response plan, cyber insurance, and encryption (many state laws exempt properly encrypted data where keys were not compromised — general knowledge) are high-value.
- IRS: W-9s must hold the full TIN (requester can't receive a truncated one), so ShipShape must store full TINs encrypted; display only last 4 in UI/exports and for any generated 1099 payee copies offer truncation (XXX-XX-1234 format). IRS Publication 4557 / "Taxes-Security-Together" guidance applies to tax professionals (general knowledge; not verified this session).
- Age gating: B2B service; require users be 18+ in Terms; no COPPA exposure if not directed to children.

### Gaps
- Did not fetch 16 CFR 314.2/314.4 text or the FTC's Safeguards Rule business guide on ftc.gov directly; did not confirm 2024 amendment (FTC breach notice for 500+ consumers, effective May 2024) from a primary source this session.
- No state-by-state table of breach-notice deadlines/AG notice thresholds compiled; NCSL chart not retrieved.
- IAPP tracker itself not accessed; state-law counts are from secondary trackers.
- No IRS source found on W-9 requester safeguarding obligations specifically.

## 6. FTC enforcement on broken privacy/security promises — lessons for wording

### Takeaway
The FTC punishes the gap between what a company says and what it does: security superlatives (GoDaddy), "we protect/block tracking" (Avast), limited-use health-data promises (BetterHelp, GoodRx), and unenforced retention policies (Blackbaud, Drizly, Chegg). Orders impose 20-year obligations, published retention schedules, mandatory MFA, third-party assessments, and can bind executives personally.

### Cited Findings
- GoDaddy (final order May 2025): alleged claims of "award-winning security" while failing basic protections like MFA; order bars security misrepresentations and misrepresentations about compliance with government/self-regulatory/standard-setting programs; requires independent third-party assessor — [FTC press release May 2025](https://www.ftc.gov/news-events/news/press-releases/2025/05/ftc-finalizes-order-godaddy-over-data-security-failures)
- Illuminate Education (ed-tech): FTC alleged it misrepresented the extent of its reasonable cybersecurity measures; 10-year consent order with security program and periodic third-party assessments — [Inside Privacy / Covington](https://www.insideprivacy.com/united-states/federal-trade-commission/ftc-announces-10-year-information-security-consent-orders-with-illuminate-education-and-illusory-systems/); [FTC Illuminate final order PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/2223105c4833illuminatefinalorder.pdf)
- FTC 2025 ransomware report: describes a company that falsely claimed in marketing that it had never suffered a breach; FTC has brought 90+ data security actions — [FTC ransomware report 2025](https://www.ftc.gov/system/files/ftc_gov/pdf/p035303ransomwarereport2025.pdf)
- Blackbaud (proposed Feb 2024, final May 2024): failure to enforce its own retention policy kept data years longer than needed; order requires deleting unneeded data, bars misrepresenting security and retention, and requires a published retention schedule within 90 days that "precludes indefinite retention," including for former customers; 20-year order — [FTC Feb 2024](https://www.ftc.gov/news-events/news/press-releases/2024/02/ftc-order-will-require-blackbaud-delete-unnecessary-data-boost-safeguards-settle-charges-its-lax); [FTC May 2024](https://www.ftc.gov/news-events/news/press-releases/2024/05/ftc-finalizes-order-blackbaud-related-allegations-firms-security-failures-led-data-breach); [Decision & Order](https://www.ftc.gov/system/files/ftc_gov/pdf/Blackbaud-D&O.pdf)
- Drizly (Oct 2022): breach of ~2.5M consumers; order requires published retention schedule, destruction of unneeded data, and binds CEO James Cory Rellas to implement a security program at future companies collecting PI of 25,000+ people — [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/ftc-takes-action-against-drizly-and-its-ceo-for-alleged-security-failures-that-exposed-data-of-2-5-million-consumers); [WSGR](https://www.wsgr.com/en/insights/ftc-announces-settlement-with-drizly-complaint-names-ceo-in-his-individual-capacity.html)
- Chegg (Oct 2022): order requires documented retention schedule, access/deletion request link on homepage and login page, MFA offered to consumers, comprehensive security program and biennial third-party assessments — [King & Spalding](https://www.kslaw.com/attachments/000/010/103/original/FTC_Signals_Increased_Enforcement_Effort_Against_Ineffective_Data_Security_Protocols.pdf); [Alston privacy blog](https://www.alstonprivacy.com/recent-ftc-order-has-implications-for-executive-liability-and-corporate-data-minimization-practices/)
- BetterHelp (final July 2023): $7.8M; shared health data for advertising after promising limited use; banned from sharing health data for ads, must get affirmative express consent before disclosing PI to certain third parties, retention limits — [FTC July 2023](https://www.ftc.gov/news-events/news/press-releases/2023/07/ftc-gives-final-approval-order-banning-betterhelp-sharing-sensitive-health-data-advertising); [FTC Mar 2023](https://www.ftc.gov/news-events/news/press-releases/2023/03/ftc-ban-betterhelp-revealing-consumers-data-including-sensitive-mental-health-information-facebook)
- GoodRx (2023): first-ever Health Breach Notification Rule action, for undisclosed sharing of health info with Facebook, Google and others; civil penalty — [FTC Chair Khan testimony, July 2024](https://www.ftc.gov/system/files/ftc_gov/pdf/chair-khan-testimony_7-9-2024.pdf)
- Avast (final June 2024): $16.5M; claimed software would protect privacy/block tracking but sold browsing data via Jumpshot; banned from selling browsing data for ads, must delete data and derived models/algorithms — [FTC June 2024](https://www.ftc.gov/news-events/news/press-releases/2024/06/ftc-finalizes-order-avast-banning-it-selling-or-licensing-web-browsing-data-advertising-requiring-it); [FTC Feb 2024](https://www.ftc.gov/news-events/news/press-releases/2024/02/ftc-order-will-ban-avast-selling-browsing-data-advertising-purposes-require-it-pay-165-million-over)
- 2026 outlook: privacy, data security and misrepresented data practices remain FTC priorities, with emphasis on statutes carrying civil penalties (law-firm analysis) — [Arnall Golden Gregory](https://www.agg.com/news-insights/publications/ftc-enforcement-priorities-what-the-agencys-actions-reveal-about-2026-risk/)
- FTC staff "Lenses of security" (Dec 2024) on security through data management, secure software development and human-centered design — [FTC Tech blog](https://search.ftc.gov/policy/advocacy-research/tech-at-ftc/2024/12/lenses-security-preventing-mitigating-digital-security-risks-through-data-management-software)

### Inferences
- Wording rules derived from the cases:
  - Never use absolutes/superlatives: avoid "bank-level/military-grade security," "unhackable," "100% secure," "never been breached," "award-winning security" (GoDaddy, ransomware report).
  - Never claim a certification/standard you don't hold ("SOC 2 compliant" before a report exists; "HIPAA compliant"); say "SOC 2 Type I audit in progress" only when an auditor engagement exists (GoDaddy order bars compliance misrepresentations).
  - Make retention promises you can execute: publish a retention schedule (Blackbaud/Drizly/Chegg) and actually purge, including from former-customer accounts and (with stated lag) backups.
  - "We never sell your data" must cover all data incl. metadata/analytics, and "we don't share" must account for subprocessors (BetterHelp/GoodRx were about ad pixels — don't load Meta/Google ad pixels on authenticated pages).
  - "Privacy by design" is a claim the FTC can test; if used, tie it to concrete, verifiable practices (encryption of SSNs, least-privilege access, MFA, audit logs).
  - Founders can be personally named (Drizly) — governance matters early.

### Gaps
- Did not retrieve 2025–2026 FTC data security cases beyond GoDaddy/Illuminate/ransomware report; current (2025–26) FTC leadership's posture beyond law-firm commentary not verified.
- GoodRx $1.5M penalty figure is from general knowledge, not verified this session.

## 7. SOC 2 path for an early startup

### Takeaway
Typical path: compliance-automation platform (Vanta/Drata/Secureframe) + Type I in ~2–4 months, then Type II after a 3–12 month observation window. Budget roughly $20K–$60K in year one for a small startup (platform + audit + pen test), with wide variance.

### Cited Findings
- Audit fees: Type I ~$7,500–$15,000 and Type II ~$12,000–$20,000 for small-to-midsize companies (Drata, vendor source); other sources give Type II $15,000–$40,000 for a 6–12 month observation period; specialist firms cost ~30–40% less than Big 4 — [Drata SOC 2 audit cost](https://drata.com/blog/soc-2-audit-cost); [TraceLayer 2026](https://tracelayer.it.com/blog/soc2-compliance-cost-2026); [Beancount Jul 2026](https://beancount.io/de/blog/2026/07/14/soc-2-type-ii-small-saas-audit-cost-guide)
- Platform pricing: Vanta ~$10K–$30K/yr (or $15–20K/yr for Type II); Drata ~$12–18K/yr; list ranges Drata $15K–$100K, Vanta $10K–$80K; custom quotes — [ComplyJet Vanta review](https://www.complyjet.com/blog/vanta-soc-2-review); [Costbench Drata vs Vanta](https://www.costbench.com/compare/drata-vs-vanta/)
- All-in first year: ~$20K–$60K for a startup; Drata says all-in often $20K–$80K beyond audit fee; extra costs include readiness assessment and pen tests — [TraceLayer 2026](https://tracelayer.it.com/blog/soc2-compliance-cost-2026); [Drata](https://drata.com/blog/soc-2-audit-cost)
- Both Vercel and Supabase hold SOC 2 Type 2 reports, which ShipShape can rely on as carved-out/inherited subservice-organization controls — [Vercel compliance](https://vercel.com/docs/security/compliance); [Supabase Security](https://supabase.com/security)

### Inferences
- Sequencing for ShipShape: (1) now — written security policies, MFA everywhere, RLS tests, audit logging, vendor list/DPAs, incident response plan, publish a security page + subprocessor list; (2) when the first mid-market/enterprise or insurance/GC customer asks — buy a platform, do Type I (point-in-time) to unblock sales; (3) start a 3-month Type II window immediately after. Customers handling W-9/COIs (GCs, property managers, insurers) commonly send security questionnaires; a Trust Center page + SOC 2 report under NDA answers most.
- Choose Security + Confidentiality TSCs initially; add Privacy later if marketing privacy heavily.

### Gaps
- Costs come from vendor/consultant blogs with conflicts of interest; no independent survey found. Secureframe pricing not retrieved.
- Typical Type I timelines (2–4 months) are from general knowledge, not verified this session.

## 8. Practical privacy features users value & enforceable website promises

### Takeaway
The FTC orders effectively define a feature checklist: easy access/deletion, published retention schedule, MFA for users, and audit logs. ShipShape can safely promise specific, verifiable practices; it should avoid absolute or unverifiable claims.

### Cited Findings
- Chegg order required a consumer-facing access/deletion request link on homepage and login page and offering MFA to consumers — [King & Spalding](https://www.kslaw.com/attachments/000/010/103/original/FTC_Signals_Increased_Enforcement_Effort_Against_Ineffective_Data_Security_Protocols.pdf)
- Blackbaud/Drizly orders require public retention schedules with fixed deletion timeframes — [FTC Blackbaud May 2024](https://www.ftc.gov/news-events/news/press-releases/2024/05/ftc-finalizes-order-blackbaud-related-allegations-firms-security-failures-led-data-breach); [Hunton on Drizly](https://www.hunton.com/privacy-and-cybersecurity-law-blog/ftc-takes-action-against-drizly-and-its-ceo-for-alleged-security-failures-that-exposed-data-of-2-5-million-consumers)
- Anthropic commits that retained API data is never used for training without express permission — supports a "no training on your docs" promise for the Claude layer — [Claude Platform: API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- GoDaddy's failure to use MFA despite security claims was a core FTC allegation — [FTC May 2025](https://www.ftc.gov/news-events/news/press-releases/2025/05/ftc-finalizes-order-godaddy-over-data-security-failures)

### Inferences
- Feature list (prioritized): (1) user 2FA (TOTP/passkeys) with org-level enforcement; (2) per-document access log visible to the owner (views, downloads, shares, AI processing events); (3) share links with expiry (default 7 days), revocation, optional passcode, view-only and download-disabled options; (4) masked SSN/EIN by default with click-to-reveal (step-up auth, logged); (5) one-click full export (ZIP of originals + JSON/CSV of extracted data); (6) self-serve account and per-document deletion with stated purge timeline incl. backups; (7) "AI processing" toggle per workspace and per document; (8) subprocessor list with change notifications; (9) security.txt and vulnerability-disclosure page.
- Safe promise wording (each must be true at launch and kept true):
  - "We do not sell your data or share it for advertising." (no ad pixels on logged-in pages)
  - "We do not use your documents to train AI models, and our AI provider (Anthropic) is contractually prohibited from training on them." (Anthropic commitment above; confirm Commercial Terms)
  - "Documents sent for AI processing are deleted by our AI provider within 30 days [or: not retained, under our zero-data-retention agreement]" — only claim zero retention once ZDR is signed and Files API/Batches are not used.
  - "Sensitive fields such as SSNs, EINs and bank account numbers are encrypted at the application level in addition to database encryption, and are masked by default."
  - "Data is stored in the United States" and "AI processing runs on US infrastructure" (only with Supabase US region + `inference_geo: "us"` enforced via workspace allow-list).
  - "You can export or delete your data at any time; deleted data is purged from production within X days and from backups within Y days."
  - "We host on providers with SOC 2 Type 2 reports (Vercel, Supabase)" — accurate; do NOT say "ShipShape is SOC 2 compliant" until ShipShape has its own report.
  - Avoid: "bank-level," "military-grade," "zero-knowledge," "end-to-end encrypted," "unhackable," "fully compliant," "we will never be breached," "HIPAA compliant."

### Gaps
- No user-research source found ranking which privacy features small-business buyers value most; feature prioritization is inference.
- Did not verify competitor privacy pages (out of scope for this researcher's assignment).
