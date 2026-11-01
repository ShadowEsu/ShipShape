import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app-ui";
import { DOC_KINDS, listDocuments } from "@/lib/server/documents";
import { listPassports, PASSPORT_DAYS } from "@/lib/server/passport";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { dayOf } from "@/lib/today";
import { NewPassportForm } from "./forms";

export const metadata: Metadata = { title: "Passport" };

// A link reaching its planned end is expected, not a fault: neutral like Turned off (red stays for lapsed documents).
function status(l: { revoked_at: string | null; expires_at: string }, zone: string) {
  if (l.revoked_at) return { label: "Turned off", cls: "bg-canvas text-ink-3", icon: "○" };
  if (new Date(l.expires_at).getTime() < Date.now()) return { label: `Ended ${dayOf(l.expires_at, zone)}`, cls: "bg-canvas text-ink-3", icon: "○" };
  return { label: "Working", cls: "bg-ok-soft text-ok", icon: "✓" };
}

/**
 * `?docs=<id>,<id>` ticks those documents in the form (from "What are they asking for?", and back from the preview); ids not
 * in this workspace are ignored. `?label=` and `?days=` bring the rest of the form back from the preview.
 */
export default async function PassportPage({ searchParams }: { searchParams: Promise<{ docs?: string; label?: string; days?: string }> }) {
  const ctx = await requireWorkspace();
  // Link ends are instants: shown as the day where the owner is (the same rule as the pages their recipients open).
  const zone = await viewerZone();
  const [links, docs, picked] = await Promise.all([listPassports(ctx), listDocuments(ctx), searchParams]);
  const preselected = typeof picked.docs === "string" ? picked.docs.split(",").slice(0, 50) : [];
  const comingBack = { label: typeof picked.label === "string" ? picked.label.slice(0, 120) : "", days: Number(picked.days) };

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Passport" title="Share your paperwork" />
      <p className="max-w-2xl text-ink-2">
        One link with exactly the documents someone asked for. It stops working on the date you choose, you can turn it off any time,
        and you see each time it&apos;s opened.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card">
          <h2 className="mb-4 font-semibold">New link</h2>
          <NewPassportForm
            days={PASSPORT_DAYS}
            preselected={preselected}
            today={ctx.today}
            initial={comingBack}
            docs={docs.map((d) => ({
              id: d.id,
              title: d.title,
              kindLabel: DOC_KINDS[d.kind],
              note: d.validity === "expired" ? "expired" : d.validity === "expiring" ? "expires soon" : null,
              holdsTaxId: d.kind === "w9",
            }))}
          />
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Your links</h2>
          {links.length === 0 ? (
            <EmptyState
              title="No links yet"
              body="Each link you make shows here with who it's for, how often it was opened and the day it stops working, for example: “Northwind Builders onboarding · 2 documents · opened 3 times · until Dec 1, 2026”."
            />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {links.map((l) => {
                const s = status(l, zone);
                return (
                  <li key={l.id}>
                    <Link href={`/app/passport/${l.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas">
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{l.label}</span>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                          <span aria-hidden="true">{s.icon}</span>
                          {s.label}
                        </span>
                      </span>
                      <span className="text-sm text-ink-2">
                        {l.documents} {l.documents === 1 ? "document" : "documents"} · opened {l.opens} {l.opens === 1 ? "time" : "times"} · until{" "}
                        {dayOf(l.expires_at, zone)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
