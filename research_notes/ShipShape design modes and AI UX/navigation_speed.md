# Navigation, Information Architecture and Perceived Speed for ShipShape (AI paperwork app for small businesses)

Research date: 2026-10-12. About 15 tool calls. Sources fetched in full this session: TestingCatalog (Claude sidebar), GOV.UK Service Manual (form structure), GOV.UK Design System (check answers), NN/g (skeleton screens), Superhuman blog (command palette). Everything else comes from search-result summaries and should be checked against the primary source before anyone quotes exact numbers. The Gaps sections mark claims that rest only on the researcher's prior knowledge (unverified).

## 1. How leading AI and productivity apps structure navigation, and what makes them feel simple

### Takeaway
The verified pattern is a slim left sidebar with three parts: one primary "new / do" action, a small set of fixed destinations or pinned items (Projects, Shortcuts), then recency-ordered history. A single keyboard command palette (⌘K) runs everything for power users. Claude (testing as of July 2026) and Stripe (since May 2024) have both moved toward "pinned + recent" sidebars and away from deep menus. The command palette is the main tool for keeping the visible UI small while still reaching every feature.

### Cited Findings
- **Claude (as of July 2026, test build, unconfirmed rollout):** Anthropic is testing Projects in the left sidebar, placed "above recent conversations." Users can pin and sort projects and choose what shows there, so projects become one click away instead of on a separate page. The Chat/Cowork mode switcher moved into the prompt bar on July 7 and is being tested at the top of the window, which mirrors ChatGPT's top-left mode switcher. The article notes Anthropic has rolled back underperforming UI experiments before. — [TestingCatalog, 20 Jul 2026](https://www.testingcatalog.com/anthropic-tests-new-placement-for-projects-on-claude-desktop/)
- **Claude (secondary, commercial guide):** A March–April 2026 redesign reportedly put Skills, Connectors and Plugins into one "Customize" browse-and-install surface reached from the sidebar. This means setup and configuration live in a separate area, not in the main nav. — [beginnersinai.org overview](https://beginnersinai.org/?p=22829) (secondary, treat with caution)
- **Claude chats:** Users can rename a chat and add it to a project directly from the sidebar. History items are managed in place rather than on a separate management page. — [Guideflow: rename chat](https://www.guideflow.com/tutorial/how-to-rename-a-chat-from-the-sidebar-in-claudeai); [Guideflow: add chat to project](https://www.guideflow.com/tutorial/how-to-add-a-chat-to-a-project-from-the-sidebar-in-claudeai)
- **Stripe Dashboard (May 2024 update):** The sidebar was reorganized around transactions, products and customers. Billing and Connect moved into a new "Products" section. A "Shortcuts" area was added for pinned pages and recently visited pages. — [Stripe Support: Dashboard update May 2024](https://support.stripe.com/questions/dashboard-update-may-2024)
- **Stripe docs:** "Use the Shortcuts section to display your pinned and most recently visited pages." Visited pages are added automatically and can then be pinned. Pressing "?" lists keyboard shortcuts. — [Stripe Docs: Dashboard](https://stripe.com/en-pl/docs/dashboard)
- **Stripe (third-party):** The 2024 sidebar "has minimized the number of links" and shows recent tabs automatically. — [WP Simple Pay: Stripe dashboard updates 2024](https://wpsimplepay.com/?p=874709)
- **Superhuman command palette principles (Oct 2021, older but still the canonical write-up):**
  - The same shortcut must open the palette "wherever your user is in your app," and the same shortcut closes it, with focus restored to where it was.
  - The palette shows each command's shortcut so users "learn the shortcut for next time."
  - Search needs fuzzy matching, so "opn" and "oepn" still find "Open."
  - Commands need aliases or synonyms. Results show the preferred name with the matched alias, e.g. "Mark Done (Archive)."
  - Each command gets a default ranking, and results boost based on context (e.g. a draft is open).
  - The goal is that "the top option is what the user is looking for."
  - Source: [Superhuman blog](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- **Linear:** Its palette is reportedly built on the open-source `cmdk` library, which shadcn's Command component also wraps. A design analysis attributes Linear's feel to an "obsessive focus on interactions under 100ms," but cites no source for that number. — [925studios Linear breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026); [blakecrosley.com Linear guide (DE)](https://blakecrosley.com/de/guides/design/linear) (both secondary)
- **Superhuman speed claim:** A design analysis says Superhuman tunes key-repeat to 65 ms against the 100 ms macOS default. That is input tuning, not palette latency. — [blakecrosley.com Superhuman guide (FR)](https://blakecrosley.com/fr/guides/design/superhuman) (secondary)
- **Counterpoint:** One opinion piece argues that the keyboard-first and optimistic-UI speed advantage shrinks on mobile networks. — [DEV: Cmd+K is the new hamburger menu](https://dev.to/thekitbase/cmdk-is-the-new-hamburger-menu-why-command-palettes-are-taking-over-saas-81d) (opinion)

### Inferences
- **Recommended shell for ShipShape** ("as simple as Claude"):
  - A collapsible left sidebar with one primary button, "New task" (or "Ask ShipShape"). It opens a single composer that can start any job: find a form, fill a PDF, draft a document, add a deadline.
  - At most 4–5 fixed destinations: Home/Inbox, Deadlines, Documents, Business profile ("What ShipShape knows"), Passport.
  - A "Pinned" group (pinnable documents and filings, like Stripe Shortcuts and Claude pinned Projects).
  - "Recent" history ordered by recency. Rename, pin and move should work inline, as in Claude.
  - Settings, billing and integrations go behind the account menu at the bottom, the same way Claude moved configuration into "Customize."
- **Use a command palette instead of extra navigation.** ⌘K should open the same palette everywhere. It should mix three things: navigation ("Go to Deadlines"), actions ("Fill W-9", "Add deadline") and search across facts, documents and forms. It needs aliases for small-business vocabulary (e.g. "EIN" ↔ "Employer ID", "1099" ↔ "contractor form"), and it should display shortcuts. Most small-business owners won't use the keyboard, so put a visible search box or button in the sidebar that opens the same palette.
- **Use "Projects" as a mental model, framed as Businesses or Entities.** Claude's Projects hold context (files plus instructions). That maps to ShipShape's business profile and memory. If a user runs several businesses, a top-of-sidebar business switcher (like a workspace switcher) is simpler than nested projects.
- **Don't build a mode switcher at launch.** Claude and ChatGPT use them because they have different product surfaces (Chat and Cowork). ShipShape should infer intent from what the user types (e.g. "fill", "draft", "remind me") rather than make users pick a mode. Add one later only if research shows confusion.

### Gaps
- I did not verify current (Oct 2026) navigation for ChatGPT, Perplexity, Notion AI, Linear, Harvey or Mercury from primary sources this session. The search for Mercury returned only unrelated Mercury Marine results.
- From prior knowledge (unverified, may be out of date):
  - ChatGPT uses a left sidebar with New chat, Search chats, GPTs/Projects and history.
  - Perplexity uses a left rail with Home, Discover, Spaces and Library.
  - Harvey organizes around Assistant, Vault (document collections) and Workflows.
  - Mercury uses a fixed left sidebar (Home, Transactions, Payments, Cards, Accounting) with ⌘K search.
  - Notion AI is reached from the sidebar and with the space key in pages.
  - The report writer should present these as illustrative, not cited.
- I found no quantitative evidence that sidebar beats top nav for AI apps. The convergence on sidebars is observed practice, not a measured result.

## 2. Onboarding that asks for a persona or mode up front: examples and effect on activation

### Takeaway
Short persona or use-case questions at signup, used to tailor empty states, checklists and templates, are associated with activation gains in vendor case studies: a 4–6% relative lift at Make, 21% at MYOB, and 71% at Guru. All of these are vendor-published with no controls disclosed. Treat them as directional evidence that personalization helps, not as proof that asking the question by itself helps.

### Cited Findings
- **Make (via Candu):** An onboarding survey plus personalized empty states and a resource hub produced a "relative increase in activation rates of 4% to 6% across different user groups." — [Candu case study: Make](https://www.casestudies.com/company/candu/case-study/make-boosts-activation-46-with-candu) (vendor)
- **Guru (via Candu):** Role-based decision-tree onboarding and in-app messaging gave a 71% increase in user activation and a 51% lift in conversion. — [Candu case study: Guru](https://www.casestudies.com/company/candu/case-study/guru-boosts-activation-by-71-with-candu) (vendor)
- **MYOB (accounting software for small businesses, the closest analogue to ShipShape):** Personalized onboarding increased new-user activation by 21%. The baseline setup rate had hovered around 14%. — [Appcues customer story: MYOB](https://www.appcues.com/customer-stories/how-myob-increased-new-user-activation-by-21-with-thoughtful-personalized-onboarding) (vendor)
- **Canva:** Canva asked new users what they wanted to create and tested a personalized interstitial. Asking was cheaper than building intent tracking. No lift figure was available in the summary. — [Userpilot: improve activation rate](https://userpilot.com/blog/improve-activation-rate/) (secondary)
- **Sonic Jobs:** Replacing a generic welcome email with 15 specific job links reportedly doubled activation. This is a single anecdote. — [Userpilot](https://userpilot.com/blog/improve-activation-rate/)

### Inferences
- **Ask one or two questions, each of which changes what the user sees.** For example:
  1. "What best describes you?" Options: Sole trader/freelancer, Small business with staff, Just starting a company, Nonprofit.
  2. "Where do you operate?" (jurisdiction). This one materially changes which forms and deadlines apply.
- **Use the answers immediately.** Pre-select relevant form libraries, seed the Deadlines view with likely obligations (marked as suggestions to confirm), and set the business-profile fields to collect.
- **Make every step skippable and editable later** in the business profile. Counting the answers as the first saved "business facts" shows the memory feature at work from minute one.
- **Activation metric for ShipShape:** "first real artifact produced" (a filled form, a drafted document or a confirmed deadline), not "profile completed."

### Gaps
- The prompt named Notion, HubSpot, Gusto, QuickBooks, Stripe Atlas and TurboTax. I did not retrieve primary sources on their current persona questions or any activation data.
- From prior knowledge (unverified):
  - Notion asks whether use is for personal use, team or school.
  - HubSpot asks about role and goals.
  - QuickBooks asks about business type and what you want to do.
  - TurboTax asks life-situation questions to choose a product tier.
- I found no peer-reviewed or controlled study isolating the effect of an up-front persona question on activation.

## 3. Perceived performance: latency thresholds, streaming, skeletons, optimistic UI, and how AI apps show progress

### Takeaway
Design to three budgets:
- **Under 0.1 s:** feels instant. Local UI, palette filtering and optimistic updates must hit this.
- **Under 0.4–1 s:** keeps the user's flow (the Doherty threshold). Show some acknowledgement within 400 ms.
- **Under 10 s:** keeps attention. Anything longer needs explicit progress or an estimate, or should run in the background with a notification.

Streaming the first tokens and showing named step lists are how AI apps keep long jobs under the "feels responsive" bar.

### Cited Findings
- **Nielsen's three limits, from Miller 1968:**
  - 0.1 s feels instantaneous, so no feedback is needed beyond showing the result.
  - At 1 s the user notices the delay, but their flow of thought stays intact.
  - 10 s is the limit for keeping attention on the dialogue. Longer delays need progress feedback, and users will want to do other tasks.
  - Source: [NN/g video: 3 response time limits](https://www.nngroup.com/videos/3-response-time-limits-interaction-design/); [jmduke.com copy of Nielsen's text](https://jmduke.com/posts/response-times.html)
- **Doherty threshold:** Doherty & Thadani (IBM Systems Journal, 1982) set a 400 ms response target, replacing the earlier 2 s standard. Productivity rises when the system responds fast enough "that ensures that neither has to wait on the other." Practitioners recommend showing a loading state within 400 ms even when the full result takes longer. — [Laws of UX: Doherty Threshold](https://lawsofux.com/doherty-threshold/index.md); [O'Reilly, Laws of UX ch. 10](https://oreilly.com/library/view/laws-of-ux/9781492055303/ch10.html)
- **NN/g on skeleton screens** (published June 2023, reviewed Sept 2026):
  - Under 1 s, show no skeleton or spinner, because a flash feels rushed.
  - From 2 to 10 s, use spinners for a single module. Skeletons are acceptable for full-page loads under 10 s.
  - Over 10 s, "requires an explicit estimation of duration," meaning a progress bar.
  - Use skeletons only for full-page loads, with placeholders that mirror the real layout. Frame-only skeletons can look broken.
  - Shimmer or pulse animation can distract or cause accessibility issues.
  - Skeletons complement real performance work; they don't replace it.
  - Source: [NN/g: Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/)
- **Undo windows:** One practitioner suggests 5–10 s for undo windows. This is opinion, not a study. — [DEV: confirmation vs undo vs soft delete](https://dev.to/137foundry/how-to-choose-between-confirmation-dialogs-undo-windows-and-soft-delete-patterns-1opj)

### Inferences
- **ShipShape latency budget:**

| Interaction | Target | Technique |
|---|---|---|
| Sidebar nav, palette open, filtering, toggles | <100 ms | Client-side state, prefetch on hover/focus, local index of recent docs and facts |
| Send a message / start a job | <400 ms visible acknowledgement | Optimistic insert of the user message plus a "ShipShape is working" row |
| AI answer | First token <1 s | Stream tokens; show the plan or steps first |
| Form search across official sources | <1 s first results | Show cached/known forms instantly, then append live results with their source |
| PDF fill or long draft (10 s+) | Named steps, then background | Step list ("Found form SS-4 on irs.gov ✓ → Mapped 14 of 18 fields from your profile ✓ → 4 fields need you"), then notify when done |

- **"Feels smart" cues:**
  - State which remembered facts were used ("Used: legal name, EIN, address from your profile").
  - Show source citations next to official forms as they appear.
  - Show a short visible plan before acting.
  - These make the agent's competence visible and also make waits feel productive.
- **Avoid fake progress:**
  - Use determinate percentages only when the work really is countable (e.g. fields mapped).
  - Otherwise use named steps.
  - Respect `prefers-reduced-motion` for shimmer and typing animations.

### Gaps
- I did not fetch primary documentation on how Claude, ChatGPT or Perplexity render thinking indicators, step lists or citations. From prior knowledge (unverified): Claude and ChatGPT show collapsible "thinking"/reasoning sections and tool-use steps; Perplexity shows search steps and source cards before and alongside the streamed answer.
- I found no controlled study quantifying how much streaming improves perceived speed or satisfaction for LLM responses.
- The cited Mejtoft et al. (2018) skeleton-screen study's results were not retrieved.

## 4. Multi-step task UX and progress indicators: do "70% complete" bars help or hurt?

### Takeaway
Evidence on progress bars is mixed to negative:
- They help only when progress looks faster than users expect. They hurt completion when progress looks slow, e.g. in long questionnaires.
- Intermittent feedback keeps most of the benefit while limiting the discouraging effect.
- GOV.UK's "one thing per page" plus a "check answers" summary is the best-documented government pattern for complex, unfamiliar tasks.

For ShipShape, use section- or step-based progress ("Step 2 of 4: Owner details"), not a raw percentage, and front-load the easy, pre-filled parts.

### Cited Findings
- **Conrad, Couper, Tourangeau & Peytchev (2010), "The impact of progress indicators on task completion," *Interacting with Computers*:**
  - Feedback helped when progress seemed faster than expected.
  - It did not reliably raise completion overall.
  - It lowered completion when progress seemed slower than expected.
  - Intermittent feedback kept most of the benefit while reducing the cost of discouraging feedback.
  - Source: [PMC2910434](https://pmc.ncbi.nlm.nih.gov/articles/PMC2910434); [RTI](https://www.rti.org/publication/impact-progress-indicators-task-completion) (older research, still the main reference)
- **Matzat, Snijders & van der Horst (2009):** Among 2,460 Dutch panel respondents, progress indicators had a negative or no effect on completion, depending on questionnaire length. — [PDF](https://www.onlineumfragen.com/pic/matzat_progress_indicators.pdf)
- **Literature review:** Studies show positive, negative or null effects of progress indicators on breakoff. — [IU ScholarWorks review](https://scholarworks.iu.edu/iuswrrest/api/core/bitstreams/c8dd1de9-08e2-4bf3-a5f0-1e4e30207eb4/content)
- **SurveyMonkey practitioner test:** Top-placed bars showing percent complete lowered completion in both short and long surveys. Bottom-placed bars helped slightly, by a few points. — [SurveyMonkey Curiosity](https://www.surveymonkey.com/curiosity/progress-bars-good-bad-survey-survey-says/) (practitioner, not peer-reviewed)
- **GOV.UK Service Manual, "one thing per page":**
  - Each page holds one piece of information, one decision or one question.
  - This helps users understand what's asked, get through unfamiliar processes, use mobile, and "recover easily from form errors."
  - It enables autosave per step, analytics per question, and easier branching.
  - "User research will tell you when you can merge pages together." Internal or expert users may suit combined pages.
  - Source: [GOV.UK Service Manual: Form structure](https://www.gov.uk/service-manual/design/form-structure)
- **GOV.UK "Check answers" pattern:**
  - Use one check page before confirmation for small to medium transactions, or one at the end of each section for large ones (test first).
  - Each section gets a "Change" link with hidden screen-reader text.
  - After a change, return users to the check page rather than making them redo the flow.
  - Show skipped optional answers as "Not provided."
  - Make clear the transaction isn't complete until confirmed.
  - Label the button with the specific action (e.g. "Send your claim form").
  - Source: [GOV.UK Design System: Check answers](https://design-system.service.gov.uk/patterns/check-answers/)

### Inferences
- **For PDF fill-in and filing prep, use a hybrid of the two patterns:**
  - The AI pre-fills everything it knows from the business profile.
  - The user sees only the "one thing per page" questions for missing or uncertain fields (e.g. "4 things need you").
  - Then a check-answers page grouped by form section, with Change links and "From your profile" badges.
  - Progress reads as "3 of 4 questions left," which tends to look faster than expected, the condition under which Conrad et al. found indicators help.
- **Avoid a top "% complete" bar on long flows.** If you use a bar at all, make it section-based and intermittent, and count pre-filled fields as done so early progress looks fast.
- **Expert mode:** Following GOV.UK's note on merging pages for frequent users, offer a "show all fields" single-page view of the PDF for returning users and accountants.

### Gaps
- I did not retrieve primary sources on TurboTax, Stripe Atlas, Gusto or Typeform progress UX, or any completion data for them. From prior knowledge (unverified): TurboTax uses section-based nav with a summary; Typeform shows one question at a time with an optional progress bar; Stripe Atlas uses a checklist-style application.
- I found no AI-specific study on progress indicators for agent-run tasks.

## 5. Confirmation, review and warning design that avoids warning fatigue

### Takeaway
Warnings habituate fast. fMRI and eye-tracking show attention to repeated warnings drops sharply, even within a week, and users often don't perceive a warning before clicking past it. To keep warnings effective:
- Reserve warning styling for real legal or financial consequences, as GOV.UK does.
- Vary or make specific the warnings that must be noticed (polymorphic warnings resist habituation).
- Replace low-risk confirmations with undo.
- Make review steps quick by showing only what changed or what is uncertain.

### Cited Findings
- **Vance, Jenkins, Anderson et al. (MIS Quarterly 2018), "Tuning out security warnings":**
  - In a five-day fMRI study, attention to warnings declined over time but partly recovered between workdays.
  - Polymorphic warnings, which change their appearance, substantially reduced habituation.
  - In a 3-week field study of app-permission warnings, adherence fell more slowly with polymorphic warnings.
  - Source: [MISQ abstract](https://misq.org/tuning-out-security-warnings-a-longitudinal-examination-of-habituation-through-fmri-eye-tracking-and-field-experiments.html); [MISQ PDF](https://misq.umn.edu/pub/skin/frontend/default/misq/pdf/V42I2/14124_RA_VanceJenkins.pdf)
- **Anderson, Vance et al. (JMIS 2016):** Habituation is a major reason warnings fail. An fMRI study (n=25) found polymorphic warnings resisted habituation in attention-related brain regions. A mouse-tracking experiment (n=80) supported this. — [BYU ScholarsArchive](https://scholarsarchive.byu.edu/facpub/1955); [Vance, Cambridge SHB 2017 slides](https://www.cl.cam.ac.uk/events/shb/2017/vance1.pdf)
- **Popular summary:** Eye tracking and fMRI suggest people often don't perceive security warnings before clicking past them. — [Boing Boing (2018)](https://boingboing.net/2018/06/15/attentional-tragic-commons.html) (secondary)
- **GOV.UK Warning text component:**
  - Use it to warn "about something important, such as legal consequences of an action, or of inaction."
  - Department design systems reserve it for genuine risks because overuse weakens it.
  - In one GOV.UK design history, the warning was placed above the start button because users don't read text below start buttons.
  - Source: [GOV.UK Design System: Warning text](https://design-system.service.gov.uk/components/warning-text); [DWP design system](https://design-system.dwp.gov.uk/design-for/instruction/examples); [DfE design history](https://design-histories.education.gov.uk/connect-families-to-support/giving-a-warning-on-connect-families-to-support-start-page)
- **Confirm or undo:**
  - Users habitually click confirm without reading. Visible undo is proposed instead (relayed from Smashing Magazine).
  - Overuse causes "dialog fatigue."
  - Reserve confirmations for high-risk, irreversible actions.
  - An aggregator notes that no controlled studies directly compare undo and confirm outcomes, so this is expert consensus.
  - Source: [W3C COGA list](https://lists.w3.org/Archives/Public/public-cognitive-a11y-tf/2020Apr/0059.html); [UX Planet: confirmation dialogs](https://uxplanet.org/confirmation-dialogs-how-to-design-dialogues-without-irritation-7b4cf2599956); [Andy Matuschak: prefer undo to confirmation](https://notes.andymatuschak.org/zXH4ASvHNz488hCNgrBjQJK); [DEV: confirm vs undo vs soft delete](https://dev.to/137foundry/how-to-choose-between-confirmation-dialogs-undo-windows-and-soft-delete-patterns-1opj)

### Inferences
- **Use a three-tier warning system for drafted documents and filled forms:**
  1. **Blocking (rare):** Legal or financial consequence, irreversible, or external send/submit. Use GOV.UK-style warning text with specific consequence wording (e.g. "Filing this with the wrong EIN can delay your registration"), placed above the action button. Require an explicit, specific action label ("Send to client", not "OK").
  2. **Inline flags (common):** AI-uncertain fields or clauses get a subtle badge next to the field ("Check: we guessed this from your 2025 return"). Collect them into a "3 things to check" list. Don't use modals.
  3. **Info (ambient):** Provenance chips ("From your profile", "From irs.gov, updated Mar 2026") without warning color.
- **Keep warnings specific to resist habituation.** Each blocking warning should name the specific fact, form and consequence, so it differs each time. This is a practical form of the polymorphic finding. Never reuse a generic "AI can make mistakes, please review" banner on every output; a permanent footer disclaimer (as Claude and ChatGPT do) is enough for the general caveat.
- **Make repeated reviews quick:**
  - Show a diff of only what changed since the last approved version, or only the AI-uncertain fields.
  - Let users approve the rest in one action.
  - Remember "reviewed" status per fact, so a confirmed EIN isn't flagged again.
  - Use undo or soft delete for reversible actions (deleting a draft, editing a fact, dismissing a deadline). Reserve confirm dialogs for sending, sharing the Passport externally, submitting or deleting the account.
- **Sharing the Paperwork Passport:** Show a check-answers-style preview of exactly what the recipient will see, with per-section include/exclude and a specific button label ("Share passport with Acme Bank"). This is the place where a real review step earns its friction.

### Gaps
- I did not fetch NN/g's confirmation-dialog article or the Material Design and Apple HIG alert guidance this session. From prior knowledge (unverified): both Material and the HIG advise using alerts sparingly, only for critical information needing a decision, with specific button labels rather than "OK/Cancel." The report writer should cite these only after checking.
- I found no research specific to warning fatigue for AI-generated legal or business documents.

## 6. Accessibility basics for these patterns (WCAG 2.2)

### Takeaway
The patterns above map to a short list of WCAG 2.2 success criteria:
- Streaming, step lists, toasts and undo must be announced as status messages (4.1.3).
- The sidebar and palette need visible focus that isn't hidden by sticky bars (2.4.11).
- Click targets must be at least 24×24 CSS px (2.5.8).
- Multi-step forms must not make users re-enter information they already gave (3.3.7). ShipShape's memory feature directly satisfies this.

### Cited Findings
- WCAG 2.2 (W3C Recommendation, Oct 2023; not fetched this session, criteria per the published standard):
  - **2.4.11 Focus Not Obscured (Minimum), AA:** The focused component must not be entirely hidden by author content such as sticky headers or footers.
  - **2.4.7 Focus Visible, AA:** Keyboard focus must be visible.
  - **2.5.8 Target Size (Minimum), AA:** Targets must be at least 24×24 CSS px, with exceptions for spacing, inline links and similar.
  - **3.3.7 Redundant Entry, A:** Information already entered in the same process must be auto-populated or selectable.
  - **3.3.8 Accessible Authentication (Minimum), AA:** No cognitive-function test at login unless an alternative or assistance exists.
  - **4.1.3 Status Messages, AA:** Status messages must be programmatically determinable (e.g. ARIA live regions) without moving focus.
  - Source: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- **Superhuman:** The palette must restore focus to the previously focused element on close. — [Superhuman blog](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- **NN/g:** Shimmer and pulse loading animations can cause accessibility issues for some users. — [NN/g: Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/)
- **GOV.UK check answers:** "Change" links need visually hidden text naming what each one changes. — [GOV.UK Design System: Check answers](https://design-system.service.gov.uk/patterns/check-answers/)

### Inferences
- **Streaming AI output:**
  - Don't put the whole streaming message in an `aria-live` region, because it gets read token by token.
  - Instead, announce step changes ("Filling form… 4 fields need your input") and completion in a polite live region.
  - Let screen-reader users jump to the finished response.
- **Command palette:**
  - Use the ARIA combobox/listbox pattern, with arrow-key navigation and Esc to close.
  - Return focus to where the user was.
  - Provide a visible, clickable trigger as well as ⌘K.
- **Sidebar:** Use `nav` landmarks and `aria-current="page"` on the active item. Collapse to a drawer on mobile with a 24 px+ hit area. Make sure sticky composer bars don't cover focused fields (2.4.11).
- **Undo toasts:** Undo toasts must be announced (4.1.3), reachable by keyboard, and stay long enough to use. 5–10 s is a practitioner suggestion; consider making them persistent until dismissed for screen-reader users.
- **Use Redundant Entry (3.3.7) as a design principle:** Never ask for a fact ShipShape already knows. Show it pre-filled with "From your profile."

### Gaps
- I did not fetch W3C Understanding pages this session. The exact exception lists for 2.5.8 and 2.4.11 should be confirmed at w3.org before quoting.
- I found no ShipShape-specific accessibility research on AI streaming interfaces. Guidance on live regions for streaming LLM output is practitioner consensus, not standardized.
