# ShipShape AI Drafting and Form-Filling: Speed, Accuracy, Trust, and Human-in-the-Loop Review

Scope: AI architecture (Anthropic Claude API) for speed and quality, and human review UX, for a planned US small-business web app that fills PDF forms from a confirmed business profile and drafts everyday documents and simple agreements from licensed templates. Research date: 2026-10-12. Planning only. Items older than 2024 are flagged as such; they are still the foundational research in their area.

## 1. Latency and speed: streaming, prompt caching, model tiering, structured outputs, parallel tool calls, precomputing, user tolerance

### Takeaway
Most of ShipShape's speed comes from not calling a large model when it isn't needed. Fill AcroForm fields deterministically from the confirmed profile, and use cheap Claude Haiku 5.5 calls for classification and field mapping. Cache the large stable prefix (system prompt, template, form schema). Stream drafting output. Use Opus 5.5 or Sonnet 5.5 only for drafting prose and hard mappings. Anthropic's 2026 pricing makes this tiering very cheap: Haiku 5.5 costs $0.10/$0.50 per million tokens and cache reads cost 0.05x to 0.1x of input. Show progress UI on anything that takes more than about 1 second, and a percent-done indicator past about 10 seconds.

### Cited Findings
**Current models and pricing (as of Oct 2026)**
- Anthropic's live prompt-caching page lists per-million-token prices:
  - **Opus 5.5:** $4 input, $20 output. 5-minute cache write $5, 1-hour cache write $8, cache read $0.20 (0.05x).
  - **Sonnet 5.5:** $2 input, $10 output. Cache read $0.10 (0.05x).
  - **Haiku 5.5, prompts up to 100K tokens:** $0.10 input, $0.50 output. Cache read $0.01 (0.1x).
  - **Haiku 5.5, prompts over 100K tokens:** $0.50 input, $2.50 output.
  - All three have a 512-token minimum cacheable prefix on the Claude API. — [Anthropic, Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- Anthropic's bundled API reference (model table cached 2026-10-06) lists other models:
  - Claude Fable 5.1, the most capable widely released model: $10/$50, always-on thinking.
  - Opus 5: $5/$25.
  - Sonnet 5: $2/$10.
  - Haiku 4.5: $1/$5, 200K context.
  - Opus 5.5, Sonnet 5.5 and Haiku 5.5 all have 1M-token context and up to 128K output tokens. — [Anthropic, Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) (table taken from Anthropic's claude-api skill reference; confirm on the live page before quoting prices externally)
- **Effort and thinking defaults:**
  - Opus 5.5 and Haiku 5.5 default to effort `medium`. Thinking cannot be disabled on Opus 5.5; lowering effort is the speed lever.
  - Sonnet 5.5 defaults to `high`. It can run without thinking via `thinking: {type: "between_tools"}` at effort `high` or below.
  - Anthropic recommends `low` effort for chat, classification and high-volume or latency-sensitive routes.
  - Measure the newest model at lower effort before building a multi-model cascade, because caches are model-scoped and a cascade gives up cache reuse. — [Anthropic, Effort](https://platform.claude.com/docs/en/build-with-claude/effort); [Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- **Fast mode** (research preview, Claude API only) runs Opus 5.5 at up to 2.5x higher output tokens per second for $8/$40 per MTok, twice the standard price. It is not available on Bedrock, Vertex AI or Foundry, or with Batch. — [Anthropic, Models overview / Fast mode](https://platform.claude.com/docs/en/about-claude/models/overview)
- **Thinking display:** the default is "omitted" on current models, so thinking blocks stream with empty text. Anthropic warns that if reasoning is streamed to users, the default looks like a long pause before output. Set `display: "summarized"` (or `"updates"` on Opus 5.5 and Sonnet 5.5) to show progress. — [Anthropic, Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)

**Prompt caching**
- The cache is a prefix match in the order tools → system → messages. Any byte change invalidates everything after it, so stable content goes first and volatile content (timestamps, IDs) goes after the last breakpoint. There are at most 4 breakpoints.
- Write costs: 1.25x for the 5-minute TTL, 2x for the 1-hour TTL. Each cache read refreshes the timer.
- A `max_tokens: 0` pre-warm request writes the cache and returns immediately. Use it to remove the cold-start time-to-first-token on the first user-visible request. — [Anthropic, Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- The live caching page makes no percentage latency claim. It says only that caching "significantly reduces processing time and costs" and improves time-to-first-token for long documents. Older "up to 85% latency reduction" figures that circulate online should not be quoted as current. — [Anthropic, Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Structured outputs and tools**
- Structured outputs (`output_config.format`, or `strict: true` on tools) guarantee schema-valid JSON.
- Forced `tool_choice` (`any` or `tool`) returns a 400 error on Opus 5.5 and Sonnet 5.5. Use `auto` plus `strict: true`, or structured outputs.
- Parallel tool use is on by default. All `tool_result` blocks must go back in a single user message. — [Anthropic, Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- **Key constraint:** citations and structured outputs cannot be used together. Enabling citations on a document while setting `output_config.format` returns a 400 error. — [Anthropic, Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- The Batch API processes requests asynchronously at 50% cost. It suits non-interactive precomputation, such as pre-mapping a library of common government forms to profile fields. — [Anthropic, Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- PDF input limits are 32 MB per request and 600 pages, or 100 pages on 200K-context models. — [Anthropic, PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)

**What latencies users tolerate** (older but canonical research, 1993 with a 2014 update)
- About 0.1 s feels instantaneous. About 1 s keeps flow of thought. About 10 s is the limit for keeping attention. Above about 10 s, show a percent-done indicator and a way to interrupt. For unknown-length work, show running progress, such as the item currently being processed. A spinner is the last resort. — [NN/g, Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- FormGym found that GUI computer-use agents filling forms reached 10.6% to 68.0% accuracy "at high cost and latency". This argues against computer-use or vision-agent approaches for form filling. — [FormGym, arXiv 2506.14079 / EACL 2026](https://arxiv.org/abs/2506.14079v2)

### Inferences
- **Recommended pipeline (form filling):**
  1. Parse the PDF deterministically: AcroForm/XFA field names, types, widget positions, nearby label text.
  2. A Haiku 5.5 call at low effort, with a strict JSON schema, maps form fields to profile keys or `UNKNOWN`. The form-type classifier and profile schema form a cached prefix.
  3. Write values with a PDF library, not the model.
  4. Escalate only unmapped or ambiguous fields to Sonnet 5.5 or Opus 5.5.
  5. For flat or scanned PDFs with no fields, use a vision call plus a field-detection step, which is FormGym's "FieldFinder" lesson.
  This keeps typical fill time within NN/g's roughly 1 to 10 s band with streaming per-field progress ("Mapping field 14 of 32").
- **Drafting:** stream Opus 5.5 or Sonnet 5.5 output section by section into the editor. Cache the template plus system prompt and pre-warm when the user opens a template, so time-to-first-token is short by the time they finish the intake questions.
- **Precompute** mappings for popular forms (IRS W-9, state registrations, etc.) offline with the Batch API at 50% cost. Store them as versioned mapping files so most fills need no LLM call at all.
- **Citations vs structured output:** because they are mutually exclusive, use two calls where needed. A structured-output call returns the field values, then a citations-enabled call grounds them, or ground against the profile with your own ID references (see Q2).
- **Cost check (inference):** a 3,000-token cached prefix plus a 500-token Haiku 5.5 mapping response costs well under a tenth of a cent per form at listed prices, so model cost is not the constraint; latency and accuracy are.

### Gaps
- Anthropic does not publish time-to-first-token or tokens-per-second figures for Haiku 5.5, Sonnet 5.5 or Opus 5.5. ShipShape must benchmark these itself.
- I found no recent (2024 to 2026) peer-reviewed study of user latency tolerance specific to generative AI drafting. NN/g's limits date from 1993 and 2014.

## 2. Accuracy: eval sets, confidence calibration, grounding and citations, "flag don't guess", hallucination measurement, FormGym, vendor practice

### Takeaway
Form filling is mostly a localization and mapping problem, not a knowledge problem. FormGym shows that plain vision-language agents score under 1% and that a field-locating tool lifts accuracy sharply. Legal-domain RAG tools still hallucinate 17% to 33% of the time on research queries. ShipShape should therefore:
- Build its own labeled eval set.
- Make "UNKNOWN / needs your input" a first-class output.
- Ground every filled value in a profile field ID or a cited source passage.
- Treat model confidence scores as routing hints, never as guarantees.

### Cited Findings
**FormGym (Toles, Song, Singh, Yu; arXiv June 2025; EACL 2026)**
- The benchmark has 432 fields across 55 documents and 3 tasks, needing 236 user-profile features.
- Baseline vision-language agents got under 1% accuracy in most cases, mainly from poor localization. GUI agents got 10.6% to 68.0%.
- Adding the authors' FieldFinder tool raised every model in all six conditions, with a maximum jump from 2% to 56%.
- **Caveat:** FormGym treats forms as images, not as PDFs with an AcroForm layer, so it understates what deterministic PDF parsing can achieve. — [arXiv 2506.14079](https://arxiv.org/abs/2506.14079v2); [ACL Anthology 2026.eacl-long.175](https://aclanthology.org/2026.eacl-long.175)

**Hallucination in legal AI (2024, older but the main preregistered study)**
- Stanford RegLab/HAI's "Hallucination-Free?" evaluated more than 200 queries:
  - Lexis+ AI and Ask Practical Law AI were wrong more than 17% of the time.
  - Westlaw AI-Assisted Research was wrong 33% (preprint) or 34% (HAI summary) of the time. The two sources differ.
- Retrieval-augmented generation (RAG) reduced but did not eliminate hallucination compared with GPT-4. The authors call vendor "hallucination-free" claims overstated. — [Stanford HAI](https://hai.stanford.edu/news/ai-trial-legal-models-hallucinate-1-out-6-or-more-benchmarking-queries)

**Anthropic Citations API**
- Responses carry `page_location` (start and end page) for PDFs.
- Citations "are guaranteed to contain valid pointers to the provided documents".
- In Anthropic's evaluations the feature is "significantly more likely to cite the most relevant quotes" than prompt-based quoting.
- `cited_text` does not count toward output tokens.
- **Limits:**
  - Only text citations are supported.
  - Scanned PDFs without extractable text cannot be cited.
  - The feature cannot be combined with structured outputs.
  - It is supported on all active models. — [Anthropic, Citations](https://platform.claude.com/docs/en/build-with-claude/citations)

**Confidence scores in document AI vendors (no confirmed legal-vendor UI found)**
- Box AI returns a 0-to-1 confidence that is not stored, so the integrator must capture it. Box says the score "is not a guarantee" and critical data should be validated regardless. — [Box Developer, Confidence level](https://developer.box.com/guides/metadata/confidence-level)
- Docsumo marks lower-confidence values with an orange dot telling the user to recheck. — [Docsumo](https://support.docsumo.com/docs/ai-extraction-reasoning-confidence-scores)
- Landing AI routes low-confidence fields to human reviewers before data goes downstream. — [Landing AI](https://docs.landing.ai/ade/ade-extract-confidence-score)
- Docusign IAM: AI extracts agreement fields such as renewal dates and obligations, and custom extractions are defined in a JSON manifest and tested in a sandbox. I could not confirm whether it shows per-field confidence. — [Docusign IAM blog](https://www.docusign.com/blog/developers/agreement-data-actionable-insights-docusign-iam)

**Legal-tech vendors**
- Spellbook works inside Word with redlines and risk flags, and checks clauses against customer playbooks. Its in-house page claims insights "with citations". Reviewers report occasional hallucinations that need careful attorney verification. — [Spellbook in-house](https://www.spellbook.legal/in-house-legal); [Sacra on Spellbook](https://sacra.com/c/spellbook/)
- Hebbia Matrix is a spreadsheet-style, cell-per-document-per-question extraction grid aimed at diligence. A Spellbook-authored comparison says it lacks redlining and playbooks; that source is biased. — [Spellbook brief](https://www.spellbook.legal/briefs/hebbia-vs-harvey)
- Sources conflict on Harvey's redlining: Sacra says Harvey has moved into Word-native contract workflows. — [Sacra](https://sacra.com/c/spellbook/)

### Inferences
- **Eval set design:** build a golden set of about 50 to 150 real US small-business forms across federal, state and county sources. Mix fillable AcroForm PDFs with flat or scanned ones. Pair them with synthetic business profiles that include deliberate gaps and conflicts (e.g. a missing EIN, or two addresses). Score these metrics separately:
  - Field localization.
  - Mapping correctness.
  - Value correctness.
  - "Correctly abstained" rate: did the model say UNKNOWN when the profile lacked data?
  - "Hallucinated fill" rate: did it invent a value?

  The hallucinated-fill rate is the headline safety metric and should target about 0. For drafts, use rubric grading plus a "locked text altered" check (see Q5).
- **"Flag don't guess":** the schema should force each field into one of three states:
  - `{value, source_profile_key}`
  - `{UNKNOWN, reason}`
  - `{NEEDS_CONFIRMATION, candidate, reason}`

  Reject any value whose source key does not exist in the confirmed profile. This makes grounding checkable by code rather than by the model.
- **Confidence display:** given Box's caveat and the automation-bias evidence in Q3, use confidence to sort and route ("Review these 3 fields first"), not to tell users which fields they may skip. Display categories (Matched from profile / Inferred / Missing), not raw percentages.
- **Legal-domain hallucination:** the 17% to 33% rates for professional tools strongly support ShipShape's choice to use locked licensed templates with narrow AI slots rather than free-form legal drafting.

### Gaps
- I could not find official documentation of how Harvey, Ironclad or Docusign IAM display per-clause confidence or source-linked citations in their review UIs. This needs vendor demos or hands-on trials.
- I found no published 2025 or 2026 benchmark specifically for AcroForm-native PDF filling by LLMs. FormGym is image-based.
- I found no standard method for calibrating Claude's self-reported confidence. ShipShape would need to measure calibration on its own eval set, e.g. reliability curves of stated confidence against actual correctness.

## 3. Human-in-the-loop review patterns and the evidence on forced review vs rubber-stamping

### Takeaway
Automation-bias research shows reviewers over-accept wrong AI output. Expertise, training and instructions do not reliably prevent this; accountability and confidence information help. Making users think before accepting reduces overreliance, but users dislike it. ShipShape's repeated-review flow should therefore be built around active verification of high-risk items, not repeated passive "I reviewed this" clicks, which invite rubber-stamping.

### Cited Findings
**Goddard, Roudsari and Wyatt** (JAMIA 2011 online / 2012 print; older; 74 studies)
- Wrong advice turned correct decisions into incorrect ones in 6% to 11% of cases in prospective clinical studies.
- Pooled risk ratio 1.26 (95% CI 1.11 to 1.44): users given wrong advice were 26% (relative) more likely to decide incorrectly.
- Overall performance still usually improved with decision support.
- Mediators: trust miscalibrated against reliability, workload, task complexity, time pressure.
- Mitigators: emphasizing user accountability, training, advice placement, showing updated confidence levels with the advice, and giving information rather than direct recommendations.
- An aviation study cited in the review found a 55% omission-error rate. — [Goddard et al., PMC3240751](https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751)

**Parasuraman and Manzey** (Human Factors 2010; older)
- Complacency and automation bias are overlapping, attention-driven phenomena.
- Bias occurs in both novices and experts and "cannot be prevented by training or instructions".
- Complacency appears under multitask load when automation seems reliable. — [Parasuraman & Manzey 2010 (TU Berlin repository)](https://depositonce.tu-berlin.de/items/0c787d91-6021-480b-a333-009e0d1d0092/full)

**Buçinca, Malaya and Gajos** (CSCW 2021, N=199)
- "Cognitive forcing functions" significantly reduced overreliance compared with simple explainable-AI displays. Examples: deciding before seeing the AI answer, or choosing when to reveal it.
- Users rated the most effective designs least favorably.
- Benefits were larger for people high in Need for Cognition. — [Harvard, Buçinca et al. 2021](https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca2021trust.shtml)
- A 2024 follow-up on human-AI content-grounded data generation studied cognitive forcing functions together with hallucinations. — [arXiv 2409.08937](https://arxiv.org/pdf/2409.08937)

**Vendor patterns**
- Robin AI pairs AI with human reviewers who back the output, a maker-checker model outside the tool. — [Sacra](https://sacra.com/c/spellbook/) (secondary source)

### Inferences
- **Field-by-field review (forms):**
  - Group fields by risk. High: legal name, EIN/SSN, signatures, dates, amounts, checkboxes asserting facts. Low: phone formatting.
  - Low-risk fields can be bulk-confirmed. High-risk fields need individual confirmation, each showing the source ("from Profile → Legal name, confirmed 2026-09-02").
  - Missing or inferred fields block completion until the user acts.
  - Show the value in place on a rendered PDF preview, not only in a side list.
- **Template drafts:**
  - Use a three-way visual distinction: locked licensed template text (neutral), user-entered facts (one color), AI-written text (highlighted, labelled "AI-written").
  - Offer a diff view against the original template and against the previous reviewed version.
  - Each AI-written span gets Accept / Edit / Replace with template default / Remove.
- **Completion percentage:** compute it from concrete items (fields confirmed, AI spans accepted or edited, warnings acknowledged), not time spent. The NN/g guidance in Q1 supports a visible percent-done indicator.
- **Avoid rubber-stamping:** to keep repeated review meaningful, use cognitive forcing on a few highest-risk items. Examples:
  - Ask the user to type or select the effective date or party name rather than just tick it.
  - Show each AI-written span collapsed so the user must open it.
  - Ask a quick question such as "Which party pays for X?" before revealing the AI-filled answer.

  Keep these few, given Buçinca's finding that effective forcing is disliked.
- **"Review again" invalidation:** when the profile, template version or any upstream answer changes, reset to "unreviewed" only the dependent fields and spans. Track this with a dependency graph so the completion percentage drops visibly, rather than forcing a full re-review that breeds fatigue.
- **Two-person review:** offer an optional maker-checker mode where a second team member, or the user's attorney via a share link, must approve before finalizing. Goddard's accountability mitigator supports naming the approver.
- **Audit log:** record each AI generation (model ID, prompt and template version, timestamp), each user edit or accept, each acknowledgment, and the finalize event. Make it exportable. This also supports the accountability mitigation.

### Gaps
- I found no study specifically measuring whether repeated mandatory review passes on AI-drafted contracts or forms reduce errors or cause habituation.
- The Goddard and Parasuraman evidence comes from clinical and aviation settings and is pre-2015.
- I did not retrieve Bansal et al. (2021) or other work on whether explanations increase blind acceptance, so it is not cited here.

## 4. Warning and acknowledgment design for AI-generated content: labelling, C2PA, EU AI Act Art. 50, California SB 942, watermarks, friction

### Takeaway
For a US text-only product, there is no current law mandating machine-readable marking of AI-written contract text:
- California SB 942 covers image, video and audio from large providers.
- EU Art. 50 applies only if ShipShape is offered in the EU.

So labelling is mainly a trust and liability design choice:
- Visibly highlight AI text in-app.
- Put a removable "DRAFT, AI-assisted, not legal advice" watermark on unfinalized exports.
- Log a signed acknowledgment.
- Keep friction targeted at high-risk moments rather than spread everywhere.

### Cited Findings
**California SB 942 (AI Transparency Act)**
- Signed September 2024 with a January 1, 2026 start. AB 853 (Ch. 674, Stats. 2025, chaptered October 13, 2025) delayed the operative date to August 2, 2026.
- It applies to "covered providers": generative AI systems with more than 1 million monthly users, publicly accessible in California.
- Its disclosure and detection-tool duties cover image, video and audio content, not text.
- Penalty: $5,000 per violation, enforced by the AG or local authorities, with no private right of action.
- AB 853 adds later obligations for large platforms (January 1, 2027) and capture devices (January 1, 2028).
- These details come mostly from secondary compliance sources; verify against statute text. — [CalMatters Digital Democracy, AB 853](https://calmatters.digitaldemocracy.org/bills/ca_202520260ab853); [National Law Review](https://natlawreview.com/article/californias-ongoing-ai-regulation-key-deadlines-arriving-2026-and-beyond); [SecurePrivacy](https://secureprivacy.ai/blog/california-ai-transparency-law)

**EU AI Act Article 50**
- Art. 50(1) (disclosure when people interact with an AI system) applied from August 2, 2026.
- The Digital Omnibus (trilogue deal May 7, 2026) moves the Art. 50(2) machine-readable marking duty to December 2, 2026, but only for systems already on the market before August 2, 2026. Systems placed on the market on or after that date must comply immediately.
- In June 2026 the Commission published a voluntary Code of Practice on Transparency of AI-Generated Content covering Art. 50(2) marking and Art. 50(4) deployer labelling.
- Sources conflict on whether the omnibus is formally published in the Official Journal; check EUR-Lex. — [Bristows](https://inquisitiveminds.bristows.com/post/102nfaz/the-european-commissions-code-of-practice-on-transparency-of-ai-generated-conten); [Dastra](https://www.dastra.eu/en/blog/ai-act-transparency-rules-what-changes-august-2-2026/60164/_payload.json); [Jones Day on draft Code (Jan 2026)](https://jonesday.com/en/insights/2026/01/european-commission-publishes-draft-code-of-practice-on-ai-labelling-and-transparency)

**Automation-bias guidance relevant to warnings**
- Showing confidence information with advice and emphasizing user accountability reduce automation bias. — [Goddard et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC3240751)
- Training and instructions alone do not prevent it, so a one-time warning is unlikely to be enough. — [Parasuraman & Manzey](https://depositonce.tu-berlin.de/items/0c787d91-6021-480b-a333-009e0d1d0092/full)

### Inferences
- **Regulatory position:** ShipShape is US-only and text-based, so SB 942's content-provenance duties likely do not apply. Even if it reached 1M users, text is out of scope. EU Art. 50 matters only if EU users are targeted; geo-limit at launch and revisit.
- **Labelling as best practice:**
  - In-app: persistent highlight plus an "AI-written" chip on each AI span.
  - On export before finalization: a diagonal "DRAFT, NOT FINAL, AI-ASSISTED" watermark and a footer.
  - On finalized export: a removable plain-language footer, e.g. "Prepared with ShipShape software; portions drafted with AI and reviewed by [user] on [date]. Not legal advice." Whether to keep this footer is a product and legal-counsel decision.
  - Optionally embed C2PA or XMP metadata noting AI assistance. This is low-cost future-proofing, not currently required for text.
- **Acknowledgment design:** a signed acknowledgment (typed name plus checkbox, logged with timestamp, IP and document hash) should come at two points:
  1. Before the first AI draft: ShipShape is not a law firm, does not give legal advice, and the user is responsible.
  2. At finalization: a short list of what the user specifically confirmed, e.g. "I reviewed 4 AI-written sections and 3 inferred fields."

  Avoid a modal on every screen. Habituation research (inferred from the automation-bias findings above) suggests repeated identical warnings get ignored. Vary the warning by risk and make it specific to the document.
- **Unauthorized practice of law (UPL) disclaimers:** state-specific UPL rules affect disclaimer wording. That topic belongs to the legal researcher and is not covered here.

### Gaps
- I could not access the primary text of SB 942 as amended by AB 853, so the exact latent-disclosure technical requirements are unconfirmed.
- I found no empirical research comparing acknowledgment designs (checkbox vs typed name vs quiz) for AI-drafted legal documents.
- I did not verify whether the C2PA spec has a mature standard for marking AI-assisted text in PDFs in 2026.
- Art. 50(4)'s text-publication duty and its human-review / editorial-responsibility exemption are recalled from the Act's text, not verified in this session. Confirm them before relying on them.

## 5. Safety guardrails: refusing situational legal questions, prompt injection from uploaded PDFs, protecting locked template text, PII minimization

### Takeaway
Prompt injection is OWASP's #1 LLM risk for 2025, and documents are a named indirect-injection vector. No model-side fix is complete. ShipShape must therefore:
- Treat every uploaded PDF as untrusted data.
- Give the model no dangerous capabilities (no tools that send, sign, browse or touch other users' data).
- Enforce template locks and legal-advice refusals in code and schema, not only in prompts.

### Cited Findings
**OWASP LLM01:2025 Prompt Injection** (secondary summaries; OWASP's own page was not retrieved)
- Prompt injection stays #1. The 2025 list formally separates direct and indirect injection; indirect injection plants instructions in documents, emails, web pages and similar data. — [Wiz, OWASP LLM Top 10 guide](https://www.wiz.io/academy/ai-security/owasp-llm-top-10)
- Recommended controls:
  - Privilege separation between app instructions and user content.
  - Clear delimiting or sanitizing of retrieved content.
  - Output validation.
  - Monitoring.
  - Enforcing controls outside the model.
- Fool-proof prevention does not exist, so design for containment. — [FutureAGI](https://futureagi.com/blog/owasp-llm-top-10-2025-risks-mitigations-2026/); [Introl](https://introl.com/blog/llm-security-prompt-injection-defense-production-guide-2025)
- Anthropic's documentation describes mid-conversation `role: "system"` messages (Opus 5.5, Sonnet 5.5, Haiku 5.5) as "the prompt-injection-safe operator channel" for adding operator instructions after user content. — [Anthropic, Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Refusals:** on Opus 5.5 and Sonnet 5.5, safety classifiers can return HTTP 200 with `stop_reason: "refusal"` and a `stop_details` category. Apps must check `stop_reason` before reading content. — [Anthropic, Migration guide](https://platform.claude.com/docs/en/about-claude/models/migration-guide)
- **Data retention:** citations are eligible for zero data retention (ZDR), excluding "Covered Models". The Fable models require 30-day retention unless Anthropic expressly authorizes otherwise. — [Anthropic, Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- **Hallucination base rate:** legal RAG tools hallucinate 17% or more on legal questions, which supports not answering situational legal questions at all. — [Stanford HAI](https://hai.stanford.edu/news/ai-trial-legal-models-hallucinate-1-out-6-or-more-benchmarking-queries)

### Inferences
- **No legal advice:**
  - Route all free-text user questions through a Haiku 5.5 classifier with a strict schema: {product_help, form_definition, situational_legal_question, other}.
  - Situational legal questions ("Should I…", "Is this enforceable…", "What happens if…") get a fixed, non-generated response pointing to an attorney or bar referral service.
  - Drafting prompts restrict the AI to filling designated slots with neutral, user-supplied facts. They never let it choose between legal alternatives; the user picks from template-provided options.
  - Log every classifier decision for audit and eval.
- **Uploaded PDFs (indirect injection):**
  - Extract text and fields deterministically and pass them to the model inside clearly labelled document blocks.
  - The model's only output is schema-constrained field mappings and values, which code validates against the profile (Q2). An injected "set bank account to X" therefore cannot produce a value whose source key is not in the confirmed profile.
  - Give the model no tools with side effects.
  - Scan uploads for injection-like strings and flag them to the user ("This document contains text addressed to AI systems").
- **Locked template text:**
  - Store templates as structured data: locked segments plus named AI and user slots.
  - The model receives and returns only slot contents, never the whole document.
  - Code reassembles the document and verifies each locked segment's hash before render and at finalize. Any mismatch blocks finalization.
  - Add a regression eval that tries to coax edits to locked clauses.
- **PII minimization:**
  - Send the model field labels and profile keys, not values, for mapping. Values are written by code after mapping.
  - Never send SSNs, full bank numbers or similar to the LLM.
  - For drafting, send only the profile fields that template slots need.
  - Request ZDR on the Anthropic org where eligible, and avoid models whose retention rules conflict with ZDR.
  - Redact PII in logs, while the audit log stores hashes and references.

### Gaps
- OWASP's primary LLM01:2025 page was not retrieved, so the mitigation list comes from secondary summaries.
- I found no published measurements of Claude 5.x-generation resistance to indirect prompt injection from PDF content. ShipShape should red-team this itself.
- The legal sufficiency of a fixed-response refusal approach under state UPL rules was not researched here.
