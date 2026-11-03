import Link from "next/link";
import { fmtMonthDay, ValidityChip } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import type { SavedDocument, SavedLink, SavedRow } from "@/lib/server/saved";
import { dayOf, fmtDay } from "@/lib/today";
import { HairRow } from "../hair-row";
import { linkStatus } from "../passport/link-status";

/** A saved row's meta line in the redesigned look, with its state in words instead of a chip (Design calm v2, Home's Saved). */
export function savedLine(row: SavedRow, zone: string): string {
  if (row.kind === "link") {
    const s = linkStatus({ revoked_at: row.revokedAt, expires_at: row.expiresAt }, zone);
    const docs = `${row.documents} ${row.documents === 1 ? "document" : "documents"}`;
    const state = s.working ? `works until ${dayOf(row.expiresAt, zone)}` : row.revokedAt ? "turned off" : `ended ${dayOf(row.expiresAt, zone)}`;
    return `Passport link · ${docs} · ${state}`;
  }
  const state =
    row.validity === "expiring" && row.expiresOn
      ? `expires ${fmtMonthDay(row.expiresOn)}`
      : row.validity === "expired" && row.expiresOn
        ? `expired ${fmtDay(row.expiresOn)}`
        : row.validity === "ok"
          ? "current"
          : "no expiry date";
  return `${row.kindLabel} · ${state}`;
}

/**
 * Saved documents and links as one list, newest first (listSaved's order): the Saved page, and (v2) Home's Saved
 * section with listSaved(ctx, n). The redesigned look's hairline rows with the state in the meta line; the earlier
 * look's bordered list with chips.
 */
export function SavedList({ rows, zone, v2 }: { rows: SavedRow[]; zone: string; v2: boolean }) {
  if (v2) {
    return (
      <ul className="hair-list">
        {rows.map((r) => (
          <HairRow
            key={`${r.kind}-${r.id}`}
            href={r.href}
            icon={r.kind === "document" ? "documents" : "passport"}
            title={r.kind === "document" ? r.title : r.label}
            line={savedLine(r, zone)}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
      {rows.map((r) => (
        <li key={`${r.kind}-${r.id}`}>
          <Link href={r.href} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-canvas sm:flex-nowrap">
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
