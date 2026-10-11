# AI form fillers, COI/vendor-compliance tools, W-9 collection, KYB, and 2025-2026 entrants neighboring ShipShape

Research done October 11, 2026. Focus is the US. Most product facts come from vendor sites or third-party directories such as Capterra, GetApp and FitGap, and those are vendor-supplied unless noted. Where a source is dated, the date is given.

## Competitor profiles: business model, pricing, target customer, features, AI, privacy, funding, traction, complaints, gaps

### Takeaway
There are two well-funded camps. AI PDF fillers (Instafill, Filly, Simplicity) sell cheap self-serve subscriptions to whoever fills the forms. COI and vendor-compliance platforms (myCOI, TrustLayer, Jones, BCS, Billy, PINS) sell to the collector: GCs, property managers and enterprises. They price per tracked vendor, and nearly all of them make submission free for vendors. KYB (Middesk, Baselayer) is API infrastructure sold to banks and fintechs, not to SMBs. Few products sit on the sender's side, and those are small or free point tools: Constrafor's COI hub, YourStanding, Certificial's insured sharing, and the Coupa and SAP supplier profiles.

### Cited Findings

#### A. AI-native PDF/form fillers

**Instafill.ai (Botmakers LLC)**
- It is an AI PDF form filler for individuals and for businesses that handle forms for clients or employees. It pulls data from images, text documents, partially filled PDFs and CSVs. — [Capterra](https://www.capterra.com/p/10021799/Instafill/)
- Pricing: Capterra and Software Advice list a $65.99 flat monthly "Business" plan plus a free version or trial. The plan includes a catalog of 210+ forms, custom uploads, bulk fill and an API. Software Advice also shows "starting at $10/year," which conflicts with that figure. I could not read the vendor pricing page, which rendered empty. — [Software Advice](https://www.softwareadvice.com/product/451404-Instafill/); [Capterra](https://www.capterra.com/p/10021799/Instafill/)
- Tiers are Free, PLUS (individuals; custom profiles and batch filling) and TEAM (multi-user and admin). "Custom profiles" are the memory feature and are limited to paid plans. Chrome and Edge extensions are available. It claims a W-9 fill in 27 seconds. Source is a company-authored post from January 2025. — [DEV Community (Instafill org)](https://dev.to/instafill/what-is-instafillai-and-why-it-works-2jka)
- AI and privacy, from the vendor's subprocessor page:
  - LLMs: OpenAI, Azure OpenAI (EU region available) and Google Gemini. Providers receive extracted text, field labels and page screenshots, not raw files.
  - Training: every provider operates under API terms that bar training on submissions.
  - Storage: files are AES-256 encrypted by Instafill before upload to Azure Blob (Texas by default), with per-workspace keys in Azure Key Vault. Text fields are encrypted in MongoDB Atlas.
  - Retention: account deletion removes all application data, and retention windows are configurable through a "Data Retention & Cleanup Management" feature.
  - Tracing: LangSmith tracing is limited to metadata, with full prompt tracing off by default. — [Instafill subprocessors](https://instafill.ai/features/subprocessors)
- It claims ISO 27001, HIPAA and GDPR compliance. This is vendor marketing and unverified. — [DEV Community](https://dev.to/instafill/what-is-instafillai-and-why-it-works-2jka)
- I found no funding or traction data.

**Filly AI (getfilly.app; Cyrus Group Kft., Hungary)**
- Targets: immigration lawyers, paralegals, accountants, freelancers, consultants and HR teams. In other words, professionals filling forms on behalf of many clients. — [getfilly.app](https://getfilly.app)
- Features:
  - AI field extraction with OCR, and reusable client profiles with a completeness score.
  - Confidence color-coding on each fill.
  - Learning from corrections: "Correct a field once. Never correct that form again."
  - Batch fill for up to 20 clients as a ZIP, and CSV fill.
  - Share links that let clients review and e-sign without an account.
  - A 13-tool PDF toolbox and 18 built-in IRS, USCIS and SSA forms, including the W-9, W-4 and I-9. — [getfilly.app](https://getfilly.app); [BetaList](https://betalist.com/startups/filly-ai)
- Pricing: Free ($0; 10 forms, 5 clients, 10 fills/month), Solo $19/month (unlimited clients, 100 fills), Pro $39/month (unlimited, batch fill, AI templates), Enterprise $79/month (5 seats, custom share-link domain). It also sells pay-as-you-go credits and an API from $49/month. — [getfilly.app](https://getfilly.app)
- AI and privacy:
  - It uses Claude (Anthropic) through the API and states there is no training on customer data.
  - Data is stored in the EU and encrypted in transit and at rest, with row-level security.
  - Files are auto-deleted after 12 months of inactivity, and users can delete their own data.
  - Accuracy: fills are deterministic on forms with real field layers. Flat or scanned forms rely on OCR and AI, and uncertain placements are flagged for review rather than guessed. — [getfilly.app](https://getfilly.app)
- Disclaimer: "not a law firm," and output is not legal advice. — [getfilly.app](https://getfilly.app)

**Simplicity AI (ProtonLabs Technology Inc.)**
- It is a browser-based PDF filler for fillable and flat PDFs. It converts flat or scanned forms into interactive ones, fills them through a guided Q&A or from an uploaded source document, and supports a reusable handwritten signature, e-sign, iOS and Android apps, and an API with webhooks. Its slogan is "Enter once, auto-fill forever," but no named profile feature is described. — [simplicity.ai](https://simplicity.ai)
- Privacy: documents are encrypted, files are not shared, and data is not used to train AI. No retention period is stated. Accuracy claims of "100% accuracy" and "99%" are unverified marketing. — [simplicity.ai](https://simplicity.ai)
- Pricing: freemium, with Free $0, Premium $15/month and Pro $29.17/month (third-party figures). — [TopAI Tools](https://topai.tools/t/simplicity-ai); [The Daily Workflow (July 2026)](https://thedailyworkflow.com/service/Simplicity%20AI)

**AutoFillPDF / Formfillr**
- I found no product under either exact name. Nearby products are pdf.net's AI filler (W-2, W-4, W-9, 1040, I-9), Autofillr (an AI Chrome web-form extension), and Fill A Form AI, which learns from previously filled forms. — [pdf.net](https://pdf.net/pdf-forms/ai-form-filler); [Comparateur IA – Autofillr](https://comparateur-ia.com/en/ai-tools/autofillr); [Indexator – Fill A Form AI](https://dev.indexator.ai/companies/fill-a-form-ai)

#### B. COI / vendor-compliance tracking (collector side)

**myCOI (Indianapolis)**
- Model: software alone, or software plus outsourced compliance review. It is sold to the collecting organization. In one example (the Pepco Holdings/Exelon supplier page), myCOI is the utility's hired tracker and the program is "no cost" to suppliers, with enrollment mandatory when the purchase order requires it. — [Exelon supplier page](https://www-stg.exeloncorp.com/suppliers/current-suppliers)
- Pricing (third-party estimate, January 2026): $1,500–$3,000/year, or roughly $30–$60 per vendor. — [Vertikal RMS pricing guide](https://vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/)
- Funding and traction: $5M of debt financing from SaaS Capital (announcement undated in results). The same article reports equity rounds from 2011 to 2018, the latest a $2.2M round from 13 investors in 2018, plus 450+ customers and about 85 employees. — [IBJ](https://ibj.com/?p=332901)
- Complaints: getting vendors to engage was hard ("tough to get our vendors to partner"), reports are slow, and report settings can't be saved. — [Capterra reviews](https://www.capterra.com/p/234580/myCOI/reviews/?page=2)

**TrustLayer (San Francisco)**
- Platform: AI-powered third-party risk management that collects and verifies COIs, licenses and other vendor documents. It reports a network of 517,000+ companies and use by 20+ of the top-100 US brokers; an older figure was 298,000. It agreed to acquire PolicyReview (AI policy analysis) on September 29, 2026, terms undisclosed, per a single republished press release. — [Coverager](https://coverager.com/?p=250876)
- Pricing: quote-based by the number of vendors tracked, with a free version. — [Capterra](https://www.capterra.ie/software/198486/trustlayer); [G2](https://www.g2.com/products/trustlayer/pricing)
- Free "Starter" tier launched May 28, 2025, through a waitlist, for SMBs managing fewer than 50 vendors. It includes AI verification that COIs and W-9s are present, prebuilt compliance profiles, and vendor invites with document collection. — [TrustLayer blog](https://www.trustlayer.io/resources/third-party-risk-management-for-all)
- Funding: $21.98M over 8 rounds (seed February 2021, Series A August 2021, last a convertible note October 2022), per CB Insights. — [CB Insights](https://www.cbinsights.com/company/trustlayer/financials)
- Distribution: often bundled through brokers (Marsh, Aon) and partnered with Acrisure. A competitor claims its document review can take up to 7 business days. — [Billy vs TrustLayer (competitor page, ~2026)](https://billyforinsurance.com/resources/billy-vs-trustlayer-construction-coi-tracking/); [Acrisure](https://www.acrisure.com/news/expanded-partnership-with-trustlayers-ai-powered-risk-management-platform)

**Jones (getjones.com)**
- Customers: real estate and construction. It sells Jones Platform (software plus AI review verified by a human) and Jones Operator (a managed team handling outreach, follow-ups and waivers). Pricing is per tenant or vendor record per year, with unlimited COI reviews and extractions, and no public dollar figures. "Jones never charges your vendors or subcontractors." — [Jones pricing](https://www.getjones.com/pricing)
- Funding: $15M Series B led by NewSpring (January 2025), with Khosla, Hetz and Camber Creek participating. Total funding is about $38M. Company claims: 90%+ collection rate and 99.73% accuracy. — [Pulse 2.0](https://pulse2.com/jones-insurance-verification-company-raises-15-million-series-b/amp/); [Coverager](https://coverager.com/?p=214400)

**BCS (getbcs.com)**
- This is the most transparent price list found:
  - Free: up to 25 vendors, permanent, with all software features including AI extraction ("RiskBot"), automated requests and a vendor mobile app.
  - Self-Service: $0.95/vendor/month, or $11.40/vendor/year.
  - Full-Service: $17.80/vendor/year with a $10K annual minimum, adding human review and outreach.
- The client pays. Vendors submit through an app with no login and no vendor fee mentioned. — [BCS pricing](https://getbcs.com/pricing)

**Billy (billyforinsurance.com)**
- COI and prequalification for construction GCs, with Procore, Autodesk and DocuSign integrations. It tracks warranty periods (2, 5 and 10+ years) and offers an "Insurance Wallet": GC-outbound COI requests to its own broker, delivered to the project owner after review. Review is AI plus a CRIS-certified human. Prequalification forms need no login for subs. — [Billy vs TrustLayer](https://billyforinsurance.com/resources/billy-vs-trustlayer-construction-coi-tracking/); [Billy](https://billyforinsurance.com/resources/protect-your-company-from-construction-risk-with-billys-coi-tracking-software/)
- Billy suggests GCs charge the platform cost back to owners as a technology line item. Its example: $25K/year across 38 projects is about $55 per project per month. — [Billy vs TrustLayer](https://billyforinsurance.com/resources/billy-vs-trustlayer-construction-coi-tracking/)
- I found no funding data.

**PINS Advantage**
- Cloud COI tracking for GCs, public agencies and property managers. AI review flags missing endorsements and limits, and humans keep final approval. It integrates with Procore and Viewpoint Vista. One listing gives a starting price of $300 with usage-based pricing by annual certificate and contract volume, and AGC California members get a 10% discount. — [SoftwareFinder](https://softwarefinder.com/insurance-software/pins); [AGC California](https://agc-ca.org/?p=5667)

**PermitsAlert**
- I found no product by this name. Nearby products:
  - YourStanding (Irvine, California; founder Randall Thornton): tracks sub COIs and the contractor's own licenses, bonds and policies. Subs upload through a link with no account. Reminders start 90 days out, and it has license renewal guides for all 50 states. It has a free plan; paid plans start at $29/month. — [SaaSHub](https://www.saashub.com/yourstanding)
  - Expiration Reminder and FieldProxy: generic expiry alerts. — [Expiration Reminder](https://www.expirationreminder.com/document-tracking/contractor-license); [FieldProxy](https://www.fieldproxy.ai/automations/multi-permit-expiry-alert)

**Certificial (sender and insured side)**
- "Smart COIs" are live certificates connected to the agent's management system (Applied, Vertafore). When coverage changes, everyone the COI was shared with gets the update automatically. The insured can share only after the agent verifies, and the agent controls which policies and endorsements can be shared. — [Certificial FAQ](https://certificial.com/faqs); [Insurance Business case study](https://www.insurancebusinessmag.com/us/news/technology/case-study-certificials-smart-coi-network-404085.aspx)
- It announced an ACORD partnership in October 2025 to make Smart COIs a standard. Zurich North America selected it for automated COI issuance in October 2025. — [BusinessWire Oct 2025](https://www.businesswire.com/news/home/20251014529090/en); [BusinessWire Zurich](https://www.businesswire.com/news/home/20251002152412/en/Certificial-Selected-by-Zurich-North-America-to-Power-Automated-COI-Issuance-Across-PC)
- Pricing: free basic tier and a $49 "professional" tier (billing unit unclear). — [G2 via search](https://www.g2.com/products/certificial)

**Other pricing benchmarks (Vertikal RMS, January 2026)**
- C2COI: $800–$2K/year.
- SmartCompliance: $2K–$4K/year.
- CertFocus self-service: $7.5K minimum plus a $3.5K–$4.8K implementation fee.
- CertFocus vendor-pay option: $85–$150 per vendor, paid by the suppliers. — [Vertikal RMS](https://vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/)

**Prequalification networks where the sub pays**
- ISNetworld: the subcontractor's subscription starts at $875+/year and scales with workforce size, plus setup and reinstatement fees. Reviews complain about forced payment and clunky interfaces. This comes from a competitor page. — [Billy vs ISNetworld vs Avetta](https://billyforinsurance.com/resources/billy-vs-isnetworld-vs-avetta-subcontractor-prequalification/)
- A contractor-compliance product charges contractors from $199/year for 1–3 hiring organizations. — [Capterra AU](https://www.capterra.com.au/software/177871/contractor-compliance)

#### C. W-9 / vendor-onboarding tools (collector side)
- **Tax1099**:
  - Real-time TIN Match is $1 each; bulk matching of 10K records is $150.
  - W-9/W-8 e-solicitation prices conflict between sources: $4.99/form on one, packs (1 for $1, 1,000 for $95) on another.
  - Subscriptions: Teams $249/year (250 free TIN matches) and Scale $349/year (API).
  - Aggregator figures were current as of July 24, 2026. — [Tax1099 pricing](https://www.tax1099.com/tax-1099-efile-pricing); [Findstack](https://findstack.com/products/tax1099/pricing)
- **Track1099 (now Avalara 1099 & W-9)**: built-in electronic W-9 collection and TIN matching. I found no current price list. — [CPA Practice Advisor](https://www.cpapracticeadvisor.com/?p=35786); [Avalara W-9](https://www.avalara.com/us/en/products/1099/w-9.html)
- **Tipalti**: a Supplier Hub, hosted or white-labeled through an iFrame, where suppliers self-register. A guided wizard picks the right W-9 or W-8 variant, collects e-signatures, runs IRS TIN matching and checks against a rules engine, and can make tax ID submission mandatory. — [Tipalti tax compliance](https://tipalti.com/ap-automation/automated-tax-compliance/)
- **Ramp**: AP and admin users can request W-9 and payment details from vendors through configurable vendor onboarding forms. Ramp cannot hold or block payments when tax details are missing. — [Ramp support](https://support.ramp.com/manage-vendor-tax-details)
- **BILL**: W-9 requests from the vendor profile's tax tab, available on the free plan and for vendors outside the BILL network. AI extracts data from uploaded W-9s. — [BILL product update](https://Bill.Com/product-updates/quickly-filter-vendors-by-1099-status); [BILL blog](https://www.bill.com/blog/how-to-request-a-w9-from-a-vendor)
- **Gusto**: contractors complete an electronic W-9 during onboarding (SSN/EIN, address, payment). Once signed it can't be edited, so corrections mean a manual re-upload. Gusto files 1099-NECs. — [Gusto support](https://support.gusto.com/article/100739998100000/Hire-and-pay-US-contractors)
- **QuickBooks**: I found no authoritative Intuit documentation. A third-party post describes contractors stuck at "waiting for info" when they don't complete the W-9 invite, which is unreliable. — [write.as](https://write.as/badsha/how-to-handle-contractor-w-9-submission-errors-in-quickbooks-online)
- **Regulatory context**: the 1099 reporting threshold rises from $600 (through 2025) to $2,000 for 2026 payments. — [Tipalti blog](https://tipalti.com/blog/why-you-need-a-w9-for-vendors/)

#### D. KYB
- **Middesk**:
  - Pricing is sales-led and usage-based (per verification or API call). Vendr reports a median of $11,875/year, with a range of $10K–$186K. One listing says it starts at $500/month.
  - Funding: $57M Series B led by Sequoia (June 2022), for a total of about $75–77M. I found no 2025 round.
  - Also offers a DocuSign "Verify business" integration. — [Vendr](https://www.vendr.com/marketplace/middesk); [Bouncewatch](https://bouncewatch.com/company/middesk); [Middesk docs](https://docs.middesk.com/verify-business/docusign)
- **Baselayer (New York)**: AI KYB, business identity and fraud data for banks and fintechs.
  - Seed: $6.5M (2024).
  - Series A: reported as $35M led by M13 alongside an "Agentic Identity Suite" launch on September 22, 2026. Other outlets report $20M (Koro Capital and M13), so it is unclear whether those are the same round. — [Crunchbase News](https://news.crunchbase.com/ai/verifying-ai-agents-baselayer-35m-raise/); [Fintech Futures](https://www.fintechfutures.com/ai-in-fintech/baselayer-35m-series-a-funding-round); [citybiz](https://www.citybiz.co/?p=886247)

#### E. 2025-2026 AI-native and adjacent entrants
- **WithCoverage**: a flat-fee AI risk-management team that replaces the commission-based broker. Its dashboard covers policies, COIs and claims. Founded 2023; $42M Series B (January 2026) led by Sequoia and Khosla; 700+ companies switched in 18 months. It is a neighbor on COI issuance for the insured SMB. — [Coverager](https://coverager.com/withcoverage-raises-42-million/); [Pulse 2.0](https://pulse2.com/withcoverage-42-million-series-b-closed-to-build-ai-powered-risk-management-team/amp/)
- **Corgi**: an AI-powered insurer for startups that issues COIs. It raised $108M in January 2026. — [Wikipedia](https://en.wikipedia.org/wiki/Corgi_(insurance_company))
- **Fulcrum**: an AI platform for brokerages that extracts data from policies and certificates. $25M seed plus Series A led by CRV (January 2026). — [The Insurer](https://www.theinsurer.com/ti/news/ai-platform-fulcrum-secures-25-million-in-funding-2026-01-28/)
- **Platus (YC)**: aimed at SMBs, with notarization, legal drafting, e-signing and workflow automation. Listed in the YC compliance directory. — [YC directory](https://www.ycombinator.com/companies/industry/compliance)
- **Constrafor COI Submission Hub** (sender side): free. A sub uploads a COI once, sends it to any GC, and gets delivery confirmation. Article dated July 28, 2025. — [Constrafor](https://www.constrafor.com/the-build-up/did-they-get-it-ending-the-coi-submission-nightmare-for-subcontractors)
- **Context**: YC's Fall 2025 Request for Startups encouraged LLM-based compliance and government-paperwork companies. Delve, a YC AI-compliance startup, faced anonymous allegations of faking compliance processes, which are unverified. — [the-ai-corner](https://www.the-ai-corner.com/p/yc-requests-for-startups-fall-2025-ai-trends); [YC directory](https://www.ycombinator.com/companies/industry/compliance)

### Inferences
- AI extraction and review has become table stakes in COI tracking (BCS RiskBot, Jones, Billy, PINS, TrustLayer). It is no longer a differentiator on the collector side.
- AI fillers converge on the same stack: LLM API with no-training terms, encryption, and "profiles" as memory. Filly's "learn from corrections" plus confidence colors is the closest analog to ShipShape's profile re-confirmation.
- Filly is the closest direct comparator on the filling and e-sign side, but it is built for professionals serving clients (lawyers, accountants), not for an SMB managing its own identity.

### Gaps
- Instafill's official pricing page and privacy policy did not render. Its funding and traction are unknown.
- I found no funding or traction for Filly, Simplicity, Billy, PINS or YourStanding. myCOI's debt-round date is unconfirmed.
- I could not identify "PermitsAlert," "AutoFillPDF" or "Formfillr" as distinct products.
- I found no current Track1099/Avalara W-9 pricing and no official QuickBooks contractor W-9 documentation.
- I found no G2 or Capterra complaint data for the AI fillers.

## Who already lets a small business keep one reusable profile/packet and share it with many counterparties?

### Takeaway
A reusable "supplier profile" exists, but only inside buyer-controlled networks such as Coupa CSP, SAP Business Network, Trust Your Supplier, ISNetworld/Avetta and Procore prequalification. Each works only with customers on that network, and each covers a narrow set of fields. Cross-network, SMB-owned, link-shareable packets exist only as narrow point solutions: Constrafor (COI only, construction), Certificial (insurance only, agent-gated) and YourStanding (contractor-side tracking). I found no product that combines W-9, COI, licenses and formation docs into a single SMB-owned, live, shareable "passport" link.

### Cited Findings
- **Coupa Supplier Portal**: a supplier can share its Business Profile with one or more customers. The shareable sections are Company Info, Tax Registrations, Contacts, Addresses, and Diversity Classifications and Certifications. Limits:
  - The supplier must be linked to the customer, and the customer must have Coupa Supplier Information Management (SIM) with the sharing permission enabled.
  - When a customer requests the profile, all sections must be shared.
  - Customers can accept, decline or partially accept updates.
  - No general document (COI) sharing is described. — [Coupa Compass](https://compass.coupa.com/en-us/products/product-documentation/supplier-resources/for-suppliers/coupa-supplier-portal/get-started-with-the-csp/profiles/sharing-your-business-profile-information)
- **SAP Business Network (Ariba)**:
  - Standard supplier accounts are free and include a searchable company profile and document collaboration.
  - Enterprise accounts pay subscription plus transaction fees. A 2023 guide says fees apply above $50K and 5 documents per customer relationship, at 0.155%–0.35% of transaction value; these figures may be outdated. — [SAP pricing](https://www.sap.com/products/business-network/suppliers/pricing.html); [SAP Learning](https://learning.sap.com/courses/overview-of-sap-business-network/discussing-the-sap-business-network-supplier-fees_e4deac90-bef8-4e86-a86b-08d526286a4b)
- **Trust Your Supplier** (IBM/Chainyard, launched 2019): a permissioned blockchain "digital passport for supplier identity" shared with any buyer on the network, with D&B, EcoVadis and RapidRatings as verifiers. It is buyer-founded (AB InBev, GSK, Lenovo, Nokia, Vodafone). I found no pricing and no evidence of current SMB reach. — [Ledger Insights](https://www.ledgerinsights.com/?p=7232); [SCMR](https://www.scmr.com/article/ibm_and_chainyard_collaborate_on_blockchain_network/blockchain)
- **Procore Prequalification Portal**: invited subs fill out a GC-specific form. Required fields are legal name, FEIN and industry type. It is per GC, not portable. — [Procore support](https://support.procore.com/products/online/user-guide/company-level/prequalification-portal/tutorials/submit-a-prequalification-form)
- **Pay-to-play networks**: ISNetworld charges subs $875+/year. — [Billy comparison](https://billyforinsurance.com/resources/billy-vs-isnetworld-vs-avetta-subcontractor-prequalification/)
- **Constrafor**: "Upload your COI once, send it anywhere." Free, COI only, construction only (July 2025). — [Constrafor](https://www.constrafor.com/the-build-up/did-they-get-it-ending-the-coi-submission-nightmare-for-subcontractors)
- **Certificial**: live COIs shared with many requestors and updated automatically. Sharing is gated by the insurance agent, who chooses which policies can be shared. — [Certificial FAQ](https://certificial.com/faqs)
- **TrustLayer** claims a "network" of 517K+ companies. However, I found nothing describing a vendor-owned profile that vendors can push to multiple clients. — [Coverager](https://coverager.com/?p=250876)
- **NYC PASSPort**: a government procurement portal where vendors keep a profile with documents (EEO, DBA, Certificate of Incorporation). It works only for NYC agencies. — [NYC MOCS](https://www.nyc.gov/site/mocs/passport/articles/upload-eeo-dba.page)

### Inferences
- Every reusable profile found is scoped to a hub: one buyer network, one GC's Procore, one city, or one agent's book. Portability across hubs is the gap that ShipShape's "paperwork passport" link targets.
- Certificial's agent-verified live COI suggests a model where ShipShape could link to, or embed, live insurance data instead of storing static PDFs.

### Gaps
- I could not verify whether TrustLayer, Jones or myCOI give vendors a persistent profile that is reusable across different client accounts on the same platform.
- I found no "vendor passport" startup (YC or otherwise) for SMBs in 2025-2026. Searches returned only NYC PASSPort and unrelated EU Digital Product Passports.

## How do COI tools price, and who pays — the collector or the sender?

### Takeaway
The collector pays, per tracked vendor or record per year. Vendor submission is free and is often marketed as a feature ("never charges your vendors"). The exceptions are prequalification networks (ISNetworld, and CertFocus's vendor-pay option), where the sub pays $85–$875+ a year. GCs sometimes pass costs on to project owners.

### Cited Findings
- **BCS**: free up to 25 vendors; $0.95/vendor/month self-service; $17.80/vendor/year full-service with a $10K minimum. Billed to the client. — [BCS pricing](https://getbcs.com/pricing)
- **Jones**: per record per year, unlimited COIs; "never charges your vendors or subcontractors." — [Jones pricing](https://www.getjones.com/pricing)
- **myCOI**: about $30–$60 per vendor, or $1.5K–$3K/year (January 2026 estimate). Free to suppliers in the utility example. — [Vertikal RMS](https://vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/); [Exelon](https://www-stg.exeloncorp.com/suppliers/current-suppliers)
- **TrustLayer**: quote-based by number of vendors. Free Starter tier for fewer than 50 vendors (May 2025). — [Capterra](https://www.capterra.ie/software/198486/trustlayer); [TrustLayer](https://www.trustlayer.io/resources/third-party-risk-management-for-all)
- **CertFocus**: $6–$29 per vendor location paid by the buyer, plus implementation fees. Its vendor-pay option is $85–$150 per vendor, paid by suppliers. — [Vertikal RMS](https://vertikalrms.com/article/how-much-does-coi-tracking-software-cost-2025-pricing-guide/)
- **PINS**: from $300, usage-based by certificate and contract volume. — [SoftwareFinder](https://softwarefinder.com/insurance-software/pins)
- **Certificial**: free basic tier and a $49 professional tier. — [G2](https://www.g2.com/products/certificial)
- **Billy**: GCs charge the cost back to owners; its example is about $55 per project per month. — [Billy](https://billyforinsurance.com/resources/billy-vs-trustlayer-construction-coi-tracking/)
- **ISNetworld**: subs pay $875+/year plus fees. — [Billy comparison](https://billyforinsurance.com/resources/billy-vs-isnetworld-vs-avetta-subcontractor-prequalification/)
- **Small-contractor tools**: YourStanding has a free plan, with paid plans from $29/month. — [SaaSHub](https://www.saashub.com/yourstanding)

### Inferences
- Senders are used to paying $0 to submit. ShipShape's sender-side willingness to pay will depend on time saved across many requesters and on bundled value (filling, e-sign, vault), not on submission itself.
- Collector-side "free up to 25–50 vendors" tiers (BCS, TrustLayer Starter) mean small businesses that need to collect documents from their own subs already have free options. ShipShape's two-way requests compete with free tools.
- A potential wedge: when a ShipShape user is asked through myCOI, TrustLayer or Jones, a one-click "send my passport" or auto-upload integration would serve the sender without fighting the collector incumbents.

### Gaps
- No public dollar pricing for TrustLayer, Jones, myCOI, Billy or PINS beyond third-party estimates.
- No independent data on how often vendor-pay models occur outside prequalification networks.

## What do AI form fillers do about memory, accuracy, privacy, and data retention?

### Takeaway
Memory is implemented as stored "profiles": per-client profiles for Filly and Instafill PLUS, and a reusable signature for Simplicity. Filly adds per-form correction learning and confidence color-coding. Accuracy safeguards are human review plus flagging of uncertain fields; marketing claims run from 99% to 100%. Privacy follows a common pattern: commercial LLM APIs with no-training terms, encryption at rest, and deletion on account close. Only Filly states a time-based auto-delete (12 months inactive), and only Instafill documents configurable retention and a full subprocessor list. None of them describes ShipShape-style "re-confirm stale profile data with the user."

### Cited Findings
- **Filly**:
  - Memory: reusable client profiles with a completeness score, and "Correct a field once. Never correct that form again."
  - Accuracy: confidence color-coding. Fills are deterministic on real field layers; OCR and AI are used for flat forms, and uncertain fields are flagged, not guessed.
  - Privacy: Claude API with no training, EU storage, row-level security, auto-delete after 12 months inactive. — [getfilly.app](https://getfilly.app)
- **Instafill**:
  - Memory: custom profiles on paid plans. — [DEV Community](https://dev.to/instafill/what-is-instafillai-and-why-it-works-2jka)
  - Data flow: OpenAI, Azure OpenAI and Gemini receive extracted text and screenshots, not raw files, with no training.
  - Retention: client-side AES-256 encryption before storage, configurable retention, deletion on account close. — [Instafill subprocessors](https://instafill.ai/features/subprocessors)
- **Simplicity**: "Enter once, auto-fill forever"; review before export; no training; encrypted. No retention period stated. Claims "100% accuracy." — [simplicity.ai](https://simplicity.ai)
- **Workflow tools**: Gumloop's AI Fill PDF requires fillable fields, meaning a real AcroForm layer. — [Gumloop docs](https://docs.gumloop.com/nodes/pdf/ai_fill_pdf)
- **Collector side**: AI plus human verification is the norm for higher-stakes extraction. Jones ("AI-assisted review that a human verifies") and Billy (a CRIS-certified reviewer confirms the AI) both use it. — [Jones](https://www.getjones.com/pricing); [Billy](https://billyforinsurance.com/resources/billy-vs-trustlayer-construction-coi-tracking/)

### Inferences
- An industry baseline exists for privacy claims: no-training API, encryption, a deletion path, and a subprocessor list. ShipShape needs to match it and can go further. Possible additions: field-level retention, data-freshness timestamps, and an explicit re-confirm prompt before reuse.
- The data is sensitive (EIN or SSN on W-9s; Kaizen CPAs stresses secure W-9 storage), so a public "passport" link needs granular, revocable sharing, for example W-9 shared only on request. — [Kaizen CPAs](https://www.kaizencpas.com/blog/w9-1099-requirements-for-small-business)

### Gaps
- No independent accuracy benchmarks for any AI filler.
- Instafill's and Simplicity's full privacy policies could not be retrieved, so their retention periods are unknown.

## What is genuinely unserved for the small business on the sending side?

### Takeaway
The sending SMB lacks a single, owned, cross-network packet. That packet would hold the W-9, the COI (ideally live), licenses, and formation and tax documents, each with freshness tracking. It would push to, or fill, whatever each requester uses: Coupa, Ariba, a Procore prequalification form, myCOI/TrustLayer/Jones invites, Ramp/BILL/Gusto W-9 requests, or plain email. Today's sender-side options are fragmented: COI-only (Constrafor), agent-gated insurance-only (Certificial), contractor-only tracking (YourStanding), or locked to a buyer network (Coupa, SAP, Trust Your Supplier).

### Cited Findings
- Subs face no standard submission process. Each GC uses a different portal, email or contact, often without confirmation, and missing COIs delay payment. — [Constrafor (July 2025)](https://www.constrafor.com/the-build-up/did-they-get-it-ending-the-coi-submission-nightmare-for-subcontractors)
- Collectors struggle to get vendors to engage. One myCOI reviewer said it was "tough to get our vendors to partner." — [Capterra myCOI reviews](https://www.capterra.com/p/234580/myCOI/reviews/?page=2)
- Every collector tool builds its own vendor intake: BCS mobile app, Jones vendor self-serve portal, Billy's login-free forms, Ramp vendor forms, BILL W-9 requests, Gusto's e-W-9, Tipalti Supplier Hub. Each is per-requester, so the sender re-enters data each time. — [BCS](https://getbcs.com/pricing); [Jones](https://www.getjones.com/pricing); [Ramp](https://support.ramp.com/manage-vendor-tax-details); [Gusto](https://support.gusto.com/article/100739998100000/Hire-and-pay-US-contractors); [Tipalti](https://tipalti.com/ap-automation/automated-tax-compliance/)
- Gusto e-W-9s can't be edited once signed; corrections require manual re-upload. This is a friction point a sender-owned, versioned W-9 could address. — [Gusto](https://support.gusto.com/article/100739998100000/Hire-and-pay-US-contractors)
- Coupa sharing requires the customer to enable SIM permissions, covers only profile fields with no COI, and forces all sections to be shared on request. That gives the sender little control over granular disclosure. — [Coupa Compass](https://compass.coupa.com/en-us/products/product-documentation/supplier-resources/for-suppliers/coupa-supplier-portal/get-started-with-the-csp/profiles/sharing-your-business-profile-information)
- Sub-pays networks cost $875+/year (ISNetworld), and one listing describes consultants at about $5K/year helping subs comply. — [Billy comparison](https://billyforinsurance.com/resources/billy-vs-isnetworld-vs-avetta-subcontractor-prequalification/); [Product Hunt – PrequalPilot](https://www.producthunt.com/p/prequalpilot/isnetworld-compliance-for-subcontractors-without-the-5k-consultant)
- The 1099 threshold moves to $2,000 for 2026 payments, which could slightly reduce W-9 demand for small payees. Payers still commonly request W-9s at onboarding regardless. — [Tipalti](https://tipalti.com/blog/why-you-need-a-w9-for-vendors/); [Melio](https://melio.com/blog/when-is-a-w-9-required-from-a-vendor/)
- KYB vendors (Middesk, Baselayer) verify businesses for banks and fintechs at roughly $10K+/year contract sizes. No SMB-facing "verified business" badge exists that the SMB itself can carry and share. — [Vendr – Middesk](https://www.vendr.com/marketplace/middesk); [Crunchbase News – Baselayer](https://news.crunchbase.com/ai/verifying-ai-agents-baselayer-35m-raise/)

### Inferences
These are synthesis, not sourced facts.
- **Unserved 1: one owner-controlled packet across all requesters.** It would track freshness (COI expiration, license renewal, W-9 changes after an address or entity change) and allow per-recipient, revocable sharing.
- **Unserved 2: AI that fills the requester's form or portal from the packet.** That means requester PDFs, prequalification questionnaires and W-9 requests, not just storing files. AI fillers serve professionals filling for clients (Filly) or individuals; none ties filling to a persistent business identity plus sharing.
- **Unserved 3: proactive renewal for the sender.** Collector tools chase vendors; ShipShape could pre-empt the chase by notifying the SMB and auto-pushing renewals to subscribers of the passport link. This mirrors Certificial's live-update model but goes beyond insurance.
- **Unserved 4: a lightweight "verified" layer.** For example, TIN-match or KYB-lite checks (Tax1099 TIN match is $1 each) that let a passport show "EIN verified," raising requester trust.
- **Risks**:
  - Collector incumbents (TrustLayer with a 517K network, BCS's free tier, Constrafor's free hub) could add sender-side profiles cheaply.
  - Requesters may refuse external links and insist on their own portals, which pushes ShipShape toward integrations and auto-fill of portals.

### Gaps
- I found no survey data quantifying how many requests a typical SMB receives per year, or the time spent.
- I found no evidence on whether requesters (myCOI, Jones, Ramp) accept third-party links or APIs for intake.
- Possible stealth 2025-2026 startups in this exact "business passport" space could not be confirmed by search.
