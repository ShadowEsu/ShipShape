import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Pager } from "@/components/app-ui";
import { pageParam } from "@/lib/paging";
import { DOC_KINDS, pickableDocuments } from "@/lib/server/documents";
import { realDocsEnabled, uiV2 } from "@/lib/server/flags";
import { PASSPORT_DAYS, PASSPORTS_PAGE_SIZE, pagePassports } from "@/lib/server/passport";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { dayOf } from "@/lib/today";
import { NewPassportForm } from "./forms";
import { linkStatus } from "./link-status";
import { PassportV2 } from "./v2";

export const metadata: Metadata = { title: "Passport" };

/**
 * `?docs=<id>,<id>` ticks those documents in the form (from "What are they asking for?", and back from the preview); ids not
 * in this workspace are ignored. `?label=` and `?days=` bring the rest of the form back from the preview. `?page=` pages
 * Your links.
 */
export default async function PassportPage({ searchParams }: { searchParams: Promise<{ docs?: string; label?: string; days?: string; page?: string }> }) {
  const ctx = await requireWorkspace();
  // Link ends are instants: shown as the day where the owner is (the same rule as the pages their recipients open).
  const zone = await viewerZone();
  const picked = await searchParams;
  const preselected = typeof picked.docs === "string" ? picked.docs.split(",").slice(0, 50) : [];
  const comingBack = { label: typeof picked.label === "string" ? picked.label.slice(0, 120) : "", days: Number(picked.days) };
  const v2 = uiV2();
  const [links, { docs, left }] = await Promise.all([pagePassports(ctx, { page: pageParam(picked.page), workingFirst: v2 }), pickableDocuments(ctx, preselected)]);
  // Pages keep the form's ?docs=, ?label= and ?days= as they came, and land on Your links.
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    for (const key of ["docs", "label", "days"] as const) {
      const value = picked[key];
      if (typeof value === "string" && value) params.set(key, value);
    }
    if (n > 1) params.set("page", String(n));
    const query = params.toString();
    return `/app/passport${query ? `?${query}` : ""}#links-title`;
  };
  const pager = <Pager label="Link pages" page={links.page} pages={links.pages} size={PASSPORTS_PAGE_SIZE} shown={links.rows.length} total={links.total} href={pageHref} />;

  const pickable = docs.map((d) => ({
    id: d.id,
    title: d.title,
    kindLabel: DOC_KINDS[d.kind],
    note: d.validity === "expired" ? "expired" : d.validity === "expiring" ? "expires soon" : null,
    // A filled W-9 keeps its template whatever kind it's filed under (W14-6).
    holdsTaxId: d.kind === "w9" || d.template_id === "irs-w9",
  }));

  if (v2)
    return (
      <PassportV2
        links={links.rows}
        pager={pager}
        docs={pickable}
        left={left}
        preselected={preselected}
        today={ctx.today}
        initial={comingBack}
        zone={zone}
        gated={!ctx.demo && !realDocsEnabled()}
      />
    );

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Passport" title="Share your paperwork" />
      <p className="max-w-2xl text-ink-2">
        One link with exactly the documents someone asked for. It stops working on the date you choose, you can turn it off any time,
        and you see each time it&apos;s opened.
      </p>

      {/* grid-cols-1 below lg: an implicit column grows to its widest unbreakable line (a truncated link label is still one
          line), which ran 48px off a 390 screen. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card">
          <h2 className="mb-4 font-semibold">New link</h2>
          <NewPassportForm
            days={PASSPORT_DAYS}
            preselected={preselected}
            today={ctx.today}
            initial={comingBack}
            docs={pickable}
            left={left}
          />
        </section>

        <section className="space-y-3">
          <h2 id="links-title" tabIndex={-1} className="font-semibold">
            Your links
          </h2>
          {links.total === 0 ? (
            <EmptyState
              icon="passport"
              title="No links yet"
              body="Each link you make shows here with who it's for, how often it was opened and the day it stops working, for example: “Northwind Builders onboarding · 2 documents · opened 3 times · until Dec 1, 2026”."
            />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {links.rows.map((l) => {
                const s = linkStatus(l, zone);
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
          {pager}
        </section>
      </div>
    </div>
  );
}
