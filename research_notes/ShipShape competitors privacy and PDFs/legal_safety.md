# Legal-Safety Boundaries for ShipShape (UPL, licensing, e-sign, FTC, ToS, entity/insurance)

> Research notes as of 2026-10-11. US focus. This is product-design research, not legal advice. A licensed attorney should review before launch. Items marked "[not re-verified this session]" cite a primary source from background knowledge that was not re-fetched during this research pass. The writer should treat those as reliable but should check them before quoting exact wording.

## 1. Unauthorized practice of law (UPL): where the line is for document software, key cases, 2024-2026 developments

### Takeaway
Courts and legislatures consistently protect "scrivener" functions: providing blank forms, letting the user pick the form, recording the user's own facts verbatim, and giving general information. The risk comes from personalized judgment, meaning software or staff choosing a legal option or document for the user's situation, drafting or altering legal language, or marketing the product as a lawyer substitute. The case law has not moved toward liberalization from 2024 to 2026. The Second Circuit's 2025 Upsolve decision (cert denied 2026) upheld New York's power to apply UPL rules even to narrow, form-focused advice, and new suits (Nippon Life v. OpenAI, 2026) are testing whether AI chat is UPL.

### Cited Findings
**Janson v. LegalZoom (W.D. Mo. 2011, federal court applying Missouri law).** The court denied LegalZoom summary judgment. It held that selling blank forms is fine, but LegalZoom's branching questionnaire plus employee review, which turned customer answers into a finished legal document, could be UPL under Missouri law. The court likened it to a lawyer filling in a form rather than a customer filling in their own. Note that the brief's "Mo. 2011" label is slightly off: this was a federal district court ruling (802 F. Supp. 2d 1053), and the case settled in 2012. — [Janson v. LegalZoom.com, 802 F. Supp. 2d 1053 (W.D. Mo. 2011) via CourtListener search](https://www.courtlistener.com/?q=Janson+v.+LegalZoom) [not re-verified this session]

**North Carolina, N.C.G.S. 84-2.2 (2016, enacted after LegalZoom's litigation with the NC State Bar).** It creates a statutory safe harbor: operating a website with "interactive software that generates a legal document" is not the practice of law if the provider:
- (1) lets the consumer see the blank template or the final document before buying;
- (2) has an NC-licensed attorney review each blank template offered to NC consumers, and keeps the reviewer's name and address on file for consumers who ask;
- (3) tells consumers the forms "are not a substitute for the advice or services of an attorney";
- (4) discloses its legal name and physical address;
- (5) "does not disclaim any warranties or liability" and does not limit consumers' damages or remedies;
- (6) does not require jurisdiction or venue outside NC;
- (7) has a consumer-complaint process that tells consumers UPL concerns go to the NC State Bar, displayed conspicuously.

Providers must also register with the State Bar each year (initial fee of $100 or less, renewal $50 or less), and the Bar cannot refuse registration. — [N.C.G.S. 84-2.2](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_84/GS_84-2.2.html)

**Parsons Technology (Quicken Family Lawyer), Texas 1999 and the statutory fix.** The N.D. Tex. court held that Quicken Family Lawyer software was UPL in Texas and enjoined its sale (Jan. 1999). The Texas Legislature then amended Tex. Gov't Code 81.101(c): the "practice of law" does not include the design, creation, publication, distribution, display, or sale of written materials, books, forms, computer software, or similar products "if the products clearly and conspicuously state that the products are not a substitute for the advice of an attorney." The Fifth Circuit then vacated the injunction (179 F.3d 956, 5th Cir. 1999). — [Tex. Gov't Code ch. 81](https://statutes.capitol.texas.gov/Docs/GV/htm/GV.81.htm) [not re-verified this session]

**In re Reynoso (9th Cir. 2007).** This is a highly relevant software precedent. A web-based bankruptcy petition preparer's software, which chose exemptions and gave legal guidance based on the user's answers and was marketed as an "expert system," was held to be UPL. The court said software that "went far beyond providing clerical services" and "determined where (particular information) should be placed" in a way that required legal judgment crossed the line. — [In re Reynoso, 477 F.3d 1117 (9th Cir. 2007)](https://law.justia.com/cases/federal/appellate-courts/F3/477/1117/568640/) [not re-verified this session]

**Upsolve, Inc. v. James, No. 22-1345 (2d Cir. Sept. 9, 2025).**
- The panel vacated the district court's 2022 preliminary injunction that had protected Upsolve's trained non-lawyer "Justice Advocates" from New York's UPL laws.
- It held that the UPL statutes regulate speech but are content-neutral, so intermediate scrutiny applies rather than strict scrutiny, and remanded.
- The panel stressed that even advice limited to filling out a one-page debt-collection answer form falls within New York's longstanding definition of practicing law. — [Public Citizen CLP blog](https://clpblog.citizen.org/second-circuit-holds-unlawful-practice-law-can-apply-to-debt-collection-advice/); [Pro Bono Institute](https://www.probonoinst.org/2025/10/07/setback-for-justice-advocates-in-upsolve-litigation/); [Law360](https://www.law360.com/pulse/articles/2385874)

**Upsolve at the Supreme Court.** The cert petition (No. 25-948) was filed Feb. 6, 2026 and denied Mar. 30, 2026. Petitioners had told the Court the district court dismissed the underlying case on Mar. 6, 2026. — [SCOTUS docket 25-948](https://www.supremecourt.gov/docket/docketfiles/html/public/25-948.html); [Petitioners' supplemental brief](https://www.supremecourt.gov/DocketPDF/25/25-948/400536/20260311110011432_Supplemental%20Brief%20of%20Petitioners_PDF-A.pdf)

**Florida Bar v. TIKD Services (Fla. 2021).** The Florida Supreme Court held that TIKD committed UPL. TIKD, a non-lawyer app, paid customers' traffic-ticket fines up front and hired lawyers to fight the tickets. The court found TIKD itself provided legal services and influenced the lawyer relationship, and it enjoined the model. The lesson is that a non-lawyer company standing between the consumer and the legal outcome is risky even when lawyers do the actual work. — [Florida Bar v. TIKD Services LLC, 326 So. 3d 1073 (Fla. 2021)](https://law.justia.com/cases/florida/supreme-court/2021/sc18-149.html) [not re-verified this session]

**Faridian v. DoNotPay (filed Mar. 3, 2023, S.F. Superior Court CGC-23-604987, removed to N.D. Cal. 3:23-cv-01692).** This is a California UCL (B&P 17200) class action. It alleges DoNotPay held itself out as an attorney ("robot lawyer") and practiced law without a license by selling legal services to Californians. — [Complaint (DocumentCloud)](https://s3.documentcloud.org/documents/23701054/faridian-v-donotpay.pdf); [N.D. Cal. removal notice](https://storage.courtlistener.com/recap/gov.uscourts.cand.410868/gov.uscourts.cand.410868.1.0.pdf); [Wilson Elser](https://www.wilsonelser.com/publications/lawyer-bot-short-circuited-by-class-action-alleging-unauthorized-practice-of-law)
- Its outcome is unclear. Wikipedia says the parties "reached a settlement in principle," but the terms are undisclosed and no primary source was found. — [Wikipedia: DoNotPay](https://en.wikipedia.org/wiki/DoNotPay)

**FTC v. DoNotPay (part of Operation AI Comply, Sept. 2024; final order early 2025).**
- The complaint alleged DoNotPay never tested whether its "AI lawyer" performed at the level of a human lawyer, and did not hire or retain attorneys to test the quality and accuracy of its law-related features.
- The final order requires $193,000 in monetary relief and notice to subscribers from 2021-2023, and bars unsubstantiated claims that the service can substitute for a lawyer.
- A secondary source puts the final vote at 5-0 on Jan. 16, 2025. Some reports say February 2025, so the exact date is unconfirmed. — [FTC (node/87474)](https://www.ftc.gov/node/87474); [MLex](https://www.mlex.com/mlex/amp/articles/2296777)

**Nippon Life Insurance Co. of America v. OpenAI Foundation (N.D. Ill., filed Mar. 2026).**
- Claims include tortious interference, abuse of process, and unlicensed practice of law. Nippon alleges a former claimant used ChatGPT to file dozens of filings to reopen a settled matter, including at least one citation to a nonexistent case.
- Nippon seeks $300K in compensatory damages, $10M in punitive damages, and an injunction against OpenAI providing legal assistance in Illinois.
- A Tech Policy Press analysis dated Oct. 9, 2026 describes the case as still pending. — [Tech Policy Press](https://techpolicy.press/nippon-life-v-openai-and-the-future-of-ai-legal-work); [Daily Journal](https://dailyjournal.com/articles/390623-chatgpt-on-trial-a-landmark-test-of-ai-liability-in-the-practice-of-law); [Mondaq](https://webiis10.mondaq.com/unitedstates/new-technology/1758666/lawsuit-alleges-ai-chatbot-engages-in-unauthorized-practice-of-law)

**Unverified 2026 bar actions.**
- A members-only forum claims a Texas advisory ethics opinion (No. 716, Mar. 2026) treats non-lawyers using AI to draft demand letters or pleadings for others as UPL.
- The same source claims a Florida Bar UPL case over AI-generated demand letters was brought in Feb. 2026.
- Neither could be verified from a primary source. — [terms.law forum (unverified)](https://www.terms.law/forum/thread/gpt-ai-practicing-law-demand-letters.html)

**Regulatory sandboxes and reform (2024-2026).**
- Utah's legal regulatory sandbox, created by Utah Supreme Court Standing Order No. 15, is the main working model for non-traditional legal-service providers, including tech. Its approach is court-led, not statutory.
- Colorado's Supreme Court formed a subcommittee to consider AI-related amendments to UPL rules. No public proposal had been released as of the source date.
- Texas and Connecticut created general AI regulatory sandboxes in 2026 (Texas allows testing for up to 36 months). Nothing confirms these cover legal services.
- A TRI/NCSC policy paper urges state supreme courts to reform UPL rules and consider sandboxes for consumer-facing AI legal tools.
- Sources: [Thomson Reuters Institute](https://www.thomsonreuters.com/en-us/posts/government/ai-impacts-unauthorized-practice-of-law/); [NCSC](https://www.ncsc.org/resources-courts/modernizing-unauthorized-practice-law-regulations-embrace-technology-improve); [King & Spalding on 2026 state AI laws](https://www.kslaw.com/news-and-insights/new-state-ai-laws-are-effective-on-january-1-2026-but-a-new-executive-order-signals-disruption)

**No new legal-services AI statute found.** No 2026 state statute specifically legalizing AI legal-document services was found in this pass. — [Thomson Reuters Institute](https://www.thomsonreuters.com/en-us/posts/government/ai-impacts-unauthorized-practice-of-law/)

**ABA Formal Opinion 512 (July 29, 2024).** This guides lawyers using generative AI on competence, confidentiality, communication, and fees. It governs lawyers, not consumer software vendors, but bars cite it in AI discussions. — [ABA Formal Op. 512](https://www.americanbar.org/content/dam/aba/administrative/professional_responsibility/ethics-opinions/aba-formal-opinion-512.pdf) [not re-verified this session]

**California.**
- Bus. & Prof. Code 6125 bars practicing law without State Bar membership. — [Cal. B&P 6125](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=6125) [not re-verified this session]
- California also regulates paid "legal document assistants," who must register and are limited to providing "self-help service" at the customer's direction (B&P 6400 et seq.). — [Cal. B&P 6400](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=6400) [not re-verified this session]
- UPL theories are pursued through UCL 17200 private suits, as in Faridian (see above).

### Inferences
**Safe-side behaviors.** Courts treat these as scrivener or publisher functions:
- Searching for and linking to official forms.
- Hosting or displaying freely licensed templates unchanged.
- Letting the user choose.
- Autofilling only facts the user supplied (name, address, EIN) into fields whose labels already say what goes there.
- Giving general, non-situational information, such as "A W-9 is the IRS form used to provide a TIN to a payer."
- A clear "not a substitute for an attorney" notice (the Texas 81.101(c) and NC 84-2.2 model).
- Letting the user preview the blank template before paying.

**Risky behaviors.** These are the elements in Janson and Reynoso:
- The AI choosing or recommending a document "for your situation."
- Answering "which entity, clause, or option should I pick?"
- Filling fields that require legal judgment, such as choosing an exemption, governing law, an IP-assignment scope, or a liability cap amount.
- Generating, rewriting, or "improving" clause text.
- Summarizing a counterparty's contract with risk opinions.
- Any human review of the user's completed document.
- Marketing like "AI lawyer," "lawyer-quality," or "replaces your attorney."

**Concrete product rules.**
- **Template text is locked.** Users may edit only field values, never clause text. If a template's license allows modification and the user wants to change wording, the user types it themselves and the AI does not assist.
- **No legal-judgment autofill.** Never autofill a field whose answer requires a legal choice. Leave it blank with a neutral label ("Governing law: you choose").
- **Questionnaire stays clerical.** No branching questionnaire that maps answers to legal conclusions. Questions should only collect facts the user already knows.
- **Plan for NC compliance.** If serving NC consumers, either register under 84-2.2 and meet all seven conditions, including attorney review of each template and no disclaimers or liability limits for NC consumers, or geofence and exclude NC. Note that 84-2.2(a)(5) conflicts with standard ToS liability caps. A state-specific ToS carve-out is needed.
- **Prefer a directory-and-filler model.** Link to official sources and use publisher-unchanged templates rather than any "generated document" framing. This narrows exposure under Janson and Reynoso.
- **Stay out of litigation.** Keep excluding litigation documents and anything filed in court. Upsolve shows even simple court-form help is policed.

### Gaps
- The final disposition of Faridian v. DoNotPay could not be confirmed from a primary source; only an unsourced Wikipedia "settlement in principle" was found. Background recollection, not verified this session: a separate competitor suit, MillerKing v. DoNotPay (S.D. Ill. 2023), was dismissed for lack of standing.
- The Texas Ethics Opinion 716 and Florida 2026 AI demand-letter UPL matter are unverified.
- No current text was fetched for California's LDA exemption scope as applied to software publishers.
- Whether any state adopted a legal-specific AI sandbox in 2026 beyond Utah is unconfirmed, and Arizona's ABS program (Rule 31.1) was not re-checked this session.
- It is unconfirmed whether LegalZoom or other providers are currently registered under 84-2.2.

## 2. Does "the AI suggests a form, the user chooses yes/no" stay on the safe side? How should suggestions be worded?

### Takeaway
User choice helps, but it does not by itself cure the problem. In Janson and Reynoso, liability turned on the software applying legal judgment to the user's specific facts, not on who clicked "yes." Suggestions are safest when they are search results matched on the user's own words and topic, shown as a list of options with neutral descriptions. They should never be framed as a recommendation for the user's legal situation.

### Cited Findings
- In Reynoso, the software was UPL because it took user facts and applied legal judgment, for example selecting exemptions, and was marketed as expert. The user still submitted the result, but that did not save it. — [In re Reynoso, 477 F.3d 1117 (9th Cir. 2007)](https://law.justia.com/cases/federal/appellate-courts/F3/477/1117/568640/) [not re-verified this session]
- Janson drew the line between a customer filling in a blank form themselves (permissible) and the company's process turning customer answers into a legal document (potentially UPL). — [Janson v. LegalZoom (W.D. Mo. 2011)](https://www.courtlistener.com/?q=Janson+v.+LegalZoom) [not re-verified this session]
- Upsolve confirms New York treats even narrow, form-specific guidance tailored to a person's circumstances as practicing law. — [Public Citizen CLP blog](https://clpblog.citizen.org/second-circuit-holds-unlawful-practice-law-can-apply-to-debt-collection-advice/)
- The FTC faulted DoNotPay for claiming lawyer-level performance without testing it or using attorneys to check accuracy. Wording that implies expertise creates FTC exposure on top of UPL. — [FTC (node/87474)](https://www.ftc.gov/node/87474)

### Inferences
**Recommended wording (search framing):**
- "Forms matching 'contractor invoice' and 'independent contractor'"
- "People searching for X often look at these official forms"
- "Source: IRS.gov. Official description: ..."
- "You choose which, if any, to use."

**Wording to avoid (advice framing):**
- "You need..."
- "The right document for your business is..."
- "Based on your situation, we recommend..."
- "This will protect you."
- "This is legally sufficient."
- "Compliant," as a claim about the user's own use.

**Other rules:**
- Show several results, not a single "answer," and rank them by text relevance, not by legal fitness.
- Use the publisher's own description of each form, quoted and attributed, rather than AI-written legal characterizations.
- No outcome or protection claims ("protects your IP").
- Add a persistent line next to suggestions: "ShipShape finds and fills documents; it does not give legal advice or tell you which document is right for you. Consider asking a lawyer."
- If a user asks a situational legal question ("Should I use an NDA or MSA?"), refuse and route them to a lawyer directory or bar referral service. Log these refusals.

### Gaps
- No court has ruled specifically on an LLM "suggest-then-confirm" form finder. The analysis above is by analogy.

## 3. Copyright and licensing: federal, state, and court forms; Common Paper and Bonterms; YC SAFE; scraping and linking; trademarks

### Takeaway
Federal government forms (IRS, SBA, and similar) are public domain. State and local forms are mixed, because the government-edicts doctrine covers only works made by officials with lawmaking authority, not every agency form. Common Paper standards are CC BY 4.0, which allows reuse and modification with attribution. YC's SAFE forms are "free to download and use" but carry © Y Combinator and a heavy disclaimer, with no open license. The safest course for YC SAFEs is to link to them or reproduce them unmodified with attribution, and to avoid implying YC endorsement.

### Cited Findings
- 17 U.S.C. 105: "Copyright protection under this title is not available for any work of the United States Government." This covers works prepared by federal officers or employees in their official duties, so federal forms like the IRS W-9 and W-8 are public domain. — [17 U.S.C. 105](https://www.law.cornell.edu/uscode/text/17/105) [not re-verified this session]
- Georgia v. Public.Resource.Org (U.S. 2020) held that, under the government edicts doctrine, officials with authority to make law, such as judges and legislators, cannot be authors of works they create in that capacity. Georgia's annotated code was therefore uncopyrightable. Works by other state employees, such as agency staff forms, are not automatically covered, and state copyright policies vary. — [Georgia v. Public.Resource.Org, 590 U.S. ___ (2020)](https://www.supremecourt.gov/opinions/19pdf/18-1150_7m58.pdf) [not re-verified this session]
- Common Paper standard agreements are "released for free under the Creative Commons CC BY 4.0 License" and are "free to use and modify." The standards page lists no trademark restrictions. — [Common Paper Standards](https://commonpaper.com/standards/)
- YC's documents page says: "All of the SAFE forms are free to download and use." It also says YC "does not assume responsibility for the contents of, or the consequence of using... any version of the SAFE found on our website," and that "before using... any of the SAFE forms, you should consult with a lawyer licensed in the country where your company was formed." The page is marked "© 2026 Y Combinator." No open-content license or trademark statement appears on the page, and its Terms of Use text was not captured. — [YC Documents](https://www.ycombinator.com/documents)
- YC now operates its own free "Send a SAFE" tool for US-incorporated companies. ShipShape would be competing with YC's own channel for SAFEs. — [YC Documents](https://www.ycombinator.com/documents); [runtimewire](https://runtimewire.com/article/y-combinator-opens-free-safe-sending-software)
- Cooley GO publishes generators for YC SAFE documents, including Singapore-modified versions, with its own disclaimers. This shows third-party redistribution or adaptation exists in practice, though it gives no evidence of license terms. — [Cooley GO](https://www.cooleygo.com/generate-y-combinator-safe/)
- CC BY 4.0 requires attribution (creator, copyright notice, license link, and an indication of changes). It also disclaims endorsement: users may not imply the licensor endorses them. — [CC BY 4.0 legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en) [not re-verified this session]

### Inferences
**Product rules:**
- **Federal forms:** Mirror or fill them freely, but link to the canonical .gov URL and check the version or revision date, since stale forms are a real user-harm risk.
- **State and court forms:** Link out by default. Host or fill only after checking that state's copyright notice or terms. Many court forms are explicitly free, but some state agencies assert copyright.
- **CC BY 4.0 templates (Common Paper, and Bonterms, which also states it is CC BY 4.0 but was not re-verified this session):**
  - Display the attribution block, license link, and a "modified/unmodified" statement.
  - Do not use Common Paper or Bonterms names or logos to suggest partnership. Use plain text like "Common Paper Mutual NDA v1.0 (CC BY 4.0)."
  - Keep the version number.
- **YC SAFE:** Safest is linking to ycombinator.com/documents. Second best is reproducing the unmodified form with "Source: Y Combinator. © Y Combinator. ShipShape is not affiliated with or endorsed by Y Combinator." Founders should get written permission from YC before bulk-hosting or modifying it.
- **Trademark use of "Y Combinator":** Use the name only descriptively to identify the document (nominative fair use). No YC logo, and no "YC-approved" language.
- **Scraping and linking:** Linking to public pages is generally lawful. Respect robots.txt and site terms, cache only what licenses permit, and do not bypass access controls. Unauthorized-access law (CFAA) and state contract claims are the main risks for aggressive scraping.

### Gaps
- YC's Terms of Use text was not captured, so it is unknown whether it restricts commercial redistribution of SAFE forms.
- Bonterms' license was not re-verified this session.
- No state-by-state survey of agency-form copyright was done.
- No 2024-2026 scraping case law (for example, post-hiQ developments) was researched in this pass.

## 4. E-signatures: ESIGN and UETA requirements, excluded documents, audit trails

### Takeaway
Under ESIGN and UETA, e-signatures are valid for most business contracts. ShipShape needs to capture four things: intent to sign, consent to do business electronically, attribution to the signer, and an accurate, retrievable record. Consumer signers trigger ESIGN's specific consent-disclosure regime. Wills, codicils, testamentary trusts, family-law matters, court documents, and certain consumer notices are excluded. Because ShipShape already excludes litigation and employment documents, the main remaining exclusions to block are wills and estates, family law, and notarized or recorded instruments that need special handling.

### Cited Findings
- ESIGN, 15 U.S.C. 7001(a): a signature, contract, or record in interstate commerce may not be denied legal effect solely because it is electronic. — [15 U.S.C. 7001](https://www.law.cornell.edu/uscode/text/15/7001) [not re-verified this session]
- ESIGN 7001(c) consumer disclosures apply when a law requires information be provided to a consumer in writing. Before obtaining consent, the provider must disclose:
  - the right to receive paper copies;
  - the right to withdraw consent and its consequences;
  - the scope of the consent;
  - how to update contact information;
  - how to request paper copies and any fees;
  - the hardware and software requirements.

  The consumer must consent electronically "in a manner that reasonably demonstrates" they can access the electronic format. — [15 U.S.C. 7001(c)](https://www.law.cornell.edu/uscode/text/15/7001) [not re-verified this session]
- ESIGN 7001(d) allows electronic record retention if the record accurately reflects the information and remains accessible and reproducible for later reference. — [15 U.S.C. 7001(d)](https://www.law.cornell.edu/uscode/text/15/7001) [not re-verified this session]
- ESIGN 7003 does not apply to:
  - wills, codicils, and testamentary trusts;
  - adoption, divorce, and family law;
  - most UCC articles other than 1-201, 1-107, and Articles 2 and 2A;
  - court orders, notices, and official court documents including pleadings;
  - notices of utility cancellation;
  - notices of default, foreclosure, or eviction on a primary residence;
  - notices of cancellation of health or life insurance;
  - product recall notices;
  - documents required to accompany hazardous materials. — [15 U.S.C. 7003](https://www.law.cornell.edu/uscode/text/15/7003) [not re-verified this session]
- UETA, adopted in 49 states plus DC; New York uses its own ESRA. It applies only where the parties have agreed to conduct the transaction electronically (UETA §5). An electronic signature is attributable to a person if it was "the act of the person," which may be shown by any manner, including the efficacy of a security procedure (§9). UETA §12 covers record retention. — [Uniform Law Commission, UETA](https://www.uniformlaws.org/committees/community-home?CommunityKey=2c04b76c-2b7d-4399-977e-d5876ba7e034) [not re-verified this session]

### Inferences
**Product rules.**
- **Intent:**
  - Use an explicit "Click to sign" or "Adopt and sign" action with the signature next to the signer's name.
  - No pre-checked boxes.
  - Show the full document, or require scroll and review, before signing.
- **Consent:** Show an ESIGN consumer-consent screen with all the 7001(c) disclosures to every signer, including invitees. Treat every signer as a potential consumer, since sole proprietors are often treated as consumers.
- **Attribution:** Capture the following in a tamper-evident audit trail:
  - email verification link (optionally SMS OTP);
  - IP address, user agent, and timestamps for each event (sent, viewed, consented, signed, completed);
  - a document hash before and after signing.

  Seal the final PDF with a certificate (PAdES or a platform digital signature) and give all parties a completion certificate plus a copy.
- **Retention:** Keep records accessible and downloadable for the life of the account plus a grace period after deletion or cancellation. Provide export, and do not hold signed records hostage behind a paywall after cancellation.
- **Blocklist:**
  - wills, trusts, and estate documents;
  - family law;
  - court filings;
  - real-property deeds and anything needing notarization or recording (RON is state-specific);
  - the 7003 notice types.
- **Excluded categories also limit UPL exposure.** Employment contracts and litigation are already excluded. Deeds and estate documents should also be excluded because they carry high UPL and e-sign risk.

### Gaps
- Exact UETA section text and New York ESRA specifics were not fetched this session.
- No research was done on remote online notarization laws or on federal agencies (such as the IRS) that have their own e-signature acceptance rules for specific forms. Some IRS forms accept e-signatures only under IRS-specified procedures.

## 5. FTC and advertising: AI claims enforcement 2024-2026, "AI lawyer" claims, click-to-cancel status, and state auto-renewal laws

### Takeaway
The FTC's direction under Chair Ferguson is pro-AI-innovation: it set aside the Rytr order in Dec. 2025. It still actively polices deceptive capability and accuracy claims, as in DoNotPay (2025) and Workado (2025). "AI lawyer" or lawyer-substitute claims are a proven enforcement trigger. The federal Click-to-Cancel rule was vacated (8th Cir., July 8, 2025), and the FTC reopened rulemaking with an ANPRM in March 2026. ROSCA and state auto-renewal laws, especially California's amended ARL (in effect July 1, 2025), remain fully enforceable and should drive billing design.

### Cited Findings
**Operation AI Comply (Sept. 2024).** This included DoNotPay, Rytr, and several business-opportunity schemes. — [FTC press release, Sept. 25, 2024](https://www.ftc.gov/news-events/news/press-releases/2024/09/ftc-announces-crackdown-deceptive-ai-claims-schemes) [not re-verified this session]

**DoNotPay final order:** $193,000 in relief, consumer notice for 2021-2023 subscribers, and a ban on unsubstantiated claims that the service is a lawyer substitute. The complaint stressed that DoNotPay never tested its outputs against human-lawyer performance and did not use attorneys to check accuracy. — [FTC (node/87474)](https://www.ftc.gov/node/87474); [MLex](https://www.mlex.com/mlex/amp/articles/2296777)

**Rytr order set aside (Dec. 22, 2025, 2-0 vote, Ferguson and Meador).**
- The FTC reopened and vacated its Dec. 2024 consent order, which had banned Rytr's review or testimonial generation service.
- It found the complaint did not adequately plead a Section 5 violation, the remedy was not supported by the record, and the order "unduly burdened AI innovation."
- This was the first action under the July 2025 White House AI Action Plan's directive to review AI-burdening orders. Law firms called it a rare move made without a respondent petition. — [Hogan Lovells](https://www.hoganlovells.com/en/publications/in-rare-move-ftc-sets-aside-rytr-order-for-burdening-ai-innovation-and-failing-to-plead-violations); [Covington Inside Privacy](https://www.insideprivacy.com/united-states/federal-trade-commission/ftc-sets-aside-rytr-final-order-pursuant-to-white-house-ai-action-plan/); [Parker Poe](https://www.parkerpoe.com/news/2025/12/ftc-reopens-and-vacates-prior-order-against-ai)

**Workado.** The FTC's April 2025 complaint alleged Workado's "AI Content Detector" accuracy claims were unsupported: the model was trained only on academic content. The final consent order was approved 3-0 on Aug. 28, 2025. It bars efficacy claims without competent and reliable evidence, requires keeping substantiation, emailing eligible consumers, and filing compliance reports. — [Frankfurt Kurnit](https://advertisinglaw.fkks.com/post/102l358/ftcs-ai-crackdown-continues-workado-ordered-to-drop-unsupported-accuracy-claims); [FTC (node/297697)](https://www.ftc.gov/node/297697); [MyChesCo](https://www.mychesco.com/a/news/national/ftc-finalizes-order-restricting-workados-ai-content-detection-claims/)

**Click-to-Cancel (amended Negative Option Rule).**
- Vacated by the 8th Circuit on July 8, 2025, primarily on procedural grounds: the FTC skipped the required preliminary regulatory analysis.
- Consumer groups petitioned for revival in Nov. 2025.
- The FTC sent a draft ANPRM to OIRA on Jan. 30, 2026, announced it Mar. 11, 2026, and published it in the Federal Register Mar. 13, 2026, with comments due Apr. 13, 2026.
- No NPRM or final rule was found as of this research.
- NYC DCWP proposed a municipal click-to-cancel rule on Apr. 8, 2026.
- Sources: [Sidley](https://www.sidley.com/en/insights/newsupdates/2026/02/us-ftc-signals-renewed-interest-in-click-to-cancel-rulemaking); [NCL](https://nclnet.org/ncl-urges-ftc-to-revive-click-to-cancel-in-new-proceeding/); [Reed Smith](https://www.reedsmith.com/our-insights/blogs/viewpoints/102lwv6/click-to-comment-a-quick-opportunity-to-weigh-in-on-click-to-cancel/)

**ROSCA (15 U.S.C. 8403).** It still applies to online negative-option sales: clear disclosure of material terms before billing, express informed consent before charging, and simple cancellation mechanisms. — [15 U.S.C. 8403](https://www.law.cornell.edu/uscode/text/15/8403) [not re-verified this session]

**California ARL as amended by AB 2863 (signed Sept. 24, 2024, effective July 1, 2025):**
- Express affirmative consent to the auto-renewal terms, including free-to-paid conversions.
- Online cancellation for customers who signed up online, with no obstruction or delay.
- An annual reminder disclosing the product, charge frequency and amount, and how to cancel.
- Consent records kept for at least 3 years, or 1 year after the contract ends, whichever is longer.
- Sources: [Barnes & Thornburg](https://btlaw.com/en/insights/alerts/2025/california-expands-automatic-renewal-law-new-requirements-now-in-effect); [WSGR](https://wsgr.com/en/insights/california-amends-automatic-renewal-law-again.html)
- Summaries call this "one-click" cancellation, which is not the statutory wording. Verify against leginfo text. — [CalMatters bill page](https://calmatters.digitaldemocracy.org/bills/CA_202320240AB2863)

### Inferences
**Marketing rules:**
- Never use "AI lawyer," "robot lawyer," "legal advice," "lawyer-quality," "attorney-approved," "legally binding guaranteed," or "compliant." Exception: a template may be called attorney-reviewed only if that is literally true and documented, as under NC 84-2.2.
- Make only claims you can substantiate with tests, such as "autofills X fields from your profile" or "finds official forms from .gov sources."
- Keep a substantiation file for every performance or accuracy claim, including AI-match accuracy, as Workado shows.
- Any "AI" statement should describe what the system actually does.

**Billing rules (design for the strictest state, which is the CA ARL, plus ROSCA):**
- Before purchase, show clear price, renewal frequency, and cancellation terms next to the pay button.
- Use an unchecked consent checkbox for auto-renewal.
- Send a confirmation email with the terms and cancellation instructions.
- Allow online self-serve cancellation in two clicks or fewer, with no forced retention chat.
- Send an annual reminder, plus advance notice before a free trial converts and before price changes.
- Keep consent logs for 3 or more years.
- Even though the federal rule is vacated, the FTC ANPRM and state laws (CA, NY, MN, and others) make "click-to-cancel" the de facto standard.

### Gaps
- The exact date of the DoNotPay final order (Jan. 16 vs. February 2025) is unconfirmed.
- Other 2025-2026 FTC AI cases (for example, Click Profit or Air AI) were not researched.
- Whether the FTC issued an NPRM after the April 2026 comment period is unknown.
- Other state ARLs (MN, NY, VA, and others) were not individually researched.
- No state AG actions against legal-document apps in 2024-2026 were found in this pass.

## 6. Terms of service: clickwrap vs. browsewrap, arbitration and class waiver, limitation of liability, Cal. Civ. Code 1668, NC 84-2.2 limits

### Takeaway
Use clickwrap or "sign-in wrap" with a conspicuous notice and an affirmative action. Courts reject browsewrap and inconspicuous notices. Arbitration with a class waiver is generally enforceable under the FAA but invites mass-arbitration risk and California carve-outs (McGill public injunctive relief). Liability caps are standard but cannot shield fraud or willful or intentional harm in California (Civ. Code 1668). In North Carolina, 84-2.2 forbids disclaiming warranties or liability and forbids out-of-state venue for document-generation sites that rely on the safe harbor. ToS should be drafted by a lawyer with state-specific carve-outs.

### Cited Findings
- **Specht v. Netscape (2d Cir. 2002).** Terms placed below the download button, with no affirmative assent, were not binding (browsewrap). — [Specht v. Netscape, 306 F.3d 17](https://law.justia.com/cases/federal/appellate-courts/F3/306/17/634384/) [not re-verified this session]
- **Nguyen v. Barnes & Noble (9th Cir. 2014).** A browsewrap with hyperlinked terms and no actual notice was unenforceable. — [Nguyen v. Barnes & Noble, 763 F.3d 1171](https://law.justia.com/cases/federal/appellate-courts/ca9/12-56628/12-56628-2014-08-18.html) [not re-verified this session]
- **Meyer v. Uber (2d Cir. 2017).** A sign-in wrap was enforceable where the notice was reasonably conspicuous and assent was unambiguous. — [Meyer v. Uber, 868 F.3d 66](https://law.justia.com/cases/federal/appellate-courts/ca2/16-2750/16-2750-2017-08-17.html) [not re-verified this session]
- **Berman v. Freedom Financial Network (9th Cir. 2022).** A sign-in wrap is enforceable only if (1) the notice is reasonably conspicuous and (2) the user takes an action, such as clicking a button or checking a box, that unambiguously shows assent. Faint gray small text failed. — [Berman v. Freedom Fin. Network, 30 F.4th 849](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/03/30/20-16900.pdf) [not re-verified this session]
- **Cal. Civ. Code 1668.** Contracts that exempt anyone from responsibility for their own fraud, willful injury, or violation of law, whether willful or negligent, are against public policy. — [Cal. Civ. Code 1668](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1668) [not re-verified this session]
- **McGill v. Citibank (Cal. 2017).** A pre-dispute waiver of the right to seek public injunctive relief in any forum is unenforceable under California law. — [McGill v. Citibank, 2 Cal. 5th 945](https://law.justia.com/cases/california/supreme-court/2017/s224086.html) [not re-verified this session]
- **NC 84-2.2(a)(5)-(6).** Document-generation providers relying on the safe harbor may not disclaim warranties or liability, may not limit consumer damages or remedies, and may not require jurisdiction or venue outside NC. — [N.C.G.S. 84-2.2](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_84/GS_84-2.2.html)

### Inferences
**What an attorney should draft or decide:**
- **Assent flow:** A clickwrap checkbox (unchecked) or button reading "By clicking Create account you agree to Terms and Privacy Policy," with high-contrast links next to the button. Log the version accepted, the timestamp, and the IP. Re-consent on material changes.
- **Core disclaimers:**
  - Not a law firm, no attorney-client relationship, not legal advice, not a substitute for an attorney (Texas 81.101(c) wording).
  - Templates are third-party, and the user chooses and is responsible for use.
  - No guarantee of fitness or enforceability, except where state law such as NC forbids such disclaimers.
- **Liability cap:** Cap at fees paid in the prior 12 months, with carve-outs required by law (CA 1668 for fraud and willful acts; NC 84-2.2 for NC consumers). Add a severability clause.
- **Arbitration:**
  - Use AAA/JAMS consumer rules with a small-claims carve-out, an opt-out window (30 days), and mass-arbitration batching provisions.
  - Carve out public injunctive relief (McGill).
  - For NC consumers, no out-of-state venue.
  - Weigh cost: the attorney should decide whether arbitration is worth the mass-arbitration fee exposure for a small startup.
- **Other clauses:**
  - Acceptable-use clause covering no forgery, no impersonation, and no excluded document types.
  - IP and license-attribution clause for third-party templates.
  - ESIGN consent as a separate record.
  - DMCA agent registration with the Copyright Office for user-uploaded content.
  - A privacy policy, out of scope here.

### Gaps
- No 2024-2026 clickwrap or mass-arbitration case law was gathered (for example, recent 9th Circuit decisions or AAA mass-arbitration rule updates).
- The California Supreme Court's 2024-2025 arbitration rulings were not reviewed.
- Other states with document-provider statutes like NC were not surveyed.

## 7. Entity and insurance: LLC vs. C-corp liability shield, and tech E&O and cyber insurance norms

### Takeaway
Both LLCs and corporations shield owners from the entity's contract and tort debts. Neither protects a founder from their own personal torts or statutory violations, and the shield can be pierced for commingling or undercapitalization. UPL statutes can reach individuals. Insurance (tech E&O with cyber, plus D&O once there are investors) is the practical backstop. No reliable sourced data on startup premiums or limits was gathered in this pass.

### Cited Findings
- Delaware corporations and LLCs provide limited liability. Members of a Delaware LLC are not personally obligated for the LLC's debts, obligations, or liabilities solely by reason of being a member (6 Del. C. §18-303). — [6 Del. C. §18-303](https://delcode.delaware.gov/title6/c018/sc03/index.html) [not re-verified this session]
- NC 84-2.2 requires disclosure of the provider's legal name and physical address, so the entity identity will be public to consumers. — [N.C.G.S. 84-2.2](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_84/GS_84-2.2.html)
- In the Upsolve and Nippon Life matters, UPL enforcement and suits target both organizations and the individuals rendering assistance. New York's UPL statute applies to the nonprofit's volunteers. — [Public Citizen CLP blog](https://clpblog.citizen.org/second-circuit-holds-unlawful-practice-law-can-apply-to-debt-collection-advice/); [Tech Policy Press](https://techpolicy.press/nippon-life-v-openai-and-the-future-of-ai-legal-work)

### Inferences
**Entity:**
- A Delaware C-corp is the norm if raising VC (and is required for QSBS). An LLC is fine for bootstrapping.
- The liability shield is equivalent for this risk profile. Choose based on financing and tax, not liability.
- Keep corporate formalities, a separate bank account, adequate capitalization, and signed contracts in the entity's name.

**Insurance to price before launch:**
- Technology E&O / professional liability, covering claims that the software caused financial loss, for example a wrong form or a failed autofill. Confirm UPL-related and regulatory claims are not excluded. Many policies exclude fines and penalties, and some exclude "legal services."
- Cyber liability (first and third party), because ShipShape stores business profiles, EINs, signed contracts, and possibly SSNs on W-9s.
- Media/IP liability, often bundled with E&O, for template copyright or trademark claims.
- General liability.
- D&O once outside investors or a board exist.
- Use a broker who writes legal-tech or SaaS policies. Disclose the AI features and document categories accurately on the application to avoid rescission.

**Biggest product-driven risk reducers:**
- Avoid holding SSNs. Prefer EINs, or let users fill sensitive fields at signing time without storing them.
- Encrypt documents at rest.
- Have an incident-response plan.

### Gaps
- No sourced premium or limit benchmarks for tech E&O or cyber for seed-stage SaaS were gathered. Brokers and carriers (for example Vouch, Embroker, Coalition) publish such data, but it was not fetched.
- No research was done on whether E&O carriers exclude UPL claims.
- No case law was gathered on piercing the veil or personal liability of founders for UPL by their company.
