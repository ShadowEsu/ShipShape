import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { fmtDateTime } from "@/components/ui";
import { billingConfig } from "@/lib/server/billing-config";
import { aiEnabled } from "@/lib/server/ai";
import { dbUp } from "@/lib/server/db";
import { realDocsEnabled } from "@/lib/server/flags";

export const metadata: Metadata = { title: "Status" };

type Tone = "ok" | "bad" | "off";
const TONE: Record<Tone, string> = { ok: "bg-ok-soft text-ok", bad: "bg-bad-soft text-bad", off: "bg-canvas text-ink-2" };

function Row({ name, state, tone, note }: { name: string; state: string; tone: Tone; note?: string }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span>
        <span className="font-medium">{name}</span>
        {note && <span className="block text-sm text-ink-3">{note}</span>}
      </span>
      <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold sm:self-center ${TONE[tone]}`}>{state}</span>
    </li>
  );
}

/** Live checks from this server, rendered per request. The same database check backs /api/health. */
export default async function StatusPage() {
  const db = await dbUp();
  const checkedAt = new Date();
  const payments = billingConfig();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-5 pt-10 pb-20">
        <p className="eyebrow">Status</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight">{db ? "Everything is running." : "ShipShape isn't working right now."}</h1>
        <p className="mt-2 text-sm text-ink-3">Checked {fmtDateTime(checkedAt)} · revision {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local"}</p>
        {!db && (
          <>
            <p className="mt-4 text-ink-2">The database isn&apos;t answering, so signing in and opening documents won&apos;t work. Check again in a few minutes.</p>
            <p className="mt-4">
              <a href="/status" className="btn">
                Check again
              </a>
            </p>
          </>
        )}

        <h2 className="mt-10 font-semibold">Service</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-paper">
          <Row name="App" state="Up" tone="ok" />
          <Row name="Database" state={db ? "Up" : "Down"} tone={db ? "ok" : "bad"} />
        </ul>

        <h2 className="mt-10 font-semibold">Features during the preview</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-paper">
          <Row name="Sample workspaces" state="On" tone="ok" note="Made-up business and documents; every feature to try." />
          <Row
            name="Real documents"
            state={realDocsEnabled() ? "On" : "Off"}
            tone={realDocsEnabled() ? "ok" : "off"}
            note="Opens after our security review."
          />
          <Row name="Email" state="Off" tone="off" note="Reminders and signing codes show inside the app instead." />
          {payments?.live ? (
            <Row name="Payments" state="Live payments" tone="ok" note="Real cards are charged, through Stripe." />
          ) : (
            <Row name="Payments" state={payments ? "Test mode" : "Off"} tone="off" note="No real charges during the preview." />
          )}
          <Row
            name="AI features"
            state={aiEnabled() ? "On" : "Off"}
            tone={aiEnabled() ? "ok" : "off"}
            note="Reading a pasted request; opt-in each time. On after our security review."
          />
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
