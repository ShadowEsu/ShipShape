import Link from "next/link";
import { SiteFooter, SiteHeader, type Status } from "@/components/site";
import { SiteIntro } from "@/components/site-intro";
import { SiteReveals } from "@/components/site-reveals";
import { WaitlistForm } from "@/components/waitlist";
import { PLANS } from "@/lib/plans";
import { SAMPLE_REQUEST } from "@/lib/server/start-here";
import { PITCH, STEPS, TRUST, WHO, capabilities } from "./home-content";

/**
 * The home page in Quiet (Design SPEC 2026-11-04; concept SA, "The request, answered", with SB's packet as its second
 * section): the customer's email beside Check's answer to it, then the papers and the link, then how it works and the
 * rest of what the page has always said. Every screenshot is the app's own (scripts/site-shots.py), at 2x, with its
 * size in the markup so nothing shifts.
 */

const ASK_STEPS: { title: string; body: string }[] = [
  { title: "Paste the ask", body: "Their email or checklist, as sent." },
  { title: "See what you have", body: "You have it, Expires soon, Expired, or Not in your documents." },
  { title: "Send one link", body: "It stops after 7, 30 or 90 days, and you see each time it's opened." },
];

const PAPERS: { src: string; name: string; alt: string }[] = [
  { src: "/site/paper-nda.webp", name: "Mutual NDA", alt: "The first page of the sample's Mutual NDA on Common Paper's terms, Harbor Plumbing LLC and Northwind Builders (sample)." },
  { src: "/site/paper-w9.webp", name: "Form W-9", alt: "The first page of the IRS Form W-9, filled for the made-up Harbor Plumbing LLC." },
  { src: "/site/paper-coi.webp", name: "Certificate of insurance", alt: "The first page of the sample's certificate of liability insurance for Harbor Plumbing LLC." },
];

const TONE: Record<Status, "ok" | "wait" | "todo"> = { "Works today": "ok", "Awaiting setup": "wait", Planned: "todo" };

