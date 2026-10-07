import Link from "next/link";
import { WaitlistForm } from "@/components/forms";
import { Disclaimer, Logo } from "@/components/ui";

const STATS = [
  { n: "2.09M", t: "iOS submissions Apple rejected in 2025, about 1 in 4", src: "https://apple.com/legal/app-store/transparency/2025" },
  { n: "3,948", t: "federal ADA website lawsuits in 2025, most against small businesses", src: "https://keyt.com/news/money-and-business/stacker-money/2026/01/14/accessibility-lawsuits-rose-by-37-in-2025-why-small-businesses-can-no-longer-ignore-their-websites/" },
  { n: "$1.4M", t: "paid by one mobile game company for a missing privacy opt out", src: "https://ppc.land/california-fines-mobile-gaming-firm-1-4-million-for-privacy-failures/" },
];

const CHECKS = [
  ["App store rules", "Account deletion, login options, in app purchase, privacy manifests, Play data safety."],
  ["Privacy", "Every tracker and SDK in your code and on your live site, checked against what your policy says."],
  ["New laws", "AI chatbot rules, the TAKE IT DOWN Act, children's privacy and state app store age laws."],
  ["Accessibility", "The issues behind most ADA website suits, like missing alt text and page language."],
  ["Licenses", "Copyleft dependencies that could force you to publish your own code."],
  ["Security", "API keys and secrets committed to your repo, caught before someone else finds them."],
];

const PLANS = [
  { name: "Free", price: "$0", per: "", items: ["One scan of a repo or site", "Full report with proof", "No card needed"] },
  { name: "Starter", price: "$19", per: "/month", items: ["1 app or site", "Checks on every pull request", "Matching policy, terms and store answers"] },
  { name: "Business", price: "$29", per: "/site/month", items: ["Daily live site checks", "Alerts when a tracker or law changes", "Document vault and signatures"], featured: true },
  { name: "Agency", price: "$299", per: "/month", items: ["Unlimited client repos and sites", "Client ready reports", "Team seats and audit log"] },
];

export default function Home() {
  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <Logo />
        <nav className="flex items-center gap-5 text-sm">
          <a href="#how" className="hidden sm:inline">How it works</a>
          <a href="#pricing" className="hidden sm:inline">Pricing</a>
          <Link href="/app" className="btn-ghost">Open the app</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-12 pb-20 text-center">
        <p className="mb-4 inline-block rounded-full bg-sea-light px-3 py-1 text-xs font-semibold text-sea">For startups, small businesses and small orgs</p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Find what will get you rejected, sued or fined. Before it happens.</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Connect your code and your live site. ShipShape checks them against store rules and the law, writes documents that match what
          your product actually does, and keeps watching.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/app/scans/new" className="btn px-6 py-3 text-base">Run a free scan</Link>
          <a href="#waitlist" className="btn-ghost px-6 py-3 text-base">Join the waitlist</a>
        </div>
      </section>

      <section className="bg-foam py-14">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:grid-cols-3">
          {STATS.map((s) => (
            <a key={s.n} href={s.src} className="card block hover:border-sea" target="_blank" rel="noreferrer">
              <div className="text-3xl font-bold text-sea">{s.n}</div>
              <p className="mt-2 text-sm text-slate-600">{s.t}</p>
            </a>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-3xl font-bold tracking-tight">The three way check</h2>
        <p className="mt-3 max-w-2xl text-slate-600">
          Other tools look at one thing. ShipShape compares all three, because the gaps between them are what lawsuits are built on.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            ["Your code", "What the app can do. Read from GitHub on every change."],
            ["Your live product", "What it actually does when a real visitor shows up."],
            ["Your documents", "What your policy and store answers say it does."],
          ].map(([t, d]) => (
            <div key={t} className="card">
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border-2 border-sea bg-sea-light p-5 text-center">
          <p className="font-semibold">"Your policy says you don't share data, but the Meta Pixel loads before the cookie banner."</p>
          <p className="mt-1 text-sm text-slate-600">Every finding comes with proof: a file and line or a captured page, plus the rule and its source.</p>
        </div>
      </section>

      <section className="bg-foam py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold tracking-tight">What it checks</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CHECKS.map(([t, d]) => (
              <div key={t} className="card">
                <h3 className="font-semibold">{t}</h3>
                <p className="mt-2 text-sm text-slate-600">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Everything in one place, with a history</h2>
          <p className="mt-3 text-slate-600">
            Every scan, every version of every document and every signature is saved with a date and a fingerprint. Look back at what
            you knew, what you fixed and what you signed, any time.
          </p>
        </div>
        <ul className="space-y-3 text-sm">
          {[
            "Scan history: see exactly what was open on any date",
            "Document vault: every version of your policy, terms and agreements",
            "Signatures: send, sign and download with a certificate",
            "Audit log: a tamper evident record of who did what",
            "Export everything or delete your account whenever you want",
          ].map((i) => (
            <li key={i} className="card py-3">{i}</li>
          ))}
        </ul>
      </section>

      <section id="pricing" className="bg-foam py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold tracking-tight">Simple pricing</h2>
          <p className="mt-3 text-slate-600">Early access prices. Nonprofits and student groups get the Business plan free while we're in beta. Pull request checks and daily live checks arrive during the beta.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div key={p.name} className={`card ${p.featured ? "border-2 border-sea" : ""}`}>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-2"><span className="text-3xl font-bold">{p.price}</span><span className="text-sm text-slate-500">{p.per}</span></p>
                <ul className="mt-4 space-y-2 text-sm text-slate-600">{p.items.map((i) => <li key={i}>✓ {i}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-3xl font-bold tracking-tight">Built to be trusted</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Facts, not promises", "We report what your product does and cite the rule. We never tell you you're compliant or guarantee approval."],
            ["Read only, then deleted", "We get read only access, scan your code, and delete our copy. We never train on your code."],
            ["Sources on everything", "Every rule cites its source and effective date, and the app tells you when a question needs a real lawyer."],
          ].map(([t, d]) => (
            <div key={t} className="card">
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-2 text-sm text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="waitlist" className="bg-ink py-16 text-white">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold tracking-tight">Get early access</h2>
          <p className="mt-2 mb-6 text-slate-300">We're onboarding small teams in batches. Your first scan is free.</p>
          <WaitlistForm />
        </div>
      </section>

      <footer className="mx-auto max-w-6xl space-y-4 px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <nav className="flex gap-5 text-sm text-slate-600">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href="mailto:hello@shipshape.dev">Contact</a>
          </nav>
        </div>
        <Disclaimer />
      </footer>
    </main>
  );
}
