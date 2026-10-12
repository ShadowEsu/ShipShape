# ShipShape Visual Design Language: "Claude-like clarity + NYT/magazine editorial", legally safe

Research date: 2026-10-12. Sources were gathered by web search and fetch in this session. Many brand/typography details about private companies come only from secondary sources (type blogs, design-system scrapers), because Anthropic, NYT, Mercury etc. publish little official type documentation. Confidence is flagged throughout. Items marked "[background, not verified this session]" are from the researcher's general knowledge. The report writer should treat them as unverified and must not cite them as facts without checking.

---

## 1. What typefaces, colors and principles does Anthropic / Claude use? Which are proprietary vs open?

### Takeaway
Anthropic's identity was built by the studio Geist. It originally paired two licensed commercial faces, Styrene (Commercial Type) and Tiempos (Klim). In late September 2025 (credit post dated 2025-09-29) it was reported to have moved to a bespoke "Anthropic Sans / Serif" family (plus a Mono) by Chester Jenkins at BSPK. All of these are proprietary. ShipShape cannot use any of them and should not use the unofficial "free" redistributions circulating online. The palette (near-black #141413 on warm cream #faf9f5, clay-orange accent #d97757) is documented in Anthropic's own public GitHub skills repo. It is distinctive enough that ShipShape should not copy it.

