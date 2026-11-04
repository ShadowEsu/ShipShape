import { PageHeader } from "@/components/app-ui";
import type { PassportRow } from "@/lib/server/passport";
import { PASSPORT_DAYS } from "@/lib/server/passport";
import { dayOf } from "@/lib/today";
import { HairRow, StateChip } from "../hair-row";
import type { PickableDoc } from "./forms";
import { NewLinkV2 } from "./forms-v2";
import { linkStatus } from "./link-status";

/** Your links as Sent lists them: wrapping hairline rows, the state as a dot and a word (Design #26 MUST-2). */
function YourLinks({ links, zone }: { links: PassportRow[]; zone: string }) {
  // Working links first, newest first within each (the list's own order); the stable sort keeps it.
  const rows = links.map((l) => ({ l, s: linkStatus(l, zone) })).sort((a, b) => Number(b.s.working) - Number(a.s.working));
  return (
    <ul className="hair-list">
      {rows.map(({ l, s }) => (
        <HairRow
          key={l.id}
          href={`/app/passport/${l.id}`}
          icon="passport"
          title={l.label}
          line={`${l.documents} ${l.documents === 1 ? "document" : "documents"} · opened ${l.opens} ${l.opens === 1 ? "time" : "times"} · until ${dayOf(l.expires_at, zone)}`}
          chip={<StateChip tone={s.working ? "ok" : "none"}>{s.label}</StateChip>}
        />
      ))}
    </ul>
  );
}

/**
 * Passport in the redesigned app (Design spec 2026-11-02 §4, PR 7 plan): one column; Your links first once there are
 * any (working ones on top), then the new-link form; with none yet, the form first and what Your links will hold under
 * it. Same data, words and action as the current page.
 */
export function PassportV2({
  links,
  docs,
  preselected,
  today,
  initial,
  zone,
  gated,
}: {
  links: PassportRow[];
  docs: PickableDoc[];
  preselected: string[];
  today: string;
  initial: { label: string; days: number };
  zone: string;
  /** A real workspace before real documents open: it can't add one, so "Add a document" would lead nowhere. */
  gated: boolean;
}) {
  const yours = (
    <section aria-labelledby="links-title" className="space-y-3">
      <h2 id="links-title" tabIndex={-1} className="section-title">
        Your links
      </h2>
      {links.length === 0 ? (
        <p className="rounded-2xl border border-line px-4 py-4 text-sm text-ink-2">
          No links yet. Each link you make shows here with who it&apos;s for, how often it was opened and the day it stops working, for example:
          “Northwind Builders onboarding · 2 documents · opened 3 times · until Dec 1, 2026”.
        </p>
      ) : (
        <YourLinks links={links} zone={zone} />
      )}
    </section>
  );
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <PageHeader eyebrow="Passport" title="Share your paperwork" />
        <p className="max-w-2xl text-ink-2">
          One link with exactly the documents someone asked for. It stops working on the date you choose, you can turn it off any time, and
          you see each time it&apos;s opened.
        </p>
      </div>
      {links.length > 0 && yours}
      <section aria-labelledby="new-link-title" className="max-w-[720px] space-y-4">
        <h2 id="new-link-title" className="section-title">
          New link
        </h2>
        {gated && docs.length === 0 ? (
          <p className="text-sm text-ink-2">A link shares documents from this workspace, so it needs at least one. Adding real documents opens after our security review.</p>
        ) : (
          <NewLinkV2 days={PASSPORT_DAYS} preselected={preselected} today={today} initial={initial} docs={docs} />
        )}
      </section>
      {links.length === 0 && yours}
    </div>
  );
}