function QuietStatus({ status }: { status: Status }) {
  return (
    <span className="sq-status" data-tone={TONE[status]}>
      <span className="sq-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

export function HomeQuiet({ docs, live, ai }: { docs: boolean; live: boolean; ai: boolean }) {
  return (
    <div className="site-quiet sq-home">
      <SiteIntro />
      <SiteHeader />
      <main id="main">
        <section className="sq-wrap sq-hero" aria-labelledby="hero-title">
          <div>
            <h1 id="hero-title" className="sq-display">
              They ask for paperwork. You send exactly what they asked for.
            </h1>
            <p className="sq-lead">Paste the customer&apos;s email. ShipShape lists what it asks for, shows what you have, and makes one link to send.</p>
            <div className="sq-actions">
              <Link href="/signin" className="sq-btn sq-btn-cta sq-btn-lg">
                {docs ? "Sign in or try the sample" : "Try the sample"}
              </Link>
              <Link href="#how" className="sq-btn sq-btn-line sq-btn-lg">
                How it works
              </Link>
            </div>
            <p className="sq-note">
              {docs
                ? "Sign in to keep your own documents, or try a sample business with made-up ones."
                : "Preview: a sample business with made-up documents. Real accounts open after our security review."}
            </p>
          </div>
          <div className="sq-hero-visual">
            <figure className="sq-email">
              <figcaption className="sq-label">Email from Northwind Builders (sample)</figcaption>
              <p className="sq-email-body">{SAMPLE_REQUEST}</p>
              <p className="sq-meta">Pasted into Check a request</p>
            </figure>
            <figure className="sq-shot-panel">
              <picture>
                <source media="(max-width: 599px)" srcSet="/site/check-answer-sm.webp" width={636} height={903} />
                <img
                  className="sq-shot"
                  src="/site/check-answer.webp"
                  width={944}
                  height={486}
                  fetchPriority="high"
                  alt="Check a request's answer in the sample: the request asks for 6 documents, found by matching document names, not by AI. Form W-9: You have it. Certificate of insurance: Expires soon. Contractor license: You have it."
                />
              </picture>
            </figure>
          </div>
        </section>

        <section className="sq-wrap sq-section" data-reveal aria-labelledby="packet-title">
          <div className="sq-section-head">
            <h2 id="packet-title" className="sq-title">
              Your paperwork, in one link.
            </h2>
            <p className="sq-lead">{PITCH}</p>
          </div>
          <div className="sq-shot-panel sq-packet">
            {/* On a phone the 3 pages scroll sideways, so the row takes focus for the keyboard. */}
            <ul className="sq-papers" tabIndex={0} aria-label="First pages from the sample workspace">
              {PAPERS.map((p) => (
                <li key={p.src}>
                  <img className="sq-shot" src={p.src} width={650} height={845} loading="lazy" decoding="async" alt={p.alt} />
                  <p className="sq-paper-name">{p.name}</p>
                </li>
              ))}
            </ul>
            <div className="sq-passport">
              <picture>
                <source media="(max-width: 599px)" srcSet="/site/passport-links-sm.webp" width={636} height={338} />
                <img
                  className="sq-shot"
                  src="/site/passport-links.webp"
                  width={1952}
                  height={270}
                  loading="lazy"
                  decoding="async"
                  alt="Passport's links in the sample: Northwind Builders, 4 documents, opened 0 times; Northwind Builders onboarding (sample), 3 documents, opened 3 times. Both until Dec 4, 2026, and Working."
                />
              </picture>
              <p className="sq-meta">It stops after 7, 30 or 90 days. Turn it off any time.</p>
            </div>
          </div>
          <p className="sq-note">Screens from the sample workspace: a made-up business and its documents.</p>
        </section>

        <section id="how" className="sq-wrap sq-section" data-reveal aria-labelledby="how-title">
          <h2 id="how-title" className="sq-title">
            How it works
          </h2>
          <ol className="sq-cols sq-cols-3">
            {ASK_STEPS.map((s, i) => (
              <li key={s.title}>
                <p className="sq-label">{i + 1}</p>
                <h3 className="sq-h2">{s.title}</h3>
                <p className="sq-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="sq-wrap sq-section" data-reveal aria-labelledby="who-title">
          <h2 id="who-title" className="sq-title">
            Every new customer asks for the same papers.
          </h2>
          <ul className="sq-cols sq-cols-3">
            {WHO.map((w) => (
              <li key={w.who}>
                <h3 className="sq-h2">{w.who}</h3>
                <p className="sq-body">{w.asks}</p>
                {w.page && (
                  <Link href={w.page.href} className="sq-link">
                    {w.page.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="sq-lead">Today that&apos;s email attachments, &ldquo;can you resend the new certificate?&rdquo;, and expired documents nobody noticed.</p>
        </section>

        <section className="sq-wrap sq-section" data-reveal aria-labelledby="keep-title">
          <h2 id="keep-title" className="sq-title">
            Keep, fill, share, stay current.
          </h2>
          <ul className="sq-cols sq-cols-4">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3 className="sq-h2">{s.title}</h3>
                <p className="sq-body">{s.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="sq-wrap sq-section" data-reveal aria-labelledby="stand-title">
          <p className="sq-label">Where things stand</p>
          <h2 id="stand-title" className="sq-title">
            What works today, and what doesn&apos;t yet.
          </h2>
          <ul className="sq-capabilities">
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
          {!docs && <p className="sq-note">&ldquo;Works today&rdquo; means in the sample workspace.</p>}
        </section>

        <section className="sq-wrap sq-section sq-split" data-reveal aria-labelledby="trust-title">
          <div>
            <p className="sq-label">Built to be trusted with tax forms</p>
            <h2 id="trust-title" className="sq-title">
              Software, not a law firm.
            </h2>
            <p className="sq-lead">
              ShipShape fills facts into official and openly licensed documents and tells you where each one comes from. It never writes
              or changes the clauses, and it never tells you which document you need. You review every field, and you decide.
            </p>
          </div>
          <ul className="sq-trust">
            {TRUST.map(({ key, text }) => (
              <li key={key}>
                <svg className="sq-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="sq-wrap sq-section sq-closing" data-reveal aria-labelledby="price-title">
          <div>
            <h2 id="price-title" className="sq-title">
              Free to start. ${PLANS.pro.price} a month for Pro.
            </h2>
            <p className="sq-lead">
              Free keeps {PLANS.free.documents} active documents and {PLANS.free.passports} passport link open at a time. Pro removes the limits
              and adds deadline reminders on your Deadlines page.{" "}
              <Link href="/pricing" className="sq-link">
                See pricing
              </Link>
              .
            </p>
          </div>
          {docs ? (
            <Link href="/signin" className="sq-btn sq-btn-cta sq-btn-lg">
              Sign in or create an account
            </Link>
          ) : (
            <WaitlistForm label="Hear when real accounts open" />
          )}
        </section>
      </main>
      <SiteFooter />
      <SiteReveals />
    </div>
  );
}
