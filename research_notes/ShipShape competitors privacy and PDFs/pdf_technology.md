# PDF Technology for ShipShape: filling, editing, signing, field detection, generation (as of Oct 11, 2026)

Method note: GitHub API access was blocked from this research environment, so star counts and issue stats are missing. Release recency was taken from the npm registry (`registry.npmjs.org/<pkg>`, queried 2026-10-11). The IRS W-9 structure findings come from downloading https://www.irs.gov/pub/irs-pdf/fw9.pdf on 2026-10-11, inspecting it with pypdf, and filling/flattening it with pdf-lib 1.17.1 in a local Node 22 test. These are first-hand observations; the source link given is the file that was tested.

## Open-source PDF libraries and correct AcroForm filling (pdf-lib, PDF.js, pdfme, react-pdf, PDFium-wasm, MuPDF.js, XFA, checkboxes/radio/comb)

### Takeaway
pdf-lib (MIT) remains the de facto JS AcroForm filler, but upstream has had no npm release since Nov 2021. Actively maintained forks exist (@cantoo/pdf-lib 2.11.1, Sep 2026; @pdfme/pdf-lib). The current IRS W-9 (Rev. March 2024) is a **hybrid AcroForm + XFA form with Adobe Reader-extension usage rights (UR3)**. pdf-lib can fill it correctly, including the comb SSN/EIN boxes and the checkboxes, as long as you (a) drop the XFA, (b) remove /Perms, and (c) embed a Unicode TTF for non-WinAnsi text. Use PDF.js (Apache-2.0, very active, v6.x in 2026) for rendering and as the in-browser editing overlay. MuPDF.js is the most capable WASM engine, but it is AGPL. PDFium-wasm wrappers (MIT) are a permissive alternative.

