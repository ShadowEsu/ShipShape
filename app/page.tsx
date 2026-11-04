import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { SiteFooter, SiteHeader, StatusLabel, type Status } from "@/components/site";
import { WaitlistForm } from "@/components/waitlist";
import { PLANS } from "@/lib/plans";
import { paymentsLive } from "@/lib/server/billing-config";
import { appUrl, realDocsEnabled } from "@/lib/server/flags";
import { homeJsonLd, jsonLdText } from "@/lib/server/seo";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** The hero's sentence, said once: on the page and as the app's description in its structured data. */
const PITCH =
  "Keep your W-9, insurance certificate, licenses and agreements together. Fill new forms from facts you confirmed once, share the packet with one link, and see what's due before it lapses.";

/** What keeps the documents safe, one line each; `key` is stable because some lines carry markup. */
const TRUST: { key: string; text: ReactNode }[] = [
  { key: "tax-ids", text: "Tax IDs in your business facts are encrypted with a key kept outside the database and shown as the last 4 digits unless you ask." },
  { key: "storage", text: "Files sit in private storage and open through links that expire after 5 minutes." },
  { key: "walls", text: "Each workspace is walled off from every other in the database itself, checked with a second account in our tests." },
  {
    key: "history",
    // "in-app" never breaks at its hyphen (Design, wave 15).
    text: (
      <>
        Every change to a document, and every <span className="whitespace-nowrap">in-app</span> view, download, share and signature of it, lands in a history
        where each entry is chained to the one before. Passport links keep their own list of opens.
      </>
    ),
  },
  { key: "no-ads", text: "No ads, no analytics trackers, and we don't train AI on your documents." },
  { key: "export", text: "Owners and admins can export everything from Settings (one ZIP, up to 200 MB); anyone can delete their account there, any time." },
];

const WHO: { who: string; asks: string }[] = [
  { who: "Contractors", asks: "Every new general contractor or property manager wants your W-9, insurance certificate and license. Then the certificate again when it renews." },
  { who: "Freelancers", asks: "Each client wants a W-9 and an NDA signed before the first call, and your own agreement after it." },
  { who: "Restaurants and shops", asks: "Landlords, suppliers and delivery apps ask for permits, certificates and tax forms, and you collect the same from your vendors." },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Keep", body: "Every document in one place, with each version, its dates and a history of who opened or shared it." },
  { title: "Fill", body: "Confirm your business facts once. ShipShape fills the official IRS W-9 and the Common Paper Mutual NDA from them, and shows where every field came from." },
  { title: "Share", body: "One link holds exactly the documents you pick. It expires when you say, shows each time it's opened and what was downloaded, and turns off in a click." },
  { title: "Stay current", body: "Expiry and renewal dates become deadlines and a calendar file with alerts; on Pro, also reminders 90, 30 and 7 days ahead." },
];

