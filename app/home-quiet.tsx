import Link from "next/link";
import { SiteFooter, SiteHeader, type Status } from "@/components/site";
import { SiteIntro } from "@/components/site-intro";
import { SiteReveals } from "@/components/site-reveals";
import { SiteTour, type TourScene } from "@/components/site-tour";
import { PLANS } from "@/lib/plans";
import { faqItems } from "./faq-content";
import { PITCH, STEPS, TRUST, WHO, capabilities } from "./home-content";

/**
 * The home page in Quiet, site direction A (row 520, after spacefs.com; Design notes 2026-11-05): a centred two-tone
 * hero, a pinned three-scene tour of the sample app, the four things it does beside a sticky heading, an ink band for
 * what it is not, Deadlines, who it's for, where things stand, pricing, questions, and the papers fanned over the last
 * line. Every screenshot is the app's own (scripts/site-shots.py), with its size in the markup so nothing shifts.
 */

const TOUR: TourScene[] = [
  {
    title: "Paste the ask",
    body: "Their email or checklist, as sent.",
    page: "Check a request",
    alt: "Check a request in the sample: Northwind Builders' message pasted in, asking for a W-9 and a signed NDA.",
    desk: { src: "/site/tour-ask.webp", width: 1920, height: 1200 },
    phone: { src: "/site/tour-ask-sm.webp", width: 732, height: 840 },
  },
  {
    title: "See what you have",
    body: "You have it, Expires soon, Expired, or Not in your documents.",
    page: "Check a request",
    alt: "The answer in the sample: the request asks for 2 documents, found by matching document names, not by AI. Form W-9: You have it. NDA: You have it.",
    desk: { src: "/site/tour-answer.webp", width: 1920, height: 1200 },
    phone: { src: "/site/tour-answer-sm.webp", width: 732, height: 931 },
  },
  {
    title: "Send one link",
    body: "It stops after 7, 30 or 90 days, and you see each time it's opened.",
    page: "Passport",
    alt: "Passport in the sample: the link Northwind Builders onboarding (sample), 3 documents, opened 3 times, Working.",
    desk: { src: "/site/tour-link.webp", width: 1920, height: 1200 },
    phone: { src: "/site/tour-link-sm.webp", width: 732, height: 581 },
  },
];

const PAPERS: { src: string; alt: string }[] = [
  { src: "/site/paper-w9.webp", alt: "" },
  { src: "/site/paper-nda.webp", alt: "" },
  { src: "/site/paper-coi.webp", alt: "" },
];

/** Who it's for, each with the first page of the paper they're asked for most. */
const WHO_PAPER: Record<string, { src: string; alt: string }> = {
  Contractors: { src: "/site/paper-coi.webp", alt: "The first page of the sample's certificate of liability insurance for Harbor Plumbing LLC." },
  Freelancers: { src: "/site/paper-nda.webp", alt: "The first page of the sample's Mutual NDA on Common Paper's terms." },
  "Restaurants and shops": { src: "/site/paper-w9.webp", alt: "The first page of the IRS Form W-9, filled for the made-up Harbor Plumbing LLC." },
};

/** The four lines of the ink band (Design: C's band, from TRUST as reviewed). */
const BAND = new Set(["tax-ids", "storage", "walls", "no-ads"]);

/**
 * The FAQ's questions the home page repeats; the rest are on /faq. Not "When can I use it for real documents?": its
 * answer points to the sample's waitlist, and the home page mentions no waitlist while preview-only (row 525).
 */
const HOME_FAQ = new Set([
  "What is ShipShape?",
  "Is ShipShape a law firm? Does it give legal advice?",
  "Who can see my documents?",
  "How are passport links protected?",
  "Does ShipShape use AI?",
  "Can I get my data out, or delete it?",
]);

const TONE: Record<Status, "ok" | "wait" | "todo"> = { "Works today": "ok", "Awaiting setup": "wait", Planned: "todo" };

