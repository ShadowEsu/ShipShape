import Link from "next/link";
import { NotLegalAdvice } from "@/components/ui";
import type { ReadBy, RequestItem } from "@/lib/server/request-check";

// `dot`: the state as the v2 chip's dot colour (validity-chip in globals.css); v1 keeps the tinted pill.
const STATE: Record<RequestItem["state"], { label: string; cls: string; icon: string; dot: string }> = {
  ready: { label: "You have it", cls: "bg-ok-soft text-ok", icon: "✓", dot: "ok" },
  expiring: { label: "Expires soon", cls: "bg-warn-soft text-warn", icon: "◷", dot: "expiring" },
  expired: { label: "Expired", cls: "bg-bad-soft text-bad", icon: "!", dot: "expired" },
  missing: { label: "Not in your documents", cls: "bg-bad-soft text-bad", icon: "✕", dot: "expired" },
  unmatched: { label: "Check this one yourself", cls: "bg-canvas text-ink-2", icon: "?", dot: "none" },
};

/** The best current match of each item, once: what a passport link for this request would hold. */
export const currentMatchIds = (items: readonly RequestItem[]) =>
  [...new Set(items.flatMap((i) => (i.state === "ready" || i.state === "expiring" ? [i.matches[0].id] : [])))];

/** One document the request asks for: its name and state, the words that asked for it, your matches, the fix if missing. */
export function RequestItemBody({ item }: { item: RequestItem }) {
  const s = STATE[item.state];
  return (
    <>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <span className="min-w-0 font-medium">{item.label}</span>
        <span data-validity={s.dot} className={`validity-chip inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
          <span aria-hidden="true" className="validity-icon">
            {s.icon}
          </span>
          {s.label}
        </span>
      </div>
      {item.quote && (
        <p className="text-sm text-ink-3">
          &ldquo;{item.quote}&rdquo;
          {/* The redesigned app shows it as the amber dot and its words, like every other state (Design #26 S3). */}
          {item.traced === false && (
            <span data-validity="expiring" className="validity-chip ml-2 inline-flex items-center rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">
              Not found in the request
            </span>
          )}
        </p>
      )}
      {item.matches.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {item.matches.map((m) => (
            <li key={m.id}>
              <Link href={`/app/documents/${m.id}`} className="underline">
                {m.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {item.state === "missing" && (
        <p className="text-sm">
          <Link href={item.kind === "w9" ? "/app/make/irs-w9" : item.kind === "nda" ? "/app/make/common-paper-mnda" : "/app/documents/new"} className="underline">
            {item.kind === "w9" || item.kind === "nda" ? "Make it now" : "Add it"}
          </Link>
        </p>
      )}
    </>
  );
}

/**
 * What a checked request comes back as, wherever it was checked (Home's box and Check a request): what it asks for,
 * each item against your documents, the way to share the current ones, and the not-a-law-firm line as visible text on
 * every answer (Security MUST-L2, L3). `by`: whether the AI read it or the plain reader matched names (AI off), which
 * the answer says, since the plain reader can miss a document a request describes without naming it.
 */
export function RequestAnswer({ items, titleId, by, v2 = true }: { items: readonly RequestItem[]; titleId: string; by: ReadBy; v2?: boolean }) {
  const linkIds = currentMatchIds(items);
  const count = `${items.length} ${items.length === 1 ? "document" : "documents"}`;
  return (
    <div className="space-y-4">
      <h2 id={titleId} tabIndex={-1} className={v2 ? "section-title" : "font-serif text-2xl font-semibold"}>
        {items.length === 0 ? "The request doesn't ask for any documents" : `The request asks for ${count}`}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-2">
          {by === "ai"
            ? "The AI didn't find any documents asked for in that text. If it should have, paste just the part that lists them and check it again."
            : "That text names none of the documents ShipShape knows: a W-9, an insurance certificate, a license, a permit, an NDA or another agreement, a registration, a tax certificate or a bond. If it asks for something else, check it against your documents yourself."}
        </p>
      ) : (
        <ul className={v2 ? "group-list" : "divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper"}>
          {items.map((item, n) => (
            <li key={n} className="space-y-2 px-4 py-3">
              <RequestItemBody item={item} />
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        <p className="text-[13px] leading-5 text-ink-3">
          {by === "ai" ? "Read by AI. Check it against the request." : "Found by matching document names, not by AI. Check it against the request."}
        </p>
        <NotLegalAdvice />
      </div>
      {linkIds.length > 0 && (
        <div className="space-y-2">
          <Link href={`/app/passport?docs=${linkIds.join(",")}`} className={v2 ? "btn btn-block press" : "btn-ghost"}>
            {linkIds.length === 1 ? "Share the current one in a link" : `Share the ${linkIds.length} current ones in a link`}
          </Link>
          <p className="text-xs text-ink-3">Nothing is sent until you make the link.</p>
        </div>
      )}
    </div>
  );
}