### Cited Findings
- Geist (Portland design studio) built Anthropic's identity over about 2.5 years, from stealth to Claude's launch in mid-2023. The type palette was "the Styrene family by Commercial Type, and Klim's Tiempos family", described as "technically refined and charmingly quirky." Other elements: a purely typographic logo with a single "slash" detail referencing code; a color system intended to add warmth across marketing and product UI; an illustration language meant to reinforce "human values" and be understandable to technical and general audiences; documentary photography by Aaron Wojack; a UI component system and modular CMS — [Geist case study](https://geist.co/work/anthropic)
- On Anthropic's site, Styrene (Berton Hasebe, Commercial Type) was used for headlines and subheads and Tiempos (Klim) for body text. Styrene comes in two families: A (wider, more geometric) and B (narrower). type.today (article dated 4 Apr 2024) says Anthropic was "trying to distance themselves from a technological, somewhat intimidating visual style" — [type.today, "Styrene in use: ANTHROP\C"](https://type.today/en/journal/anthropic)
- Anthropic Console CSS loaded `styreneA` and `styreneB` font-face families (older snapshot) — [console.anthropic.com CSS](https://console.anthropic.com/_next/static/css/026a2e7f617cf4f9.css); a third-party capture of anthropic.com/pricing lists "Tiempos Text, Styrene A Web" — [Font of Web](https://www.fontofweb.com/pin/1469)
- Newer: the design studio DBCo posted that Geist's "expanded visual identity work … includes new bespoke Anthropic Sans & Serif typefaces by Chester Jenkins at BSPK." Decoding the post ID gives 2025-09-29 — [DBCo on X](https://x.com/designbizco/status/1972759238049997006)
- A secondary write-up (20 May 2026) describes an "Anthropic Type" suite of Anthropic Serif, Sans and Mono, each in Text and Display optical variants. Display cuts have sharper forms, tighter spacing and more contrast. Text cuts have more open forms, a larger x-height and lower contrast. It describes the Serif as "warm and editorial," with authority, and the Sans as aiming for warmth over generic corporate minimalism — [Gooova Studio](https://gooova.com/en/anthropic-designed-its-own-type-family/)
- Font-detection sites now report anthropic.com using Anthropic Sans/Serif — [wtfont.app](https://wtfont.app/site/anthropic.com); [Font of Web pin](https://fontofweb.com/pin/5066)
- **Licensing conflict:** one design-system scraper says the faces are proprietary with no public web fonts — [shadcn.io Anthropic page](https://www.shadcn.io/design/anthropic). wtfont.app labels them OFL/Apache, and an npm package "anthropic-fonts" redistributes them via CDN — [libraries.io](https://libraries.io/npm/anthropic-fonts). "Free download" font-pirate sites list them with BSPK LLC as manufacturer — [fontiko](https://fontiko.com/fonts/444/anthropic-sans-font/). No official Anthropic statement of open licensing was found. Bespoke commissioned type is ordinarily proprietary, so the OFL label is very likely wrong.
- Anthropic's official public "brand-guidelines" skill (anthropics/skills repo) lists these colors. Dark #141413 (text, dark backgrounds), Light #faf9f5 (light backgrounds), Mid gray #b0aea5, Light gray #e8e6dc, accents Orange #d97757, Blue #6a9bcc, Green #788c5d. Fallback fonts are Poppins for headings (24pt+) and Lora for body, with Arial/Georgia as fallbacks — [anthropics/skills brand-guidelines SKILL.md](https://raw.githubusercontent.com/anthropics/skills/main/skills/brand-guidelines/SKILL.md)
- Claude app UI conventions (single centered conversation column, generous whitespace, serif for model responses, warm cream background, the orange "spark" mark) [background, not verified this session]. Claude.ai has historically used a Copernicus/Tiempos-style serif for response text and Styrene for UI; current production fonts are presumably the Anthropic Type family [background, not verified].

### Inferences
- The look comes from (a) a serif used for reading and headlines, paired with a quirky but quiet sans for UI, (b) a warm off-white "paper" ground instead of pure white, (c) one earthy accent used sparingly, and (d) huge whitespace and a narrow reading measure. All of these can be reached with open fonts without copying the assets.
- Anthropic's most distinctive and recognizable pieces are cream #faf9f5 with clay orange #d97757, the slash/spark marks, and the Anthropic Serif letterforms. ShipShape should avoid all three to prevent a "Claude knockoff" impression. Any warmth should come from a neutral, not a cream-plus-orange pairing.

### Gaps
- No official Anthropic announcement or brand portal for Anthropic Type, so the exact launch date and current claude.ai app font stack are unverified.
- Did not verify current claude.ai CSS tokens (background hex, type sizes) directly.

---

## 2. NYT design: Cheltenham, Imperial, Franklin, Karnak — what makes it read as authoritative, and proprietary status

### Takeaway
The NYT uses a family of custom, proprietary typefaces commissioned by design director Tom Bodkin, mostly from Matthew Carter and Font Bureau / Carter & Cone. Each is assigned a strict role: Cheltenham for news headlines, Imperial (or historically Georgia on web) for body, Franklin for metadata, navigation and captions, and Karnak/Stymie for louder feature display. Its authority comes from consistency of that role system, black-on-white restraint, hairline rules, and dense hierarchy, not from any single font. None of the NYT cuts are licensable to third parties.

### Cited Findings
- NYT Cheltenham was commissioned by Tom Bodkin. Matthew Carter drew multiple widths and weights for the paper. NYT Franklin sets "meta information, captions, and navigation," replacing the earlier site's "heavy dependence on Arial and all caps Georgia." NYT Stymie and NYT Karnak set headlines in magazine pieces and longer articles needing "a louder, heavier display face." Body text on the 2013 web redesign was Georgia, kept partly for good Windows hinting (commenter claim) — [Fonts In Use: NYT article redesign, May 2013](https://fontsinuse.com/uses/3907/the-new-york-times-article-redesign-may-2013)
- Carter's NYT work: NYT Cheltenham (2001, 2008–2014), NYT Franklin (2012–2014), and others. NYT Karnak is listed as 1993–2014 by Font Bureau and later Carter & Cone ("custom fonts used, as of 2018, by the New York Times") — [Luc Devroye type design info page](https://luc.devroye.org/fonts-26319.html); [Devroye page 2](https://luc.devroye.org/fonts-95929.html)
- In 2003 the paper went "all Cheltenham, all the time" in headline styling under Bodkin — [Design Observer](https://designobserver.com/the-new-york-times-apocalypse-now-page-a1/)
- NYT Imperial appears in a 2020 front-page use credited to Andrew Sondern and Tom Bodkin — [Fonts In Use](https://fontsinuse.com/uses/3907/the-new-york-times-article-redesign-may-2013) (cross-reference on page)
- The original Cheltenham was designed by Bertram Goodhue and Ingalls Kimball (1896) and completed by Morris Fuller Benton (c.1902). Karnak is a slab serif by R. Hunter Middleton for Ludlow (1931–42). The historic designs are old, but NYT's digitizations are custom — [Wikipedia: Cheltenham](https://en.wikipedia.org/wiki/Cheltenham_(typeface)); [Wikipedia: Karnak](https://en.wikipedia.org/wiki/Karnak_(typeface))
- NYT Magazine has its own custom 47-font family (D&AD 2016). NYT Mag Serif and Slab are credited to Henrik Kubel (2015) — [D&AD](https://www.dandad.org/work/d-ad-awards-archive/nyt-magazine-typefaces); [Devroye](https://luc.devroye.org/fonts-95929.html)
- A community-scraped "NYT design system" summarizes Cheltenham headlines, uppercase Franklin labels, Imperial body, and ink #121212. It is unofficial, so check sizes and colors before relying on them — [shadcn.io NYT](https://www.shadcn.io/design/nytimes)
- Typewolf lists free Cheltenham-like alternatives. The Cheltenham design itself is public-domain-era, but quality digital versions vary — [Typewolf: Cheltenham](https://www.typewolf.com/cheltenham)
- A suggested claim that Erik van Blokland designed NYT Karnak could not be confirmed. Sources credit Font Bureau / Carter & Cone. Treat any van Blokland attribution as false unless proven.

### Inferences
- What reads as "authoritative" and is safe to borrow (these are generic editorial conventions, not trade dress):
  - Strict role-based type: serif headline, serif body, and a small-caps or uppercase sans for kickers, bylines, timestamps and labels.
  - Thin horizontal rules separating sections.
  - Kicker over headline over dek over byline/dateline stacking.
  - Restrained black-on-white with color only for meaning.
  - Dense but orderly multi-column indexes.
  - Datelines and "Updated" timestamps that signal currency.
- For ShipShape, map these onto document metadata: "Form W-9 · IRS · Rev. March 2024 · Last checked 3 days ago." A dateline-and-source line is a perfect trust device for a paperwork product.
- Avoid the NYT's "T" monogram, its blackletter nameplate style, and any Cheltenham revival paired with Franklin in NYT proportions. That combination is iconic enough to read as imitation.

### Gaps
- No primary NYT Open (open.nytimes.com) design-system post was retrieved. Official token values and grid specs are unverified.
- Exact current web body face (Imperial vs Georgia) as of 2026 is unverified. Most secondary sources say NYT Imperial for body, but the 2013 source shows Georgia.

---

## 3. Black-and-white editorial / magazine references (New Yorker, Atlantic, Businessweek, Monocle, FT, Stripe Press, Apple Newsroom)

### Takeaway
No primary sources on these publications were retrieved in this session (tool budget). The conventions below are widely known design practice, offered as background for the writer to verify or present as general guidance rather than cited fact.

### Cited Findings
- (General principle, cited) Assigning typefaces by content type is how editorial systems build hierarchy: a louder display face for features, a serif for news headlines, and a sans for metadata and navigation — [Fonts In Use, NYT 2013](https://fontsinuse.com/uses/3907/the-new-york-times-article-redesign-may-2013)

### Inferences
- [background, not verified this session] Reference patterns worth borrowing as generic conventions:
  - **The New Yorker:** custom Irvin display face (proprietary); generous margins; illustration-led covers and spot drawings rather than stock photography; drop caps; small-caps bylines.
  - **The Atlantic:** a 2019 redesign with a custom serif (proprietary, by Commercial Type / Production Type collaboration — unverified); big serif headlines; spare black/white/red.
  - **Bloomberg Businessweek:** loud, maximalist typographic covers. It is a useful counter-example; ShipShape should take its information-graphic clarity, not its chaos.
  - **Monocle:** dense multi-column grids, small-caps section labels, numbered lists, flat spot illustration, and a "briefing" tone.
  - **Financial Times:** salmon paper (a trademark-like signature color, so avoid), Financier typeface (Klim, proprietary), and hairline rules.
  - **Stripe Press:** book-like layouts, generous whitespace, and classic serif text type.
  - **Apple Newsroom:** San Francisco type, big single-column photography, and dated, categorized items.
- Patterns to adopt in a ShipShape system:
  - Kicker label (uppercase sans, tracked about +6%) over the headline.
  - 1px hairline rules (no boxes or shadows) to separate sections.
  - Dateline and source line on every document and form.
  - An optional drop cap only on long marketing essays, never in the app.
  - Numbered "Step 1 / 2 / 3" lists in editorial style.
  - Pull-quotes for testimonials.
  - Footnote-style citations for legal warnings ("¹ Not legal advice…").
  - Illustration in one-color line or engraving style instead of photos of smiling people.
  - Large whitespace with a 60–75 character reading measure.

### Gaps
- Unverified: specific typefaces and grid specs for The Atlantic, New Yorker, Businessweek, Monocle, FT, Stripe Press and Apple Newsroom. Fonts In Use pages for each would close this.

---

## 4. Best open-license (OFL / Google Fonts) alternatives

### Takeaway
All candidate faces were verified as OFL in the official google/fonts repository metadata. The strongest editorial serif for ShipShape is **Newsreader** (Production Type, commissioned by Google Fonts for on-screen news reading). It has a true optical-size axis (6–72) and weights 200–800, so one family covers 12px captions through 72px headlines. **Source Serif 4** (opsz 8–60, weights 200–900) is the sturdier runner-up. For UI sans, **Inter** (now with opsz 14–32), **IBM Plex Sans**, **Instrument Sans**, **Public Sans** or **Libre Franklin** (the closest open nod to NYT Franklin, but weaker at small UI sizes) are all OFL.

### Cited Findings
- License and axis metadata from google/fonts METADATA.pb (fetched 2026-10-12) — [google/fonts repo](https://github.com/google/fonts/tree/main/ofl):
  - Newsreader — Production Type — OFL — opsz 6–72, wght 200–800 — added 2020-07-01
  - Source Serif 4 — Frank Grießhammer — OFL — opsz 8–60, wght 200–900 — 2021-11-16
  - Literata — TypeTogether — OFL — opsz 7–72, wght 200–900 — 2018-12-06
  - Fraunces — Undercase Type et al. — OFL — opsz 9–144, wght 100–900, plus "SOFT" and "WONK" axes — 2020-10-29
  - Instrument Serif — Rodrigo Fuenzalida, Jordan Egstad — OFL — static — 2023-03-22
  - Instrument Sans — same designers — OFL — wdth 75–100, wght 400–700 — 2023-04-13
  - Libre Franklin — Impallari Type — OFL — wght 100–900 — 2016-06-20
  - Inter — Rasmus Andersson — OFL — opsz 14–32, wght 100–900 — 2020-01-24
  - IBM Plex Sans — Mike Abbink, Bold Monday — OFL — wdth 75–100, wght 100–700; IBM Plex Serif and Plex Mono are also OFL
  - Public Sans — USWDS et al. — OFL — wght 100–900
  - Source Sans 3 — Paul D. Hunt — OFL — wght 200–900
  - Geist (Vercel) — OFL — wght 100–900 — 2024-10-02
- Newsreader is "an open-source serif typeface commissioned by Google Fonts, designed for on-screen, longer-form reading." Designer Hugues Gentile, art direction Jean-Baptiste Levée; 42 styles including three optical sizes and seven weights — [Production Type: Newsreader](https://productiontype.com/family/newsreader); [Production Type news](https://www.productiontype.com/news/new_fonts_from_production_type_newsreader)
- Instrument Serif is a narrow, high-contrast display face suited to tight headlines, not body text — [maxibestof.one](https://maxibestof.one/typefaces/instrument-serif)
- Source Serif 4 is a companion to Source Sans and is commonly paired with Inter for data-heavy interfaces — [Mantlr pairing cheat sheet](https://mantlr.com/blog/google-fonts-pairing-cheat-sheet); [Wikipedia: Source Serif 4](https://en.wikipedia.org/wiki/Source_Serif_4)
- Newsreader is commonly paired with a neutral grotesque (e.g., Inter) for headings and UI — [maxibestof.one: Newsreader](https://maxibestof.one/typefaces/newsreader)
- Stanford uses Source Serif 4 as its primary serif (institutional-trust precedent) — [Stanford Identity](https://identity.stanford.edu/design-elements/typography/primary-typefaces/)

### Inferences
- **Quality notes for UI at small sizes** (designer judgment; test in-browser):
  - Newsreader's low optical sizes (opsz 6–16) widen spacing and lower contrast, so 13–16px is readable. That is exactly the Tiempos Text / Anthropic Serif Text behavior.
  - Instrument Serif has no text cut and is unusable below about 28px.
  - Fraunces is charming but its "wonky"/soft personality reads playful, not "super professional." Use only at opsz 144 with WONK=0, or skip it.
  - Inter is the most hinted and robust sans at 11–14px, but it is also the #1 "AI-generated site" tell (see section 5). Prefer IBM Plex Sans, Instrument Sans or Public Sans for distinctiveness.
  - Public Sans was built for the US Web Design System, a useful subliminal "government-forms" credibility cue for a paperwork product.
  - Libre Franklin is the closest open analogue to NYT Franklin for kickers. Uppercase, tracked labels work at 11–12px; avoid it for dense UI body.
- **Closest open "Styrene-like" feel:** Instrument Sans (with its width axis) or Geist. Neither is a clone, which is good.

### Gaps
- No independent rendering benchmarks (e.g., Windows ClearType at 12px) were found. Recommend a quick prototype test.
- Did not check "Inter Display" separately. Inter's opsz axis on Google Fonts now covers display sizes (14–32).

---

## 5. How serious fintech / legal / AI products signal trust; what to avoid

### Takeaway
Sources consistently say trustworthy fintech and AI brands rely on restraint: one well-crafted type system (often custom), a near-monochrome palette with a single accent, and precise UI detailing. The anti-pattern is the generic "vibe-coded" AI site: a purple/indigo gradient hero, Inter everywhere, a pill badge, three icon cards, neon glow, and emoji icons. Primary sources from Mercury, Ramp, Harvey and Perplexity were not found, so company-specific claims are secondary and partly conflicting.

### Cited Findings
- Mercury reportedly uses a commissioned "Arcadia" family (ArcadiaDisplay for headings, Arcadia for body), headlines at an unusual 480 weight, and a quiet, editorial, "unusually literary for fintech" tone (secondary, unofficial guide) — [Blake Crosley: Mercury design guide](https://blakecrosley.com/guides/design/mercury)
- Stripe is the oft-cited reference. One source says Klim's Söhne, another says GT Walsheim, so the sources conflict. Mercury type claims also conflict (Inter vs custom Arcadia) — [utsubo fintech patterns](https://www.utsubo.com/blog/fintech-website-trust-design-patterns); [themasterly fintech guide](https://www.themasterly.com/blog/fintech-design-guide)
- "The family resemblance is the trust signal": neutral sans plus restraint reads as safe, but an all-geometric-sans system "risks feeling generic." Ramp is described as prioritizing credibility over aesthetics, and Linear's "dark-mode aesthetic and precision typography communicate high design standards" — [metabrand fintech guide](https://www.metabrand.digital/guides/startup-branding-guide/fintech-branding); [brandappart](https://www.brandappart.com/blog/fintech-branding-examples)
- AI-site tells: "purple gradients, Inter font, and three boxes with icons arranged in a grid"; "a purple-to-blue gradient, usually in the hero, plus a centered hero in Inter with a small pill-shaped badge"; also "unprompted neon glow, emoji used as icons," and "centered hero + three feature cards + CTA" — [robotsonpayroll](https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look); [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website); [codemyspec](https://codemyspec.com/blog/vibe-coded-websites-look-the-same)
- The purple trend is attributed to Tailwind UI's `bg-indigo-500` demo default (blog claim) — [prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
- Suggested fixes: write a design.md constraints file; pick one dominant color plus one sharp accent; break the hero/3-features/testimonials/CTA template; run a "reverse squint" test (ask a fresh model which AI builder made the screenshot) — [robotsonpayroll](https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look)

### Inferences
- Trust signals ShipShape should use:
  - Visible sources and datelines on every form ("Official source: irs.gov · fetched today").
  - Precise numerals (tabular figures).
  - Real product screenshots of filled PDFs rather than abstract 3D blobs.
  - Plain-language warnings styled like editorial footnotes or "Editor's note" boxes.
  - A visible security and privacy note in the footer area.
  - No hype adjectives in headlines.
- Avoid:
  - Gradient washes, glassmorphism, sparkles/✨ "AI" icons, and robot or brain illustrations.
  - Purple/indigo.
  - Centered hero with a pill badge.
  - Stock photos of handshakes.
  - Emoji as icons.
  - Excessive rounded cards with drop shadows.
- Linear-style dark mode can be offered, but a light, paper-like default better matches "documents."

### Gaps
- No primary sources for Harvey, Perplexity, Ramp or Linear typography/brand guidelines. [background, not verified this session]: Linear uses Inter Display; Harvey uses a serif-forward, near-monochrome editorial style; Perplexity uses a custom grotesk with a teal accent.

---

## 6. Accessibility constraints for a black-and-white palette

### Takeaway
A monochrome palette makes text contrast easy but creates two traps. First, light-gray hairlines and disabled or secondary text often fall below WCAG minimums. Second, status (error, warning, success) cannot rely on color alone. The proposed tokens below were checked with the WCAG 2.x relative-luminance formula in this session.

### Cited Findings
- WCAG 2.2 SC 1.4.3 Contrast (Minimum): 4.5:1 for normal text, 3:1 for large text (≥18pt, or 14pt bold) — [W3C Understanding 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) (canonical page; not re-fetched this session)
- SC 1.4.11 Non-text Contrast: UI component boundaries and meaningful graphics need 3:1 against adjacent colors — [W3C Understanding 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) (not re-fetched)
- SC 1.4.1 Use of Color: color must not be the only visual means of conveying information — [W3C Understanding 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) (not re-fetched)
- Contrast ratios computed in this session (WCAG formula):
  - On light paper #FCFCFA:
    - ink #111111: 18.4:1
    - ink-2 #3D3D3A: 10.6:1
    - muted #5E5E5A: 6.3:1
    - hairline-strong #8A8A85: 3.4:1
    - rule #D9D9D4: 1.4:1 (decorative only)
    - accent navy #1D3A5F: 11.2:1
    - success #1F6B3A: 6.3:1
    - warning #8A5A00: 5.8:1
    - error #B3261E: 6.4:1
    - info #1D4E89: 8.2:1
  - On dark #0E0E0E:
    - paper text #ECECE8: 16.3:1
    - muted #A3A39E: 7.6:1
    - accent #9DB8DA: 9.5:1
    - success #6FCF8E: 10.1:1
    - warning #E8B04B: 9.9:1
    - error #F28B82: 8.1:1
    - rule #3A3A37: 1.7:1 (decorative only)
  - Source: computed by researcher with the WCAG relative-luminance formula.

### Inferences
- Decorative hairline rules can be light (#D9D9D4). Form-field borders, checkboxes and focus rings must hit 3:1 (use #8A8A85 or darker, and a 2px ink focus ring).
- Status must pair color with an icon and a text label (e.g., "⚠ Needs review", "✓ Filled", "✕ Missing signature"), plus a left border or weight change. That works in grayscale, for color-blind users, and in print.
- Avoid pure #000 on pure #FFF for long reading (halation). Near-black on a slightly warm or neutral off-white is the editorial norm. Keep it neutral rather than cream to stay away from Anthropic's #faf9f5.
- Dark mode is a separate token set, not an inversion: lift muted text to about #A3A3A3, desaturate and lighten accents, and keep PDFs and document previews on a white "sheet" even in dark mode, because documents are white in reality.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`. Minimum body size is 16px on marketing pages and 14–15px in dense app tables (with Newsreader opsz auto).

### Gaps
- No user-testing data on serif body text in form-heavy UIs. A serif for long reading plus a sans for form controls is the safe split.

---

## 7. Trademark / trade-dress risks of imitating NYT or Anthropic

### Takeaway
Fonts themselves are the main hard legal line. Using proprietary NYT or Anthropic font files (including "free" leaked copies) would be copyright/licence infringement. Separately, US courts have allowed website "look and feel" to proceed as trade dress when a plaintiff shows a distinctive, non-functional combination of fonts, colors and layout plus likely confusion. The risk is low for generic editorial conventions and higher for copying signature combinations (NYT's Cheltenham + Franklin + "T" + masthead blackletter; Anthropic's cream + clay orange + slash/spark marks + bespoke serif).

### Cited Findings
- *Ingrid & Isabel v. Baby Be Mine* (N.D. Cal.): the court held that a website's "look and feel" may constitute protectable trade dress. Similar fonts, style, format and colors were alleged. "Feminine script" and "pastel pink-orange hues" were deemed non-functional and protectable. Intentional copying can help establish secondary meaning — [Pillsbury e-commerce law report](https://www.pillsburylaw.com/images/content/9/7/v2/977/EcommerceLawReports-GhajarLevineNovDec2014.pdf); [AIPLA: "Does this web dress make my site look distinctive"](https://www.aipla.org/innovate/does-this-web-dress-make-my-site-look-distinctive)
- Plaintiffs must show distinctiveness (inherent or acquired), non-functionality and likelihood of confusion. Courts have dismissed claims that merely list features without "synthesizing" the overall look. Inherent distinctiveness for a website may be "nearly impossible," so secondary meaning is usually needed — [internetcases.com](https://internetcases.com/category/trademarks/page/5/); [AIPLA](https://www.aipla.org/innovate/does-this-web-dress-make-my-site-look-distinctive)
- There is a directly relevant precedent of a trade dress plus copyright suit between legal-document preparation services over website look and feel — [IP Trademark Attorney blog](https://www.iptrademarkattorney.com/web-site-trade-dress-look-and-feel-copyright-legal-document-preparation-help/)
- These sources are mostly district-court decisions and law-firm commentary, not appellate rulings, so the law varies by jurisdiction — same sources as above.
- Anthropic's bespoke type is proprietary per one source, but it is circulating on unofficial CDNs and pirate font sites — [shadcn.io](https://www.shadcn.io/design/anthropic); [fontiko](https://fontiko.com/fonts/444/anthropic-sans-font/)

### Inferences
- Rules for ShipShape:
  1. Use only OFL/licensed fonts and keep the license files in the repo.
  2. Never ship Anthropic Sans/Serif, Styrene, Tiempos, Copernicus, or any NYT cut, nor "free" copies of them.
  3. Do not use a blackletter wordmark, a "T"-like monogram, or a "The ShipShape Times"-style masthead.
  4. Do not use clay-orange-on-cream as the brand pair, or a slash, asterisk or spark glyph as the logo.
  5. Do not name features with "Claude"/"Times" puns or claim partnership.
  6. Do not use FT salmon backgrounds.
  7. The "paperwork passport" can draw on generic passport and stamp iconography (public-domain conventions) without copying any government's actual passport design.
- Generic editorial conventions are not protectable by any one brand: serif headlines, kickers, hairline rules, datelines, drop caps, multi-column grids and black-and-white restraint. This is the safe zone to work in.
- Separately, avoid copying any government seal or agency logo when "finding official forms." Link to agencies by name instead. This is a related, adjacent legal risk.

### Gaps
- No trademark attorney review. No search was done for NYT or Anthropic trade dress registrations specifically.

---

## 8. Concrete design-language recommendation for ShipShape (synthesis)

### Takeaway
Call it "The Ledger": an editorial, near-monochrome system. Newsreader (OFL serif with optical sizes) handles headlines and reading. IBM Plex Sans or Instrument Sans (OFL) handles UI and labels, and IBM Plex Mono handles form numbers and IDs. The palette is ink on neutral paper with one deep "navy ink" accent and semantic status colors that always carry icons. Add hairline rules, kickers and datelines, a 12-column grid with a 68ch reading measure, line or engraving-style monochrome illustration, and quiet 150–250ms motion. This evokes Claude's calm and the NYT's authority while copying neither.

### Cited Findings
- Font license and axis facts: [google/fonts repo](https://github.com/google/fonts/tree/main/ofl); [Production Type Newsreader](https://productiontype.com/family/newsreader)
- Role-based type assignment is the NYT-style editorial mechanism — [Fonts In Use](https://fontsinuse.com/uses/3907/the-new-york-times-article-redesign-may-2013)
- Text vs Display optical-cut logic as used in Anthropic Type — [Gooova Studio](https://gooova.com/en/anthropic-designed-its-own-type-family/)
- Avoid AI-design tropes — [robotsonpayroll](https://robotsonpayroll.substack.com/p/how-to-avoid-that-vibe-coded-look)
- Contrast values were computed in this session (section 6).

### Inferences

**Type stack (all OFL)**
- Display and reading serif: **Newsreader** (variable, opsz auto). Use 500–600 for headlines and 400 for body. Alternate: Source Serif 4.
- UI and label sans: **IBM Plex Sans**. It is neutral and engineered, has a corporate-trust "IBM" feel, a width axis for dense tables and tabular numerals. Alternate: Instrument Sans for a warmer, more "Styrene-adjacent" feel, or Public Sans for a "government-form" feel. Avoid Inter as the primary face to sidestep the AI-template look.
- Mono: **IBM Plex Mono** for form numbers (e.g., "SS-4", EIN masks), passport IDs and audit logs.
- Kicker style: Plex Sans, 12px, 600 weight, uppercase, letter-spacing 0.06em.

**Type scale** (rem, 16px base; ratio about 1.25 in app and about 1.333 on marketing)

| Role | App | Marketing |
|---|---|---|
| caption / meta | 12/16 sans | 13/18 sans |
| UI body | 14/20 sans | — |
| reading body | 16/26 serif | 18/30 serif |
| H4 | 18/24 sans 600 | 20/28 serif |
| H3 | 20/28 serif 600 | 28/34 serif |
| H2 | 24/30 serif 600 | 40/46 serif |
| H1 | 32/38 serif 600 | 56–72/1.05 serif, tracking −0.01em |

Use `font-variant-numeric: tabular-nums` in tables, `text-wrap: balance` on headlines and `text-wrap: pretty` on paragraphs.

**Palette tokens**
- Light mode:
  - paper #FCFCFA
  - surface (sheet) #FFFFFF
  - ink #111111
  - ink-2 #3D3D3A
  - muted #5E5E5A
  - border-strong #8A8A85
  - rule #D9D9D4 (decorative)
  - accent "navy ink" #1D3A5F (links, primary button fill with white text)
  - success #1F6B3A
  - warning #8A5A00 on tint #FFF6E0
  - error #B3261E
  - info #1D4E89
- Dark mode:
  - bg #0E0E0E
  - text #ECECE8
  - muted #A3A39E
  - accent #9DB8DA
  - success #6FCF8E
  - warning #E8B04B
  - error #F28B82
  - rules #3A3A37
- About 90% of any screen should be ink, paper and gray. The accent is reserved for primary actions and links. Status color always comes with an icon and a label.

**Grid and layout**
- Marketing: 12-column grid, max width 1200–1280px, 24px gutters, 64–120px section spacing, and a 60–72ch reading column for essays and legal copy.
- Use asymmetric editorial layouts (a 4/8 split with a kicker and dateline in the left rail) instead of a centered hero with three cards.
- Use 1px rules between sections instead of cards. Make the footer a dense multi-column "index."
- App: left nav (Business profile, Documents, Forms, Passport), a central "document sheet" on a gray paper background, and a right "margin notes" rail for warnings, citations and AI explanations. This footnote/annotation metaphor is the editorial signature.
- Radius 4–6px, no or only very subtle shadows, and borders instead of elevation.

**Editorial devices**
- Datelines and sources on every form card ("IRS · Form W-9 · Rev. 3-2024 · verified 12 Oct 2026").
- Warnings styled as "Editor's note" boxes with a left ink rule.
- Footnote-numbered citations.
- Drop cap only on long marketing essays and the "manifesto."
- The paperwork passport as a printable "dossier" page: serif title, mono ID, stamp-style status seals drawn in line art.

**Imagery**
- No stock photos of handshakes and no AI-generated 3D blobs or gradients.
- Use real UI and PDF screenshots set like magazine plates, with captions.
- Use one-color line or engraving-style spot illustrations of paperwork objects (stamps, clips, folders, ledgers).
- Optional documentary photography of real small-business owners, in grayscale or natural color, credited like a magazine.

**Motion**
- Functional only: 150–250ms ease-out.
- Fade or slide 4–8px for panels.
- A "field filled" highlight sweep of about 400ms on PDF fields.
- No parallax, no looping hero animations, and no typing-animation gimmicks beyond streaming AI text.
- Honor `prefers-reduced-motion`.

**Voice of the visuals**
- "Calm authority": sentence-case headlines in serif, plain verbs, no exclamation marks, and no "AI-powered ✨."

**Distinctiveness checks**
- Run the "reverse squint" test.
- Make sure no element maps to the NYT signature (blackletter or "T" mark) or the Anthropic signature (cream plus clay orange, spark or slash mark, Anthropic Serif).

### Gaps
- The recommendation is untested. Prototype and test at 12–14px on Windows and Android, and run a small 5-user trust and preference test (Newsreader+Plex vs Source Serif 4+Instrument Sans).
- No brand-name or trademark clearance for "ShipShape" itself was performed (outside scope).
