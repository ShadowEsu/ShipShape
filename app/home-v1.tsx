import Link from "next/link";
import { SiteFooter, SiteHeader, StatusLabel } from "@/components/site";
import { WaitlistForm } from "@/components/waitlist";
import { PLANS } from "@/lib/plans";
import { PITCH, STEPS, TRUST, WHO, capabilities } from "./home-content";

/** The home page before Quiet, exactly as it was: what SHIPSHAPE_UI=v1 serves. */

function SamplePassport() {
  const rows: [string, string, "ok" | "warn"][] = [
    ["Form W-9", "Current", "ok"],
    ["Certificate of liability insurance", "Expires in 21 days", "warn"],
    ["Contractor license", "Current", "ok"],
    ["Mutual NDA", "Signed", "ok"],
  ];
  return (
    <figure className="rounded-3xl border border-line bg-paper p-5 shadow-[0_20px_60px_-30px_rgb(0_0_0/0.35)] sm:p-6">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="kicker">Passport link</span>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-2">Sample</span>
      </figcaption>
      <p className="mt-3 font-serif text-2xl font-semibold">Harbor Plumbing LLC</p>
      <p className="text-sm text-ink-2">Shared with Northwind Builders until Dec 1</p>
      <ul className="mt-5 divide-y divide-line rounded-2xl border border-line">
        {rows.map(([doc, state, tone]) => (
          <li key={doc} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="min-w-0 truncate">{doc}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone === "ok" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
              <span aria-hidden="true">{tone === "ok" ? "✓ " : "◷ "}</span>
              {state}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-3">Illustration of the sample workspace. Made-up business and documents.</p>
    </figure>
  );
}

export function HomeV1({ docs, live, ai }: { docs: boolean; live: boolean; ai: boolean }) {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div className="space-y-6">
            <p className="kicker">Business paperwork, in one place</p>
            <h1 className="font-serif text-5xl leading-[0.95] font-semibold tracking-tight sm:text-7xl">Every form. One link.</h1>
            <p className="max-w-xl text-lg text-ink-2">{PITCH}</p>
            {/* The two buttons need ~356px in Geist, but its fallback font fits them in 350: at 390 wide they
                wrapped only when Geist loaded, shifting the page (CLS 0.1). Stack them below 400px from the start. */}
            <div className="flex flex-col items-start gap-3 min-[400px]:flex-row min-[400px]:flex-wrap min-[400px]:items-center">
              <Link href="/signin" className="btn-accent">
                {docs ? "Sign in or try the sample" : "Try the sample workspace"}
              </Link>
              <Link href="#how" className="btn-ghost">
                How it works
              </Link>
            </div>
            <p className="text-base text-ink-3 sm:text-sm">
              {docs
                ? "Sign in to keep your own documents, or try a sample business with made-up ones."
                : "Preview: a sample business with made-up documents. Real accounts open after our security review."}
            </p>
          </div>
          <SamplePassport />
        </section>

        <section className="border-y border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="max-w-2xl font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Every new customer asks for the same papers.</h2>
            <ul className="mt-8 divide-y divide-line rounded-2xl border border-line md:grid md:grid-cols-3 md:divide-x md:divide-y-0">
              {WHO.map((w) => (
                <li key={w.who} className="p-5">
                  <h3 className="font-semibold">{w.who}</h3>
                  <p className="mt-2 text-base text-ink-2 sm:text-sm">{w.asks}</p>
                  {w.page && (
                    <Link href={w.page.href} className="mt-3 inline-block text-base underline sm:text-sm">
                      {w.page.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-2xl text-ink-2">Today that&apos;s email attachments, &ldquo;can you resend the new certificate?&rdquo;, and expired documents nobody noticed.</p>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-20">
          <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Keep, fill, share, stay current.</h2>
          <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.title} className="space-y-2">
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-base text-ink-2 sm:text-sm">{s.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="kicker">Where things stand</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">What works today, and what doesn&apos;t yet.</h2>
            <ul className="mt-8 grid gap-3 md:grid-cols-2">
              {capabilities(docs, live, ai).map((c) => (
                <li key={c.title} className={`rounded-2xl border border-line p-4 ${c.status === "Planned" ? "bg-canvas" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{c.title}</h3>
                    <StatusLabel status={c.status} />
                  </div>
                  <p className="mt-1 text-base text-ink-2 sm:text-sm">{c.body}</p>
                </li>
              ))}
            </ul>
            {!docs && <p className="mt-4 text-base text-ink-3 sm:text-sm">&ldquo;Works today&rdquo; means in the sample workspace.</p>}
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-2">
          <div>
            <p className="kicker">Built to be trusted with tax forms</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Software, not a law firm.</h2>
            <p className="mt-4 text-ink-2">
              ShipShape fills facts into official and openly licensed documents and tells you where each one comes from. It never writes
              or changes the clauses, and it never tells you which document you need. You review every field, and you decide.
            </p>
          </div>
          <ul className="space-y-3 text-base text-ink-2 sm:text-sm">
            {TRUST.map(({ key, text }) => (
              <li key={key} className="flex gap-3">
                <span aria-hidden="true" className="mt-0.5 text-ok">
                  ✓
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-line bg-paper">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-20 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl space-y-3">
              <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Free to start. ${PLANS.pro.price} a month for Pro.</h2>
              <p className="text-ink-2">
                Free keeps {PLANS.free.documents} active documents and {PLANS.free.passports} passport link open at a time. Pro removes the limits
                and adds deadline reminders on your Deadlines page.{" "}
                <Link href="/pricing" className="underline">
                  See pricing
                </Link>
                .
              </p>
            </div>
            {docs ? (
              <Link href="/signin" className="btn-accent">
                Sign in or create an account
              </Link>
            ) : (
              <WaitlistForm label="Hear when real accounts open" />
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