function QuietStatus({ status }: { status: Status }) {
  return (
    <span className="sq-status" data-tone={TONE[status]}>
      <span className="sq-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

/** A heading's two lines: the claim in ink, the second line in the softer grey (4.73:1 on the page). */
function TwoTone({ first, second }: { first: string; second: string }) {
  return (
    <>
      {first} <span className="sq-soft">{second}</span>
    </>
  );
}

export function HomeQuiet({ docs, live, ai, accounts }: { docs: boolean; live: boolean; ai: boolean; accounts: boolean }) {
  const start = docs ? "Sign in or try the sample" : "Try the sample";
  const note = docs
    ? "Sign in to keep your own documents, or try a sample business with made-up ones."
    : "Preview: a sample business with made-up documents. Real accounts open after our security review.";
  return (
    <div className="site-quiet sq-home">
      <SiteIntro />
      <SiteHeader />
      <main id="main">
        <section className="sq-hero" aria-labelledby="hero-title">
          <div className="sq-wrap sq-hero-inner">
            {!docs && (
              <p className="sq-chip sq-rise sq-rise-0">
                <span className="sq-dot" aria-hidden="true" />
                Preview, with a sample business
              </p>
            )}
            <h1 id="hero-title" className="sq-display sq-rise sq-rise-1">
              <TwoTone first="They ask for paperwork." second="You send one link." />
            </h1>
            <p className="sq-lead sq-rise sq-rise-2">
              Paste the customer&apos;s email. ShipShape lists what it asks for, shows what you have, and makes one link to send.
            </p>
            <div className="sq-actions sq-rise sq-rise-3">
              <Link href="/signin" className="sq-btn sq-btn-cta sq-btn-lg">
                {start}
              </Link>
              <Link href="#how" className="sq-btn sq-btn-line sq-btn-lg">
                How it works
              </Link>
            </div>
            <p className="sq-note sq-rise sq-rise-4">{note}</p>
          </div>
        </section>

        <section id="how" className="sq-section sq-tour-section" aria-labelledby="how-title">
          <div className="sq-wrap sq-center" data-reveal>
            <h2 id="how-title" className="sq-title">
              <TwoTone first="Every ask, answered." second="Without digging through email." />
            </h2>
          </div>
          <SiteTour scenes={TOUR} />
          <p className="sq-wrap sq-note sq-center">Screens from the sample workspace: a made-up business and its documents.</p>
        </section>

        <section className="sq-wrap sq-section sq-rows" aria-labelledby="keep-title">
          <div className="sq-rows-head" data-reveal>
            <h2 id="keep-title" className="sq-title">
              <TwoTone first="Keep, fill, share." second="Stay current." />
            </h2>
            <p className="sq-lead">{PITCH}</p>
          </div>
          <div data-reveal>
            <ol className="sq-rows-list">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="sq-rows-n">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="sq-h2">{s.title}</h3>
                  <p className="sq-body">{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="sq-cards2">
              {WHO.flatMap((w) =>
                w.page
                  ? [
                      <Link key={w.who} href={w.page.href} className="sq-card sq-card-link">
                        <span>
                          <span className="sq-meta">{w.who}</span>
                          <span className="sq-card-line">{w.page.label}</span>
                        </span>
                        <span className="sq-arrow" aria-hidden="true">
                          →
                        </span>
                      </Link>,
                    ]
                  : [],
              )}
            </div>
          </div>
        </section>

        <section className="sq-wrap sq-section" aria-labelledby="trust-title">
          <div className="sq-band" data-reveal>
            <div>
              <p className="sq-band-label">Built to be trusted with tax forms</p>
              <h2 id="trust-title" className="sq-title">
                Software, <span className="sq-band-soft">not a law firm.</span>
              </h2>
              <p className="sq-lead">
                ShipShape fills facts into official and openly licensed documents and tells you where each one comes from. It never writes or
                changes the clauses, and it never tells you which document you need. You review every field, and you decide.
              </p>
            </div>
            <ul className="sq-band-list">
              {TRUST.filter(({ key }) => BAND.has(key)).map(({ key, text }) => (
                <li key={key}>
                  <svg className="sq-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sq-wrap sq-section sq-center" aria-labelledby="due-title">
          <div data-reveal>
            <h2 id="due-title" className="sq-title">
              <TwoTone first="See what's due." second="Before it lapses." />
            </h2>
            <p className="sq-lead">Expiry and renewal dates become deadlines, and a calendar file you can add to Google, Apple or Outlook Calendar.</p>
          </div>
          <div className="sq-wall" data-reveal>
            <div className="sq-win">
              <div className="sq-win-bar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>Deadlines</span>
              </div>
              <picture>
                <source media="(max-width: 899px)" srcSet="/site/deadlines-sm.webp" width={732} height={512} />
                <img
                  className="sq-win-shot"
                  src="/site/deadlines.webp"
                  width={1920}
                  height={1200}
                  loading="lazy"
                  decoding="async"
                  alt="Deadlines in the sample: a city business license that lapsed 12 days ago, and a certificate of insurance that expires in 21 days."
                />
              </picture>
            </div>
          </div>
        </section>

        <section className="sq-wrap sq-section" aria-labelledby="who-title">
          <div data-reveal>
            <h2 id="who-title" className="sq-title">
              <TwoTone first="Every new customer" second="asks for the same papers." />
            </h2>
          </div>
          <ul className="sq-cases">
            {WHO.map((w) => (
              <li key={w.who} className="sq-case" data-reveal>
                <div className="sq-case-well">
                  <img src={WHO_PAPER[w.who]?.src} width={650} height={845} loading="lazy" decoding="async" alt={WHO_PAPER[w.who]?.alt ?? ""} />
                </div>
                <div className="sq-case-text">
                  <h3 className="sq-h2">{w.who}</h3>
                  <p className="sq-body">{w.asks}</p>
                  {w.page && (
                    <Link href={w.page.href} className="sq-link-arrow">
                      {w.page.label}
                      <span aria-hidden="true"> →</span>
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="sq-lead sq-after">Today that&apos;s email attachments, &ldquo;can you resend the new certificate?&rdquo;, and expired documents nobody noticed.</p>
        </section>

        <section className="sq-wrap sq-section" aria-labelledby="stand-title">
          <div data-reveal>
            <p className="sq-label">Where things stand</p>
            <h2 id="stand-title" className="sq-title">
              <TwoTone first="What works today," second="and what doesn't yet." />
            </h2>
          </div>
          <ul className="sq-capabilities sq-card" data-reveal>
            {capabilities(docs, live, ai).map((c) => (
              <li key={c.title}>
                <div className="sq-capability-head">
                  <h3 className="sq-capability-title">{c.title}</h3>
                  <QuietStatus status={c.status} />
                </div>
                <p className="sq-body">{c.body}</p>
              </li>
            ))}
          </ul>
          {!docs && <p className="sq-note sq-after">&ldquo;Works today&rdquo; means in the sample workspace.</p>}
        </section>

        <section className="sq-wrap sq-section sq-center" aria-labelledby="price-title">
          <div data-reveal>
            <h2 id="price-title" className="sq-title">
              <TwoTone first="Free to start." second={`$${PLANS.pro.price} a month for Pro.`} />
            </h2>
            <p className="sq-lead">
              Free keeps {PLANS.free.documents} active documents and {PLANS.free.passports} passport link open at a time. Pro removes the limits and adds
              deadline reminders on your Deadlines page.{" "}
              <Link href="/pricing" className="sq-link">
                See pricing
              </Link>
              .
            </p>
          </div>
          <div className="sq-plans">
            <div className="sq-card sq-plan" data-reveal>
              <h3 className="sq-label">{PLANS.free.name}</h3>
              <p className="sq-price">$0</p>
              <ul className="sq-ticks">
                <li>{PLANS.free.documents} active documents</li>
                <li>{PLANS.free.passports} passport link open at a time</li>
                <li>W-9 and NDA from your business facts</li>
                <li>Deadlines and calendar file</li>
              </ul>
              <Link href="/signin" className="sq-btn sq-btn-line sq-btn-lg">
                {docs ? "Sign in" : "Try the sample"}
              </Link>
            </div>
            <div className="sq-card sq-plan" data-reveal>
              <h3 className="sq-label">{PLANS.pro.name}</h3>
              <p className="sq-price">
                ${PLANS.pro.price} <small>a month</small>
              </p>
              <ul className="sq-ticks">
                <li>No limit on documents or open links</li>
                <li>Reminders 90, 30 and 7 days ahead, on the Deadlines page</li>
                <li>Everything in Free</li>
              </ul>
              <Link href="/signin" className="sq-btn sq-btn-cta sq-btn-lg">
                {docs ? "Sign in" : "Try the sample"}
              </Link>
            </div>
          </div>
        </section>

        <section className="sq-wrap sq-section sq-faq" aria-labelledby="faq-title">
          <div data-reveal>
            <h2 id="faq-title" className="sq-title">
              Common questions
            </h2>
            <p className="sq-lead">
              More on the{" "}
              <Link href="/faq" className="sq-link">
                questions page
              </Link>
              .
            </p>
          </div>
          <div data-reveal>
            {faqItems(docs, accounts)
              .filter(({ q }) => HOME_FAQ.has(q))
              .map(({ q, a }, i) => (
                <details key={q} className="sq-faq-item" open={i === 0}>
                  <summary>{q}</summary>
                  <div className="sq-body">{a}</div>
                </details>
              ))}
          </div>
        </section>

        <section className="sq-wrap sq-section sq-center sq-closing" aria-labelledby="close-title">
          <div className="sq-fan" data-reveal>
            {PAPERS.map((p) => (
              <img key={p.src} src={p.src} width={650} height={845} loading="lazy" decoding="async" alt={p.alt} />
            ))}
          </div>
          <div data-reveal>
            <h2 id="close-title" className="sq-title">
              <TwoTone first="Ready for the next ask?" second="Have it all in one place." />
            </h2>
            <div className="sq-actions">
              <Link href="/signin" className="sq-btn sq-btn-cta sq-btn-lg">
                {docs ? "Sign in or create an account" : "Try the sample"}
              </Link>
            </div>
            <p className="sq-note">{note}</p>
          </div>
        </section>
      </main>
      <SiteFooter />
      <SiteReveals />
    </div>
  );
}
