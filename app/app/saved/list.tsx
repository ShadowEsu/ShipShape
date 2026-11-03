import Link from "next/link";
import { ValidityChip } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import type { SavedDocument, SavedLink, SavedRow } from "@/lib/server/saved";
import { dayOf } from "@/lib/today";
import { linkStatus } from "../passport/link-status";

/**
 * Saved documents and links as one list, newest first (listSaved's order): the Saved page, and Home's Saved
 * section with listSaved(ctx, n). The redesigned look's grouped rows, as the documents and passport lists; the
 * earlier look's bordered list.
 */
export function SavedList({ rows, zone, v2 }: { rows: SavedRow[]; zone: string; v2: boolean }) {
  return (
    <ul className={v2 ? "group-list" : "divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper"}>
      {rows.map((r) => (
        <li key={`${r.kind}-${r.id}`}>
          <Link href={r.href} className={v2 ? "group-row flex-wrap gap-y-1.5 sm:flex-nowrap" : "flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-canvas sm:flex-nowrap"}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-tile text-ink-2">
              <Icon name={r.kind === "document" ? "documents" : "passport"} />
            </span>
            {r.kind === "document" ? <DocumentLine row={r} /> : <LinkLine row={r} zone={zone} />}
            <span className="hidden text-ink-3 sm:block">
              <Icon name="chevron" size={16} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DocumentLine({ row }: { row: SavedDocument }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.title}</span>
        <span className="block truncate text-[13px] text-ink-3">{row.kindLabel}</span>
      </span>
      {/* Phone: the chip wraps under the text, lined up with it (32 px icon + 12 px gap); from sm up it sits beside it. */}
      <span className="ml-11 basis-full sm:ml-0 sm:basis-auto">
        <ValidityChip validity={row.validity} expiresOn={row.expiresOn} />
      </span>
    </>
  );
}

function LinkLine({ row, zone }: { row: SavedLink; zone: string }) {
  const s = linkStatus({ revoked_at: row.revokedAt, expires_at: row.expiresAt }, zone);
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{row.label}</span>
        <span className="block truncate text-[13px] text-ink-3">
          Passport link · {row.documents} {row.documents === 1 ? "document" : "documents"}
          {s.working && ` · until ${dayOf(row.expiresAt, zone)}`}
        </span>
      </span>
      <span className="ml-11 basis-full sm:ml-0 sm:basis-auto">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}>
          <span aria-hidden="true">{s.icon}</span>
          {s.label}
        </span>
      </span>
    </>
  );
}
