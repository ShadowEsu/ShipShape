import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import { daysParam, listSent, sentLink, sentSignature, type ActivityDays, type SentRow } from "@/lib/server/activity";
import { uiV2 } from "@/lib/server/flags";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { dayOf } from "@/lib/today";
import { FilterMenu, TabLinks } from "../filters";
import { HairRow, StateChip } from "../hair-row";
import { linkStatus } from "../passport/link-status";
import { SentDetail } from "./detail";

export const metadata: Metadata = { title: "Sent" };

const TABS = [
  ["all", "All"],
  ["links", "Links"],
  ["signatures", "For signature"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Sent's address with these choices; `open` is the row shown in detail (`link-<id>` or `signature-<id>`). */
function sentHref(tab: Tab, days: ActivityDays | null, open?: string): string {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("tab", tab);
  if (days) params.set("days", String(days));
  if (open) params.set("open", open);
  const query = params.toString();
  return query ? `/app/sent?${query}` : "/app/sent";
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A row's line and state, as the list shows them. */
function sentLine(r: SentRow, zone: string): { line: string; chip: React.ReactNode } {
  if (r.kind === "link") {
    const s = linkStatus({ revoked_at: r.revokedAt, expires_at: r.expiresAt }, zone);
    return {
      line: `Passport link · ${count(r.documents, "document", "documents")} · ${r.opens === 0 ? "not opened yet" : `opened ${count(r.opens, "time", "times")}`}`,
      chip: <StateChip tone={s.working ? "ok" : "none"}>{s.label}</StateChip>,
    };
  }
  const line = `For signature · to ${r.signerName} · sent ${dayOf(r.createdAt, zone)}`;
  if (r.status === "signed") return { line, chip: <StateChip tone="ok">Signed</StateChip> };
  if (r.status === "revoked") return { line, chip: <StateChip tone="none">Withdrawn</StateChip> };
  if (r.status === "declined") return { line, chip: <StateChip tone="none">Declined</StateChip> };
  const ended = new Date(r.expiresAt).getTime() <= Date.now();
  return { line, chip: <StateChip tone="none">{ended ? "Link ended" : "Not signed yet"}</StateChip> };
}

/**
 * Sent (calm v2): every passport link and signature request this workspace sent, and where each went. A list on the
 * left and the chosen one's detail on the right; on the phone, the detail on its own with a way back.
 */
export default async function SentPage({ searchParams }: { searchParams: Promise<{ tab?: string; days?: string; open?: string }> }) {
  if (!uiV2()) notFound();
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const tab: Tab = TABS.find(([t]) => t === sp.tab)?.[0] ?? "all";
  const days = daysParam(sp.days);
  const [rows, zone] = await Promise.all([listSent(ctx, days), viewerZone()]);
  const shown = rows.filter((r) => tab === "all" || (tab === "links" ? r.kind === "link" : r.kind === "signature"));
  const counts: Record<Tab, number> = {
    all: rows.length,
    links: rows.filter((r) => r.kind === "link").length,
    signatures: rows.filter((r) => r.kind === "signature").length,
  };

  // The row in detail: the one asked for (from any tab), else, from lg up, the list's first.
  const asked = /^(link|signature)-([0-9a-f-]{36})$/.exec(sp.open ?? "");
  const open = asked ? { kind: asked[1], id: asked[2] } : shown[0] ? { kind: shown[0].kind, id: shown[0].id } : null;
  const detail = open ? (open.kind === "link" ? await sentLink(ctx, open.id) : await sentSignature(ctx, open.id)) : null;
  const openKey = detail ? `${detail.row.kind}-${detail.row.id}` : null;

  return (
    <div className="space-y-6">
      <div className={asked && detail ? "hidden lg:block" : undefined}>
        <PageHeader eyebrow="Sent" title="Sent">
          <Link href="/app/passport" className="btn">
            Share in a link
          </Link>
        </PageHeader>
        <p className="mt-2 text-ink-2">Links you shared and documents you sent for signature, and where each one went.</p>
      </div>

      {rows.length === 0 && days === null ? (
        <p className="quiet-empty">Passport links you share and documents you send for signature show up here, with who opened and signed them.</p>
      ) : (
        <>
          <div className={`flex flex-wrap items-end justify-between gap-3 ${asked && detail ? "hidden lg:flex" : ""}`}>
            <TabLinks
              label="What was sent"
              tabs={TABS.map(([t, text]) => ({ href: sentHref(t, days), text, count: counts[t], current: t === tab }))}
            />
            <FilterMenu
              label="When"
              options={[
                { href: sentHref(tab, null), text: "All time", current: days === null },
                ...([7, 30, 90] as const).map((d) => ({ href: sentHref(tab, d), text: `Last ${d} days`, current: days === d })),
              ]}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            <div className={`min-w-0 ${asked && detail ? "hidden lg:block" : ""}`}>
              {shown.length === 0 ? (
                <p className="quiet-empty">Nothing sent in this range.</p>
              ) : (
                <ul className="hair-list">
                  {shown.map((r) => {
                    const { line, chip } = sentLine(r, zone);
                    const key = `${r.kind}-${r.id}`;
                    return (
                      <HairRow
                        key={key}
                        href={sentHref(tab, days, key)}
                        icon={r.kind === "link" ? "passport" : "sign"}
                        title={r.kind === "link" ? r.label : r.title}
                        line={line}
                        chip={chip}
                        current={key === openKey}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
            {detail && (
              <section aria-label="Where it went" className={`min-w-0 ${asked ? "" : "hidden lg:block"}`}>
                {asked && (
                  <Link href={sentHref(tab, days)} className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-ink-2 lg:hidden">
                    <span className="rotate-180">
                      <Icon name="chevron" size={16} />
                    </span>
                    Sent
                  </Link>
                )}
                <SentDetail detail={detail} zone={zone} />
              </section>
            )}
          </div>
          <p className="text-[13px] text-ink-3">A link can be opened by anyone who has it, so opens are counted, not named.</p>
        </>
      )}
    </div>
  );
}
