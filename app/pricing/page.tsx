import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader, StatusLabel } from "@/components/site";
import { WaitlistForm } from "@/components/waitlist";
import { megabytes, PLANS } from "@/lib/plans";

const { free, pro } = PLANS;

export const metadata: Metadata = {
  title: "Pricing",
  description: `ShipShape is free for up to ${free.documents} documents. Pro is $${pro.price} a month.`,
  alternates: { canonical: "/pricing" },
};

const ROWS: [feature: string, free: string, pro: string][] = [
  ["Active documents", `${free.documents}`, "No limit"],
  ["Passport links open at once", `${free.passports}`, "No limit"],
  // "in all" kept together (Design, wave 15): at 390 the cell wraps "100 MB / in all", never a lone "all".
  ["Files", `${megabytes(free.files)} in\u00a0all`, "No total limit"],
  ["Versions, history, search", "✓", "✓"],
  ["W-9 and NDA from your business facts", "✓", "✓"],
  ["Deadlines and calendar file", "✓", "✓"],
  ["Email reminders 90, 30 and 7 days ahead", "Not included", "✓"],
  ["Signature requests", "Not included", "✓"],
  ["Export and account deletion", "✓", "✓"],
];

const BILLING: [q: string, a: string][] = [
  ["Can I cancel any time?", "Yes, from Settings. Pro stays on until the end of the period you paid for, then the workspace moves to Free."],
  ["What happens to my documents if I go back to Free?", "Nothing is deleted. You just can't add more than Free allows until you're under its limits."],
  ["What if a payment fails?", "Pro stays on for 7 days from the first failed attempt while the payment is retried, then the workspace moves to Free."],
  ["Refunds?", "Your first Pro payment can be refunded in full if you ask within 14 days. The terms will give the address to ask before real payments start. After that you can cancel any time, but earlier payments aren't refunded, in whole or in part. A full refund or a disputed charge ends Pro straight away."],
  ["Am I charged now?", "No. During the preview, payments run in Stripe's test mode and no real money moves."],
];

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-5xl px-5 pt-10 pb-20">
        <p className="eyebrow">Pricing</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Free to start. Pro when you need more.</h1>
        <p className="mt-3 max-w-2xl text-ink-2">Prices in US dollars. Payments are in test mode during the preview: no real charges.</p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <section className="card flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{free.name}</h2>
            <p>
              <span className="font-serif text-4xl font-semibold">$0</span>
            </p>
            <p className="text-base text-ink-2 sm:text-sm">
              For getting your papers in order: {free.documents} active documents, {megabytes(free.files)} of files and {free.passports} passport link
              open at a time.
            </p>
            <Link href="/signin" className="btn-ghost mt-auto">
              Try the sample
            </Link>
          </section>
          <section className="card flex flex-col gap-4 border-ink">
            <h2 className="text-lg font-semibold">{pro.name}</h2>
            <p>
              <span className="font-serif text-4xl font-semibold">${pro.price}</span>
              <span className="text-ink-2"> / month</span>
            </p>
            <p className="text-base text-ink-2 sm:text-sm">No limits on documents or links, plus email reminders and signature requests.</p>
            <Link href="/signin" className="btn-accent mt-auto">
              Try the sample
            </Link>
            <p className="text-xs text-ink-3">Sample workspaces include every Pro feature.</p>
          </section>
          <section className="card flex flex-col gap-4 bg-canvas">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">Collect</h2>
              <StatusLabel status="Works today" />
            </div>
            <p className="text-base text-ink-2 sm:text-sm">
              For businesses that gather documents from many vendors or subcontractors: send each one an upload link and see who&apos;s
              current. Try it in the sample workspace. It isn&apos;t in a plan yet, so it isn&apos;t for sale.
            </p>
            <div className="mt-auto">
              <WaitlistForm interest="collect" />
            </div>
          </section>
        </div>

        <section className="mt-14">
          <h2 id="compare" className="font-serif text-2xl font-semibold">Compare</h2>
          {/* Scrolls sideways on phones; focusable so the keyboard can scroll it too. */}
          <div role="region" aria-labelledby="compare" tabIndex={0} className="mt-4 overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-3 font-medium text-ink-2">
                    Feature
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {free.name}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {pro.name}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ROWS.map(([feature, f, p]) => (
                  <tr key={feature}>
                    <th scope="row" className="px-4 py-3 font-normal">
                      {feature}
                    </th>
                    <td className="px-4 py-3">{f}</td>
                    <td className="px-4 py-3">{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-base text-ink-3 sm:text-sm">
            Email reminders and signature requests by email start once ShipShape has an email provider. Until then, the sample workspace
            shows them inside the app.
          </p>
        </section>

        <section className="mt-14 max-w-3xl">
          <h2 className="font-serif text-2xl font-semibold">Billing questions</h2>
          <dl className="mt-4 divide-y divide-line">
            {BILLING.map(([q, a]) => (
              <div key={q} className="py-4">
                <dt className="font-medium">{q}</dt>
                <dd className="mt-1 text-ink-2">{a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-base text-ink-2 sm:text-sm">
            The full terms, including billing, are in the{" "}
            <Link href="/terms" className="underline">
              terms
            </Link>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
