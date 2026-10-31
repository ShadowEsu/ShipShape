# ShipShape — Design Direction (plan only)

Status: planning. Nothing here is built. Supersedes the newspaper-heavy look in `docs/design-concept/`.

## The idea in one line
Big, confident words like your other startups (Jaymini, Unvibe, MEON), a New York Times–style serif for authority, and Claude-level calm and simplicity inside the app. Borrow the NYT *font feel*, not the newspaper layout.

## What your other sites already do (keep this energy)
- Jaymini: 160px headline, heavy sans + italic serif ("We promise *less busywork.*"), mono eyebrow, black pill CTA, checkmark row, mascots.
- Unvibe: ~110px headline, heavy sans + colored italic serif ("*Make the code yours.*"), mono eyebrow, trust row ("No credit card").
- MEON: 150px headline, one word in bold red ("Slurp the *world.*"), playful mascots, sound toggle, search with Ctrl K.
- Repo Doctor: 96px headline, calm stats row.

## Two volumes: loud website, quiet app
- Website = loud: giant headlines, one bold accent word, motion, a live demo.
- App = quiet: like Claude. Mostly sans, lots of white space, one composer, few colors. Serif only for document titles and big empty-state lines.

## Typography
- Headline serif (the NYT feel), pick one:
  - Option A (closest to NYT): license ITC Cheltenham, the commercial family the NYT's custom headline font descends from. Paid web license; NYT's own cut is not available.
  - Option B (free, open license): Newsreader (bold display sizes) for headlines; Instrument Serif Italic for the accent word, like your Jaymini/Unvibe italics.
- Interface sans: Geist or IBM Plex Sans. Avoid Inter as the main face (research flags it as the generic "AI site" look).
- Mono for labels, form numbers and IDs: IBM Plex Mono or Geist Mono.
- Website sizes: 120–160px hero on desktop, 52–64px on phones, line-height ~0.92, letter-spacing about −0.03em.
- Never use Anthropic's or NYT's own font files (proprietary; pirated "free" copies circulate).

## Headline ideas (big words)
- "Paperwork, *handled.*"
- "Your business, *in good order.*"
- "Every form. *One link.*"
- "Stop re-typing your EIN."
- "We remember. *You approve.*"

## Color
- Mostly black ink on white paper.
- One signature accent used boldly on the accent word and main button (like Unvibe's purple, MEON's red). Pick one:
  - Signal blue (trust, finance feel)
  - Harbor green (on-brand "shipshape", calm)
  - Stamp red (bold, passport-stamp energy; keep red away from error states)
- Status colors (green/amber/red) always with an icon and a word.
- Do not use Claude's cream + clay orange or its spark mark; no purple-to-blue gradients.

## Website structure
1. Mono eyebrow: "PAPERWORK FOR EVERY BUSINESS"
2. Giant headline with one accent word
3. One-line promise: "ShipShape remembers your business, finds the right official forms, fills them in, and keeps them current. You approve every step."
4. Two buttons: black pill "Start free" + outline "See a sample passport"
5. Checkmark row: No card · Cancel in two clicks · We never train AI on your documents · Not a law firm
6. Live demo under the hero: a form filling itself field by field, each value showing its source chip, then a "Confirmed" stamp
7. Big-word product tour, one word per block: Remembers. Finds. Fills. Shares. Reminds.
8. Mode cards: Startup · Small business · Freelancer · Contractor & insurance
9. Trust in big type: "Not a law firm. Never trains on your files. Cancel in two clicks." linking to /trust
10. Pricing (monthly and yearly side by side), Form Guides, FAQ, footer with Security · Status · Changelog · Privacy · Terms

## Fun, not childish
- Optional mascot, used sparingly (e.g. a small paper-boat or stamp character) on empty states and onboarding, never in documents.
- Satisfying moments: a stamp landing when a document is confirmed; fields filling in sequence; a "Deadlines this month" ticker.
- ⌘K search everywhere (you already do Ctrl K on MEON).
- Keep claims honest: no "100%" numbers without proof (FTC).

## The app (Claude simplicity)
- Left sidebar: New task, then Home · Documents · Deadlines · Business facts · Passport, then Pinned and Recent.
- Center: one composer, "What do you need to get done?", with mode-aware suggestions.
- Documents open as a clean sheet with a right "notes" rail for sources, AI labels and warnings.
- Progress as checks, not a bare percent bar: "14 of 18 checks done"; confirmed facts count, so most forms open at 70–90%.
- Warnings: specific to the document, placed above the action, three levels (blocking, inline, quiet source labels).
- Dark mode designed separately, documents stay on a white sheet.

## Study list (what to borrow)
- Claude: one composer, calm sidebar, readable answers.
- Linear: speed, ⌘K, keyboard-first, crisp type.
- Mercury: trust through restraint, "not a bank" line next to the claim.
- Ramp / Stripe Dashboard: dense data that still feels light; shortcuts.
- Attio / Granola: friendly polish on serious tools.
- Your own sites: giant headline + italic accent, mono eyebrow, checkmark trust row.

## Not like a newspaper
Drop mastheads, datelines, double rules and multi-column layouts. Keep only the serif headline voice, big confident type and black-and-white restraint.

## Decisions for the founder
1. Headline font: Option A (licensed Cheltenham) or Option B (free Newsreader + Instrument Serif).
2. Accent color: signal blue, harbor green or stamp red.
3. Mascot: yes (sparingly) or no.
4. Hero headline: pick from the list or write your own.