/** What works today, what waits on setup and what's planned, worded for whether real documents and live payments are open (Security MUST-4). */
function capabilities(docs: boolean, live: boolean): { title: string; body: string; status: Status }[] {
  return [
    { title: "Documents, versions and history", body: "Search, archive and see every version; every change and download recorded.", status: "Works today" },
    { title: "W-9 and NDA from your facts", body: "Official IRS form and Common Paper's standard NDA, filled and saved.", status: "Works today" },
    { title: "Passport links", body: "Expiry up to 90 days, access log, turn off any time.", status: "Works today" },
    { title: "Deadlines and calendar file", body: "Lapsed, due soon and later, with an .ics download.", status: "Works today" },
    docs
      ? { title: "Signature requests", body: "Consent, a one-time code and a certificate page on the signed copy. In the sample today; for your own documents once ShipShape sends email.", status: "Awaiting setup" }
      : { title: "Signature requests", body: "Consent, a one-time code and a certificate page on the signed copy.", status: "Works today" },
    { title: "Export and account deletion", body: "One ZIP of everything; deletion removes files and links.", status: "Works today" },
    docs
      ? { title: "Collect", body: "Ask your own vendors for W-9s and certificates through an upload link and see who's current. In the sample today; not in a plan yet.", status: "Planned" }
      : { title: "Collect", body: "Ask your own vendors for W-9s and certificates through an upload link and see who's current. Not in a plan yet.", status: "Works today" },
    docs
      ? { title: "Accounts for real documents", body: "Your own account and workspace for your real paperwork.", status: "Works today" }
      : { title: "Accounts for real documents", body: "Pending our security review and the production database.", status: "Awaiting setup" },
    docs
      ? { title: "Upload your own files", body: "PDF, PNG or JPEG files, up to 4 MB each.", status: "Works today" }
      : { title: "Upload your own files", body: "PDF, PNG or JPEG, up to 4 MB each, once real accounts open.", status: "Awaiting setup" },
    { title: "Email reminders and signing codes", body: "Pending an email provider; the sample shows them inside the app meanwhile.", status: "Awaiting setup" },
    live
      ? { title: "Payments", body: "Pro is paid monthly through Stripe; cancel any time from Settings.", status: "Works today" }
      : { title: "Payments", body: "Checkout, billing portal and webhooks, checked against a simulated Stripe. No real charges.", status: "Awaiting setup" },
    { title: "“What are they asking for?”", body: "Paste a request and see which documents it asks for and which you have. Built; opt-in per request, switched on after our security review.", status: "Awaiting setup" },
    { title: "Dates read off certificates", body: "Expiry dates filled in from an uploaded certificate, with your OK. Opt-in AI.", status: "Planned" },
  ];
}

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
        <span className="eyebrow">Passport link</span>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-2">Sample</span>
      </figcaption>
      <p className="mt-3 font-serif text-2xl font-semibold">Harbor Plumbing LLC</p>
      <p className="text-sm text-ink-2">Shared with Northwind Builders · works until Dec 1</p>
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

export default function Home() {
  // Absolute URLs need the site's address (SHIPSHAPE_APP_URL); local runs without it skip the structured data.
  const site = appUrl();
  const docs = realDocsEnabled();
  const live = paymentsLive();
  return (
    <>
      {site && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(homeJsonLd(site, PITCH)) }} />}
      <SiteHeader />
      <main id="main">
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-10 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
          <div className="space-y-6">
            <p className="eyebrow">Business paperwork, in one place</p>
            <h1 className="font-serif text-5xl leading-[0.95] font-semibold tracking-tight sm:text-7xl">
              Every form. <em className="text-accent">One link.</em>
            </h1>
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
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {WHO.map((w) => (
                <div key={w.who} className="rounded-2xl border border-line p-5">
                  <h3 className="font-semibold">{w.who}</h3>
                  <p className="mt-2 text-base text-ink-2 sm:text-sm">{w.asks}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-2xl text-ink-2">Today that&apos;s email attachments, &ldquo;can you resend the new certificate?&rdquo;, and expired documents nobody noticed.</p>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-20">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Keep, fill, share, stay current.</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="space-y-2">
                <span className="font-mono text-sm text-ink-3">0{i + 1}</span>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-base text-ink-2 sm:text-sm">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-line bg-paper">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <p className="eyebrow">Where things stand</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">What works today, and what doesn&apos;t yet.</h2>
            <ul className="mt-8 grid gap-3 md:grid-cols-2">
              {capabilities(docs, live).map((c) => (
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
            <p className="eyebrow">Built to be trusted with tax forms</p>
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
                Free keeps {PLANS.free.documents} active documents and {PLANS.free.passports} open link. Pro removes the limits and adds
                deadline reminders on your Deadlines page.{" "}
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
              <div className="space-y-2">
                <p className="text-sm font-medium">Hear when real accounts open</p>
                <WaitlistForm />
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