### Cited Findings
**Maintenance and releases (npm registry, checked 2026-10-11)**
- `pdf-lib` latest is 1.17.1, published 2021-11-06, MIT. No release in nearly 5 years. — [npm registry: pdf-lib](https://registry.npmjs.org/pdf-lib)
- `@cantoo/pdf-lib` latest is 2.11.1, published 2026-09-15, MIT. — [npm registry: @cantoo/pdf-lib](https://registry.npmjs.org/@cantoo/pdf-lib)
- The Cantoo fork's README says it "adds the support for svg… Until pdf-lib project gets a better maintainance, we will maintain this project as long as we need it but cannot guarantee the support for issues too far from our own roadmap." — [@cantoo/pdf-lib README (unpkg)](https://unpkg.com/@cantoo/pdf-lib@2.7.1/README.md)
- Stirling-PDF replaced pdf-lib with @cantoo/pdf-lib, describing it as a "maintained fork with better TypeScript support". — [Stirling-PDF commit mirror](https://git.laurivan.com/Mirrors/Stirling-PDF/src/commit/0a1d2effdced141494a27691ab821391b4427086)
- pdfme maintains its own fork, `@pdfme/pdf-lib`, which incorporated Cantoo's SVG code (Dec 2023) and added a rounded-rect option in Mar 2025. — [@pdfme/pdf-lib README](https://cdn.jsdelivr.net/npm/@pdfme/pdf-lib@6.1.2/README.md)
- `pdfjs-dist` latest is 6.4.299, published 2026-10-03, Apache-2.0. `@pdfme/generator` 6.2.4 (2026-10-06, MIT). `@react-pdf/renderer` 4.9.0 (2026-08-27, MIT). `react-pdf` (the wojtekmaj viewer wrapper around PDF.js) 11.0.0 (2026-09-10, MIT). `mupdf` (MuPDF.js) 1.28.1 (2026-09-06, AGPL-3.0-or-later). `@embedpdf/pdfium` 2.15.1 (2026-09-16, MIT). `@hyzyla/pdfium` 3.0.0 (2026-10-10, MIT). — [npm registry](https://registry.npmjs.org/pdfjs-dist), [mupdf](https://registry.npmjs.org/mupdf), [@embedpdf/pdfium](https://registry.npmjs.org/@embedpdf/pdfium), [@pdfme/generator](https://registry.npmjs.org/@pdfme/generator), [@react-pdf/renderer](https://registry.npmjs.org/@react-pdf/renderer), [react-pdf](https://registry.npmjs.org/react-pdf), [@hyzyla/pdfium](https://registry.npmjs.org/@hyzyla/pdfium)

**pdf-lib AcroForm capabilities and limits**
- pdf-lib supports text, checkbox, radio group, dropdown, option list, and button fields (create and read). Signature fields can be retrieved via `getSignature` but not created or signed. — [pdf-lib PDFForm docs](https://pdf-lib.js.org/docs/api/classes/pdfform)
- "pdf-lib does not support creation, modification, or reading of XFA fields." `deleteXFA()` "will force readers to fallback to standard fields". — [pdf-lib PDFForm docs](https://pdf-lib.js.org/docs/api/classes/pdfform)
- `flatten()` removes all fields and their widget annotations. It defaults to `updateFieldAppearances: true`, and afterwards "fields can no longer be accessed or edited." — [pdf-lib PDFForm docs](https://pdf-lib.js.org/docs/api/classes/pdfform)
- Appearance streams are generated only for widgets that lack them, or when values change. `save()` auto-updates appearances if `getForm()` was called. The default font is Helvetica (WinAnsi), and "encoding errors will be thrown if any fields contain text with characters outside the WinAnsi character set". Passing an embedded custom font fixes this. — [pdf-lib PDFForm docs](https://pdf-lib.js.org/docs/api/classes/pdfform)

**IRS W-9 (current fw9.pdf) structure, first-hand inspection 2026-10-11**
- The document is titled "Form W-9 (Rev. March 2024)". Creator/Producer "Designer 6.5" (Adobe LiveCycle Designer), PDF 1.7, 6 pages. Keywords "Fillable". — [IRS fw9.pdf](https://www.irs.gov/pub/irs-pdf/fw9.pdf)
- The AcroForm dictionary contains **/XFA** alongside /Fields, so it is a static-XFA/AcroForm hybrid, not pure XFA (no /NeedsRendering). The catalog has **/Perms /UR3** (Reader Extensions usage rights), plus /StructTreeRoot and /MarkInfo (tagged) and /Lang. — [IRS fw9.pdf](https://www.irs.gov/pub/irs-pdf/fw9.pdf)
- There are 23 terminal fields (15 /Tx, 8 /Btn) with XFA-style names such as `topmostSubform[0].Page1[0].f1_01[0]`. The tax-classification checkboxes `c1_1[0..6]` share a name with distinct on-state export values /1 to /7, so they behave like a radio group built from checkboxes. The SSN/EIN fields `f1_11`–`f1_15` have flags 25165824 (Comb + DoNotScroll), and pdf-lib reports `isCombed()=true` with MaxLen=3 for the first SSN segment. — [IRS fw9.pdf](https://www.irs.gov/pub/irs-pdf/fw9.pdf)
- Local test: pdf-lib 1.17.1 loaded the form and logged "Removing XFA form data as pdf-lib does not support reading or writing XFA". It filled name and checkbox, filled comb SSN segments (rendered per-cell as "1 2 3 – 4 5 – 6 7 8 9" in pdftotext -layout), and flattened to 0 remaining fields (output ~151 KB vs 141 KB input). Filling "Zoë Łukasz" with the default font threw `WinAnsi cannot encode "Ł"` at flatten/appearance time. It succeeded after `registerFontkit(@pdf-lib/fontkit)` + `embedFont(DejaVuSans.ttf, {subset:true})` + `field.updateAppearances(font)`. With @pdf-lib/fontkit, @cantoo/pdf-lib 2.11.1's custom-font subset embedding threw a TypeError; it likely needs its own fontkit variant, which was not investigated further. — test performed on [IRS fw9.pdf](https://www.irs.gov/pub/irs-pdf/fw9.pdf)

**PDF.js (rendering + editor)**
- PDF.js 6.0 (May 30, 2026) is a major release with API changes. v6.1.200 (June 27, 2026) lists improvements to annotation rendering, annotation editing, font conversion, merging files, and the viewer. A release lists "Digital Signature and Certificate verification" (#21247). v6.4.299 adds typed signatures for GeckoView. — [mozilla/pdf.js releases](https://github.com/mozilla/pdf.js/releases); [LibHunt pdf.js changelog](https://js.libhunt.com/pdf-js-changelog)
- pdfjs-dist 5.1.91 (2025) included annotation-editor improvements, including signature editor items. — [newreleases.io pdfjs-dist 5.1.91](https://newreleases.io/project/npm/pdfjs-dist/release/5.1.91)
- In Firefox's PDF viewer (built on PDF.js), signatures are added via Type/Draw/Image. They are "simple annotations, not legally binding e-signatures" and include no verification. Users can fill existing form fields and add free text. Text/signature/drawing editing has been available since Firefox 106 (Oct 2022). — [Mozilla support](https://support.mozilla.org/hi-IN/kb/pdf); [PCWorld, Oct 2022](https://www.pcworld.com/article/1356707/firefox-106-adds-a-nifty-pdf-editing-feature.html)
- The pdfjs-dist AnnotationEditorLayer exposes freetext, highlight, stamp, and ink editors. A Nutrient tutorial treats pdfjs-dist 4.x+ as the baseline for embedding these editors in an app. No stable, documented public API for embedding the signature editor was found. — [Nutrient blog: PDF.js annotation editor layer](https://www.nutrient.io/blog/pdfjs-annotation-editor-layer/); [Tessl pdfjs-dist editor API](https://tessl.io/registry/tessl/npm-pdfjs-dist/files/docs/editor-api.md)

**MuPDF.js licensing**
- MuPDF.js is dual-licensed under AGPL-3.0-or-later or an Artifex commercial license (quote-based). Artifex material says that without AGPL compliance or a commercial license you cannot use it in software you distribute "(or make available as 'Software as a service')". The commercial license removes the requirements to license the whole app under AGPL and give away source. — [npm: mupdf](https://npmjs.com/package/mupdf); [MuPDF Explored: Licensing](https://ghostscript.com/~robin/mupdf_explored/mupdf_exploredse159.html); [MuPDF docs license](https://mupdf.readthedocs.io/en/1.27.0/license.html)

### Inferences
- The correct W-9 fill recipe in JS is: load → `form.deleteXFA()` → delete catalog `/Perms` (otherwise Acrobat may warn that the document was changed after usage rights were applied; this is standard knowledge about UR3, not verified in Acrobat here) → set values (for checkbox groups, select the widget whose on-state is the desired export value) → embed a Unicode TTF subset and call `updateAppearances(font)` → `flatten()` for the "clean download" → save. Keep an unflattened copy if the user may want to re-edit.
- Because pdf-lib upstream is frozen, pin a fork (Cantoo or pdfme's) or vendor pdf-lib. Test font embedding per fork. In this test, upstream 1.17.1 + @pdf-lib/fontkit worked and the Cantoo fork did not with that fontkit.
- For in-browser editing UX, a practical open-source stack is PDF.js (or `react-pdf`) for rendering, a custom React overlay of positioned inputs mapped to AcroForm widget rects, and pdf-lib to write values and appearances. This is more custom work than a commercial SDK, but it keeps everything MIT/Apache.
- PDFium-wasm (`@embedpdf/pdfium`, MIT, Google's PDFium engine) is the permissive path to Acrobat-grade rendering/form-filling and flattening if PDF.js + pdf-lib output quality proves insufficient. MuPDF.js is excellent technically, but under AGPL §13 a closed-source SaaS would need a commercial license.
- True dynamic XFA forms (with /NeedsRendering) cannot be handled by pdf-lib, PDF.js, or PDFium. They would need Apryse/Nutrient/Foxit or a server-side converter. The W-9 is not dynamic XFA, so this matters mainly for some state forms.

### Gaps
- GitHub stars, open-issue counts, and last-commit dates for pdf-lib, pdf.js, pdfme, MuPDF.js, and others could not be retrieved (GitHub API blocked from this environment).
- qpdf, Ghostscript, and Apache PDFBox were not researched in detail in this pass. They are general knowledge: qpdf (Apache-2.0) for linearize/repair/strip, Ghostscript (AGPL/commercial, same Artifex licensing issue) for re-distillation, PDFBox (Apache-2.0, Java) as a mature server-side AcroForm filler. None of this is verified with 2026 sources.
- Acrobat's actual behavior on the pdf-lib-filled W-9 (usage-rights warning, appearance fidelity) was not verified, only text extraction via poppler.
- pdfme's form-filling vs template-designer capabilities were not researched in depth. pdfme is primarily a template-based PDF generator/designer, not an existing-AcroForm filler.

## Commercial PDF SDKs (Apryse, Nutrient, Syncfusion, Foxit, ComPDFKit, Adobe)

### Takeaway
All major web SDKs are actively shipping (npm releases Sep–Oct 2026), but pricing is quote-based. Realistic annual spend is roughly $17k (SMB) for Nutrient and a median of about $25k for Apryse, against an advertised Apryse floor of $1,500. Syncfusion's free Community License is the standout for an early startup: it requires under $1M revenue, 5 or fewer devs, 10 or fewer employees, and never more than $3M of outside capital. Adobe PDF Services has a 500-transactions/month free tier but is a server API, not an in-browser editor.

### Cited Findings
- npm releases: `@pdftron/webviewer` (Apryse) 12.2.0 on 2026-10-01. `@nutrient-sdk/viewer` 1.23.0 on 2026-10-08 (the old `pspdfkit` package was last published 2025-02-13, suggesting a rename to `@nutrient-sdk/viewer`). `@syncfusion/ej2-pdfviewer` 35.1.39 on 2026-10-07. `@foxitsoftware/foxit-pdf-sdk-for-web-library` 11.1.1 on 2026-06-10 (license "Commercial"). `@compdfkit_pdf_sdk/webviewer` 2.9.4 on 2026-09-01. — [npm registry: @pdftron/webviewer](https://registry.npmjs.org/@pdftron/webviewer), [@nutrient-sdk/viewer](https://registry.npmjs.org/@nutrient-sdk/viewer), [pspdfkit](https://registry.npmjs.org/pspdfkit), [@syncfusion/ej2-pdfviewer](https://registry.npmjs.org/@syncfusion/ej2-pdfviewer), [Foxit](https://registry.npmjs.org/@foxitsoftware/foxit-pdf-sdk-for-web-library), [ComPDFKit](https://registry.npmjs.org/@compdfkit_pdf_sdk/webviewer)
- **Nutrient:** No public list prices. The Web Viewer SDK and Document Engine use annual licensing quoted by sales, based on components, deployment model, and scale. — [Nutrient SDK pricing](https://www.nutrient.io/sdk/pricing/). SpendHound reports average SMB spend of about $17,429/yr and enterprise about $75,844/yr, from 160 customers. This is a third-party, unverified source. — [SpendHound: Nutrient](https://www.spendhound.com/marketplace/nutrient)
- Nutrient documents a workflow in which a VLM labels form fields that a separate detector has already located. — [Nutrient guide: label form fields with VLM](https://www.nutrient.io/guides/python/extraction/label-form-fields-with-vlm.md)
- **Apryse:** "Entry-level packages from $1,500". Pricing depends on features, document volume, and client vs server deployment. — [Apryse pricing](https://apryse.com:443/pricing). An older WebViewer page (marked "Fall 2024 Release", dated) listed a "WebViewer Base" plan with 5,000 document events/year. — [Apryse WebViewer pricing (2024)](https://apryse.com/pricing/webviewer). Vendr reports a median buyer spend of $25,140/yr (n=39). — [Vendr: Apryse](https://www.vendr.com/marketplace/apryse)
- **Syncfusion Community License:** Under $1M USD annual gross revenue, 5 or fewer developers, 10 or fewer total employees, and the entity must never have received more than $3M USD outside capital (PE/VC). — [Syncfusion Community License](https://www.syncfusion.com/products/communitylicense)
- **Adobe PDF Services API:** 500 free Document Transactions/month, no credit card. The free tier is capped at 25 RPM (Enterprise 100 RPM). Some operations bill per page; for example, Accessibility Auto-Tag costs 10 transactions per page. Paid plans require a written agreement. — [Adobe Acrobat Services pricing](https://developer.adobe.com/document-services/pricing/main); [Adobe licensing & usage limits](https://developer.adobe.com/document-services/docs/overview/limits)

### Inferences
- ShipShape could start on Syncfusion's Community License, which bundles a viewer, form filling, a signature tool, annotations, and redaction. That route requires accepting a proprietary dependency and a forced migration or paid license once revenue passes $1M or the company raises more than $3M. Funding plans make this a real constraint.
- Apryse/Nutrient would buy XFA handling, high-fidelity form rendering, and Office conversion. At $17k–$25k+/yr they are hard to justify pre-revenue unless dynamic-XFA state forms are core.
- Adobe PDF Services' Auto-Tag (PDF/UA tagging) could be used selectively for accessible output of generated agreements, at 10 transactions per page.

### Gaps
- No public pricing was found for Foxit PDF SDK for Web or ComPDFKit. Startup programs for Nutrient or Apryse were not confirmed (Apryse's "preferred partner for startups" is marketing copy only).
- Feature-level verification of each SDK's XFA support and in-PDF text editing in 2026 was not done.
- Syncfusion's paid-license price after graduation was not captured.

## Flat/scanned PDF field detection and conversion to fillable

### Takeaway
Use a purpose-built detector to find field boxes: CommonForms/FFDNet (open source, WACV 2026) or Azure/Google/Textract layout APIs. Then use a vision LLM such as Claude only to label and semantically map the detected fields to profile keys. Research shows general VLMs are poor at precise field localization.

### Cited Findings
- CommonForms is a dataset of ~480k pages from ~59k forms filtered from Common Crawl (WACV 2026 abstract: ~55k docs / 450k+ pages). It frames field detection as object detection with classes Text Input, Choice Button, and Signature. — [arXiv 2509.16506](https://arxiv.org/html/2509.16506v1); [WACV 2026 poster](https://wacv.thecvf.com/virtual/2026/poster/636)
- FFDNet-S (6M params) reaches 72.3 AP and FFDNet-L (25M params) 81.0 AP at 1216px. FFDNet-L scores 93.5 AP on signatures and 78.1 on choice buttons. Each model cost under $500 to train. The authors report it beats Adobe Acrobat on precision/recall in a qualitative analysis and can detect checkboxes, which the commercial tools they tested could not. — [Hugging Face: FFDNet-L](https://huggingface.co/jbarrow/FFDNet-L); [arXiv 2509.16506](https://arxiv.org/html/2509.16506v1)
- The `commonforms` pip package provides a CLI/API to turn a PDF into a fillable PDF, with weights, plus a CPU ONNX export of FFDNet-L. — [GitHub jbarrow/commonforms](https://github.com/jbarrow/commonforms?embed=0); [HF FFDNet-L-cpu](https://huggingface.co/jbarrow/FFDNet-L-cpu)
- The FormGym benchmark (2025) reports "near-zero accuracy" by baseline vision-language agents on end-to-end form filling. It identifies field localization as the main bottleneck, "even in frontier models", including Claude Computer Use. Adding FieldFinder, a fine-tuned Florence-2 detector that outputs a box from a field name, raised accuracy in all conditions, by up to 2%→56%. — [FormGym, arXiv 2506.14079](https://arxiv.org/html/2506.14079v2)
- LlamaIndex reports that VLMs "particularly underperform" at form bounding boxes and that a purpose-built deterministic model gives a "far superior outcome". This is anecdotal. — [LlamaIndex blog](https://www.llamaindex.ai/blog/why-vlms-can-t-read-forms)
- Azure Document Intelligence's Layout model extracts text, tables, and selection marks (checkboxes). It is billed per page analyzed, with 500 free pages/month. The dollar rate could not be read from the page. — [Azure Document Intelligence pricing](https://azure.microsoft.com/it-it/pricing/details/document-intelligence/)
- Google Document AI Form Parser costs $30 per 1,000 pages (0–1M/month) and $20 per 1,000 above that. — [Google Document AI pricing](https://cloud.google.com/document-ai/pricing)
- Amazon Textract AnalyzeDocument Forms costs about $50 per 1,000 pages (first 1M/month), then $40. The free tier is 100 pages/month for 90 days. These figures come from secondary sources and were not confirmed on the AWS page. — [Wring: Textract pricing guide](https://wring.co/blog/aws-textract-pricing-guide); [aiproductivity.ai](https://aiproductivity.ai/pricing/aws-textract/)

### Inferences
- Recommended pipeline: render the page to an image (PDF.js/PDFium) → run FFDNet (ONNX, CPU, on a worker or container, since it is too heavy for the browser on all devices) → snap boxes to underlying vector lines and text from the PDF → send Claude a page image plus numbered box overlays and nearby text, and have it name and type each field and map it to profile keys → write AcroForm widgets with pdf-lib (including comb for SSN/EIN-like boxes) → store the field map per form hash so the work is reused for all users of the same official form.
- Cloud OCR APIs (Azure/Google/Textract) mainly help with scanned (image-only) pages and key-value extraction. They find labels and values better than empty input boxes, so they complement FFDNet rather than replace it.

### Gaps
- No head-to-head accuracy figures for Claude specifically on bounding-box localization were found.
- Azure Layout's per-1k-page price was not captured. Textract pricing was not verified on AWS's site.

## Generating professional PDFs (Chromium, React-PDF, Typst, WeasyPrint, Gotenberg; PDF/UA, PDF/A; PAdES vs image signatures)

### Takeaway
For Common Paper–style agreements from Markdown/HTML, the best typography plus accessibility in 2026 comes from Typst 0.14+ (tagged by default, PDF/UA-1, all PDF/A parts). It can run in Node/WASM (`@myriaddreamin/typst.ts` 0.7.0). Headless Chromium via `@sparticuz/chromium` on Vercel is viable within the 250 MB bundle and 300–800 s limits and gives HTML/CSS fidelity, but it is heavier. @react-pdf/renderer is simple but weaker typographically and on tagging.

### Cited Findings
- Typst 0.14.0 (Oct 24, 2025) rewrote PDF export on the krilla library. PDFs are tagged by default, PDF/UA-1 is opt-in with extra checks (missing titles, heading hierarchy, alt text), all four PDF/A parts are supported, and PDF 1.4–2.0 is selectable. PDF/UA-2 is not yet supported. Imported PDFs lose internal tags. — [Typst 0.14.0 changelog](https://www.typst.app/docs/changelog/0.14.0); [Typst blog 0.14](https://typst.app/blog/2025/typst-0.14); [Typst PDF docs](https://typst.app/docs/reference/pdf/)
- `@myriaddreamin/typst.ts` 0.7.0 (2026-06-01, Apache-2.0) provides Typst compiled to WASM for JS. — [npm registry](https://registry.npmjs.org/@myriaddreamin/typst.ts)
- `@sparticuz/chromium` 153.0.0 (2026-09-11, MIT) is the Lambda/Vercel-compatible Chromium build. — [npm registry](https://registry.npmjs.org/@sparticuz/chromium)
- Vercel Functions (Fluid compute, docs updated 2026-08-24): memory 2 GB (Hobby) or 4 GB/2 vCPU (Pro/Ent). Max duration 300 s on Hobby; Pro/Ent default 300 s, max 800 s, beta 1800 s. Bundle limit is 250 MB uncompressed, with "Large functions" beta up to 5 GB. Request/response body limit is 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE). — [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- Adobe PDF Services offers Accessibility Auto-Tag at 10 transactions per page. — [Adobe limits](https://developer.adobe.com/document-services/docs/overview/limits)

### Inferences
- Typst also has strong layout primitives for numbered clauses, cover pages, and signature blocks, which fits Common Paper agreements well. Convert Markdown to Typst via a template (cmarker or pandoc-style) and compile in a Vercel function or in the browser via WASM.
- Chromium output is tagged when generated with Puppeteer/Playwright `page.pdf({ tagged: true })` (general knowledge; not verified against 2026 docs). Gotenberg (Docker, Chromium + LibreOffice) cannot run on Vercel and would need Fly/Render/Cloud Run.
- On signatures: a drawn or typed image stamped into the page is a "simple electronic signature". It is legally valid for most US commercial contracts under ESIGN/UETA when paired with intent, consent, and an audit trail, but it is not tamper-evident. A PAdES (PKCS#7/CMS) digital signature applied server-side with ShipShape's certificate (key held in a KMS/HSM) makes post-signing changes detectable in Acrobat. The best practice is image signature for appearance, plus a platform PAdES seal, plus an appended audit-trail page with signer email, IP, timestamps, and document SHA-256 hashes. This is general domain knowledge; no 2026 source was retrieved.

### Gaps
- WeasyPrint, Gotenberg, and React-PDF typography/tagging quality were not verified with 2026 sources. @react-pdf/renderer's PDF/UA support status is unknown.
- No JS library for PAdES signing was verified (candidates from general knowledge: `@signpdf/signpdf`, node-forge, pdf-lib-based placeholders; Apryse/Nutrient also offer digital signatures).
- Chromium cold-start time and cost on Vercel in 2026 were not measured.

## E-sign API providers for multi-party signing (Dropbox Sign, DocuSign, BoldSign, Documenso, OpenSign)

### Takeaway
For embedded multi-party signing, BoldSign is the cheapest metered API (~$30/mo + $0.75/envelope). DocuSign's developer plans run $50–$480/mo. Dropbox Sign embedded requires Standard API at ~$300/mo. Documenso is AGPL open source (self-host free) with a $250/mo Platform plan for white-label embedding. Building simple-signature + PAdES + audit trail in-house for single-signer flows, and outsourcing only multi-party flows, is a reasonable split.

### Cited Findings
- **DocuSign (official developer page):** Starter $50/mo ($600/yr) with 40 envelopes/mo. Intermediate $300/mo ($3,600/yr). Advanced $480/mo ($5,760/yr). Third parties report 100 envelopes/mo for Intermediate and Advanced, and higher month-to-month rates ($75/$450/$720). A sandbox is free; go-live needs a paid plan. — [DocuSign developer plans](https://ecom.docusign.com/plans/developer); [Signeasy on DocuSign API pricing](https://signeasy.com/blog/business/docusign-api-pricing)
- **Dropbox Sign:** API plans are Essentials, Standard, and Premium. Embedded signing requires Standard API or higher at about $300/mo ($3,600/yr). These figures are from a third-party guide, and sources conflict on web-plan prices. — [Verdocs: Dropbox Sign pricing](https://verdocs.com/?p=13952)
- **BoldSign:** A free API sandbox is available. Production Enterprise API is about $30/mo with 40 envelopes and $0.75 per extra envelope. This is third-party data. — [Verdocs: BoldSign pricing](https://www.verdocs.com/blog/boldsign-pricing)
- **Documenso:** The self-hosted edition is AGPL-3.0 with no fee. Hosted pricing: free (5 docs/mo), Individual ~$25–30/mo, Teams ~$40/mo for 5 users (+$8/seat), and Platform $250/mo with unlimited API and white-label embedding. — [Documenso pricing](https://documenso.com/pricing); [Toolradar: Documenso pricing](https://toolradar.com/tools/documenso/pricing); [Sliplane: open-source DocuSign alternatives 2026](https://sliplane.io/blog/5-open-source-docusign-alternatives)

### Inferences
- Self-hosting Documenso's AGPL code inside ShipShape's closed product carries the same §13 network-use obligations as MuPDF. Running it as a separate unmodified service, or using the hosted Platform plan, avoids this.
- Envelope-metered APIs fit low-volume multi-party contracts (NDAs, MSAs). W-9s are single-signer and can be handled in-app.

### Gaps
- OpenSign licensing and pricing were not found in this pass (it is described only as an open-source DocuSign alternative).
- Dropbox Sign and BoldSign figures were not confirmed on official vendor pages.

## Security: sanitizing uploaded PDFs, malware scanning, Vercel upload limits

### Takeaway
Upload PDFs directly from the browser to storage (Supabase Storage / Vercel Blob), never through a Vercel function, because the body limit is 4.5 MB. Scan them, and either reject or strip active content (/JavaScript, /JS, /OpenAction, /Launch, /EmbeddedFile). Rendering only with PDF.js (with its JS evaluation disabled) and re-writing via pdf-lib drops most active content. The W-9 itself contains no /JavaScript.

### Cited Findings
- The Vercel function request/response body limit is 4.5 MB and cannot be raised by configuration. Vercel recommends direct client uploads to Blob storage. — [Vercel Functions limits](https://vercel.com/docs/functions/limitations); [Vercel KB: bypass body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions); [Vercel file storage](https://vercel.com/docs/concepts/solutions/file-storage)
- Tools like pdfid report counts of /JavaScript, /OpenAction, /Launch, and embedded files. Security guidance recommends server-side rejection of PDFs containing /JavaScript, /JS, or /OpenAction. — [Swifdoo: remove active content](https://www.swifdoo.com/blog/remove-active-content-from-pdf); [Adobe community: XSS via PDF upload](https://experienceleaguecommunities.adobe.com/adobe-experience-manager-sites-8/cross-site-scripting-pdf-upload-247972)
- Drupal's PDF Sanitizer uses Ghostscript to re-distill and replace uploads. pdf-defang is a Python drop-in for web apps accepting PDFs. Stripping can break content, for example removing fonts can make text invisible. — [Drupal pdf_sanitizer](https://drupal.org/project/pdf_sanitizer); [pdf-defang (pepy)](https://pepy.tech/projects/pdf-defang); [IDR Solutions sanitize PDF](https://www.idrsolutions.com/docs/jpedal/tutorials/pdf-manipulation/sanitize-pdf)
- First-hand: the IRS fw9.pdf contains /AcroForm, /XFA, and /Perms, but 0 occurrences of /JavaScript or /Encrypt. — [IRS fw9.pdf](https://www.irs.gov/pub/irs-pdf/fw9.pdf)

### Inferences
- Suggested pipeline: signed upload URL → Supabase Storage quarantine bucket → background job (Supabase Edge Function or a container) that enforces a size/page cap, parses with pdf-lib or qpdf, rejects encrypted/malformed files, removes /OpenAction, /AA, /JavaScript name trees, /Launch, /EmbeddedFiles, and /RichMedia, and optionally ClamAV-scans → move to a clean bucket. Serve PDFs with `Content-Disposition: attachment` and from a separate origin to avoid same-origin XSS through in-browser PDF viewers.
- PDF.js by default does not execute document JavaScript in embedders (`enableScripting` is off unless configured; general knowledge, not verified for v6). Keep it off.
- The Ghostscript-based sanitizer adds AGPL licensing concerns similar to MuPDF.

### Gaps
- Dangerzone/qpdf-specific sanitization docs and ClamAV-on-serverless options were not retrieved. Supabase Storage size limits and any built-in scanning were not checked.
- No 2025–2026 CVE review of pdf.js/pdf-lib was done.
