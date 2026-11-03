import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import { HISTORY_TABS, historyTab, type HistoryTab } from "@/lib/history";
import { ACTIVITY_DAYS, daysParam, HISTORY_DAYS_DEFAULT, HISTORY_SHOWN, listHistory, readsAllHistory, type ActivityDays, type HistoryRow } from "@/lib/server/activity";
import { uiV2 } from "@/lib/server/flags";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { clockOf, dayOf } from "@/lib/today";
import { FilterMenu, TabLinks } from "../filters";

export const metadata: Metadata = { title: "History" };

const ERRORS: Record<string, { text: string; fix?: { href: string; label: string } }> = {
  reauth: { text: "For your security, sign in again before you export.", fix: { href: "/signin?next=history", label: "Sign in again" } },
  role: { text: "Only owners and admins can export History. Ask one of them for the file." },
};

/** History's address with these choices. */
function historyHref(tab: HistoryTab, mine: boolean, days: ActivityDays): string {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("tab", tab);
  if (mine) params.set("who", "me");
  if (days !== HISTORY_DAYS_DEFAULT) params.set("days", String(days));
  const query = params.toString();
  return query ? `/app/history?${query}` : "/app/history";
}

/**
 * History (calm v2): what happened in this workspace, newest first, by day. Owners and admins see all of it, as their
 * export does; a member sees what each document's own History shows them (Security S2). Export downloads exactly
 * what's listed (S6).
 */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string; days?: string; error?: string }> }) {
  if (!uiV2()) notFound();
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const all = readsAllHistory(ctx);
  const tab = historyTab(sp.tab) === "account" && !all ? "all" : historyTab(sp.tab);
  const mine = sp.who === "me";
  const days = daysParam(sp.days) ?? HISTORY_DAYS_DEFAULT;
  const [{ rows, more }, zone] = await Promise.all([listHistory(ctx, { tab, mine, days }), viewerZone()]);
  const error = sp.error ? ERRORS[sp.error] : undefined;

  // Grouped by the day where the viewer is, newest first (the rows already are).
  const groups: { day: string; rows: HistoryRow[] }[] = [];
  for (const r of rows) {
    const day = dayOf(r.at, zone);
    const last = groups.at(-1);
    if (last?.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PageHeader eyebrow="History" title="History">
          {all && rows.length > 0 && (
            <form action="/app/history/export" method="post">
              <input type="hidden" name="tab" value={tab} />
              <input type="hidden" name="who" value={mine ? "me" : "anyone"} />
              <input type="hidden" name="days" value={days} />
              <button className="btn press">Export</button>
            </form>
          )}
        </PageHeader>
        <p className="text-ink-2">{all ? "Everything that happened in this workspace." : "What happened to this workspace's documents."}</p>
      </div>
      {error && (
        <Notice tone="bad">
          {error.text}{" "}
          {error.fix && (
            <Link href={error.fix.href} className="underline">
              {error.fix.label}
            </Link>
          )}
        </Notice>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabLinks
          label="Kind of event"
          tabs={HISTORY_TABS.filter(([t]) => all || t !== "account").map(([t, text]) => ({ href: historyHref(t, mine, days), text, current: t === tab }))}
        />
        <div className="flex gap-2">
          <FilterMenu
            label="Who"
            options={[
              { href: historyHref(tab, false, days), text: "Anyone", current: !mine },
              { href: historyHref(tab, true, days), text: "You", current: mine },
            ]}
          />
          <FilterMenu label="When" options={ACTIVITY_DAYS.map((d) => ({ href: historyHref(tab, mine, d), text: `Last ${d} days`, current: d === days }))} />
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="quiet-empty">Nothing in this range.</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day} className="space-y-2">
              <h2 className="home-section-title">{g.day}</h2>
              <ol className="hair-list">
                {g.rows.map((r) => (
                  <li key={r.seq} className="history-row">
                    <time dateTime={new Date(r.at).toISOString()} className="history-time">
                      {clockOf(r.at, zone)}
                    </time>
                    <span className="row-icon" aria-hidden="true">
                      <Icon name={r.icon} size={17} />
                    </span>
                    <span className="history-what">
                      {r.href ? (
                        <Link href={r.href} className="hover:underline">
                          {r.what}
                        </Link>
                      ) : (
                        r.what
                      )}
                    </span>
                    <span className="history-who">{r.who}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {more && (
            <p className="text-[13px] text-ink-3">
              {all ? `Showing the latest ${HISTORY_SHOWN}. The workspace export in Settings has every entry.` : `Showing the latest ${HISTORY_SHOWN}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
