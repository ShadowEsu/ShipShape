# ShipShape — Legal Risk Playbook

> **ShipShape: Find it. Fill it. Sign it. Store it.**
> One place where freelancers, restaurants, startups, small businesses and corporations
> find the legal documents they need, fill them in, sign them and keep them.

This is a product-design document, not legal advice. Before launch, a startup /
legal-tech attorney should review the actual product flows and the Terms of Service.

---

## The core truth

**No Terms of Service can make ShipShape "impossible to sue."** Courts throw out
blanket "you can't sue us" clauses (e.g. California Civil Code §1668 voids attempts to
exempt yourself from fraud, willful injury or violations of law). North Carolina's
statute for interactive legal-document websites (G.S. 84-2.2) goes further: it
*forbids* such sites from disclaiming warranties or liability toward NC consumers at all.

So the defense isn't one clause. It's a **product that doesn't do the things people
sue over**, plus a ToS, an insurance policy and a company structure that limit
the damage when someone sues anyway.

---

## The six ways ShipShape could get sued, and the defense for each

### 1. Unauthorized practice of law (UPL). The biggest risk.
**Who comes after you:** state bars and attorneys general, not customers. LegalZoom
fought the North Carolina State Bar for years (a probable-cause finding in 2008,
a consent judgment in 2015) before NC passed a statute for document sites.

**What triggers it:** software that tells a *specific person* what legal document to
use or what terms to choose for *their situation*, or that drafts custom legal language.

**Defense, built into the product:**
- The AI **searches and explains**: "Here are document types people use for
  freelance web work: service agreement, SOW, NDA. Here's what each one generally does."
- The **user chooses** the document. The AI never says "you should use X."
- The AI **fills factual fields only**: names, addresses, dates, amounts, deliverables
  the user typed. It **never writes or changes substantive clauses**.
- Every flow has a **"Talk to a lawyer"** exit (later: a vetted attorney-referral network;
  have counsel structure that, because lawyers can't split fees with non-lawyers).
- Comply with **NC G.S. 84-2.2** if you serve NC: show the blank template before purchase,
  have an NC-licensed attorney review the NC templates, disclose your legal name and
  address, have a visible complaint process, register with the NC State Bar.
  Alternatively, exclude NC by geography at launch.

### 2. A user's document fails them and they blame ShipShape
**Example:** a freelancer isn't paid, and the agreement turns out to be unenforceable in their state.

**Defense:**
- Use **real, attorney-drafted source documents** (see #3). Don't use AI-generated contracts.
- A **pre-sign review screen** with a required checkbox (clickwrap, logged with a timestamp):
  "ShipShape is document software, not a law firm. I'm responsible for reviewing this
  document and deciding whether to get legal advice."
- **Audit trail** for every document: source, template version, date, every field ShipShape
  filled and every edit the user made. That record is your best evidence in a dispute.
- ToS drafted by an attorney (see "Terms of Service" below).

### 3. Copyright: using templates you don't have rights to
"Publicly available" doesn't mean "free to put inside a commercial app."

| Source | Status | How to use it |
|---|---|---|
| **Common Paper** standard agreements (NDA, cloud services, professional services, DPA, etc.) | **CC BY 4.0**: free for commercial use | Keep attribution; label edited versions "Derived from Common Paper ___ v1.0" |
| **U.S. federal government forms** (IRS, USCIS, SBA…) | Generally public domain | Link to or embed the official form; fill its fields |
| **State/local government forms** | Varies by state | Check each one |
| **Y Combinator SAFE** | YC disclaims responsibility but has **no clear redistribution license**; YC offers its own free SAFE-sending tool | **Link out** to YC's official docs/tool, or get written permission. Don't re-host them yet |
| **Bonterms, Cooley GO, law-firm templates** | Each has its own terms | Check each license before using it |
| **User-uploaded documents** | The user's own | Organize, fill fields, sign, store |

Store each template's **license and source URL in the database** next to the template.

### 4. Regulators: false advertising (FTC)
In January 2025 the FTC finalized an order against DoNotPay ("the world's first robot
lawyer"): a **$193,000** payment, required notices to customers, and a ban on claiming it
works like a lawyer without evidence. They were punished for **marketing claims**.

**Never say:** "AI lawyer," "replace your lawyer," "legally binding guaranteed,"
"lawsuit-proof," "100% compliant."
**Do say:** "Find, fill, sign and store your business documents." "Attorney-drafted
templates from trusted sources."

### 5. Data breach and privacy
ShipShape will hold contracts, signatures, SSNs/EINs and financial terms. A breach is a lawsuit.
- Encrypt at rest and in transit; strict per-user access control; audit logs.
- Users can delete their data. Keep a privacy policy (CCPA/CPRA if you have California users).
- Don't send sensitive fields to an LLM unless you have to; redact before AI calls where possible.
- SOC 2 later, once you sell to businesses.

### 6. E-signatures
**Don't store a user's signature and let AI apply it.** That invites "I never signed that."
- Use an established e-sign provider's API (Dropbox Sign, DocuSign, BoldSign…)
  that handles ESIGN/UETA consent and tamper-evident audit certificates.
- Every signature takes an explicit click by the signer, every time.

---

## Terms of Service: what to ask your attorney for
Instead of "you agree never to sue us," ask for:
1. A clear statement that ShipShape is software, **not a law firm**, and that no attorney-client relationship exists.
2. **No guarantee** that a document fits a particular situation or is enforceable.
3. **User responsibility** for the accuracy of what they enter and for approving documents.
4. **Limitation of liability**, e.g. capped at fees paid in the last 12 months, where the law allows it (with NC and other state carve-outs).
5. **Arbitration + class-action waiver** (helps, doesn't eliminate lawsuits; it must be presented clickwrap, not buried in a footer link).
6. Template **attribution and licensing** terms.

## Company protection
- **Form an entity** (Delaware C-corp if you'll raise VC; an LLC otherwise) so that
  claims hit the company, not you personally. Don't mix personal and company money.
- **Insurance:** tech errors & omissions (E&O) plus cyber liability. That's what pays for
  defending a lawsuit.
- **Budget for a few hours with a legal-tech/UPL attorney** before launch. That is worth
  more than any disclaimer.

---

## Launch scope (v1) that keeps risk low
- Users: freelancers and small businesses in a few states (not NC until compliant).
- Documents: Common Paper agreements + federal forms + user uploads; YC SAFE as a link-out.
- AI: natural-language search, plain-English explanations, factual field-fill. No clause drafting.
- E-sign via a provider API. Encrypted storage. Full audit trail.
- Pre-sign review screen + "Talk to a lawyer" on every document.

## Sources
- [G.S. 84-2.2: NC interactive legal-document website requirements](https://ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_84/GS_84-2.2.html)
- [LegalZoom v. NC State Bar consent judgment (2015 NCBC 96)](https://www.nccourts.gov/assets/documents/opinions/2015_NCBC_96.pdf)
- [FTC: DoNotPay final order](https://www.ftc.gov/node/87474) · [$193k settlement coverage](https://www.accountsrecovery.net/2025/02/12/robot-laywer-donotpay-to-pay-193k-in-settlement-with-ftc/)
- [Common Paper standard contracts (CC BY 4.0)](https://commonpaper.com/standards/) · [Editing the standard terms](https://help.commonpaper.com/en/articles/8757714-editing-the-standard-terms)
- [YC opens its SAFE-sending software for free](https://runtimewire.com/article/y-combinator-opens-free-safe-sending-software) · [Cooley GO on YC SAFE forms](https://www.cooleygo.com/documents/y-combinator-safe-financing-document-generator-singapore/)
