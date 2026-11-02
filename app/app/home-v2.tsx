import Link from "next/link";
import { RenewalChip, ValidityChip } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import { attentionLine } from "@/lib/attention";
import { DOC_KINDS, type AttentionRow, type DocRow, type HomeSummary } from "@/lib/server/documents";
import type { Tool } from "@/lib/server/tools";
import { AiBox } from "./ai-box";
import { ToolGrid } from "./tool-grid";

// Each a real page (Design spec 2026-11-02 §3); on the phone the row scrolls sideways.
const CHIPS = [
  { href: "/app/ask", label: "Check a request" },
  { href: "/app/passport", label: "Share a passport link" },
  { href: "/app/make/irs-w9", label: "Make a W-9" },
  { href: "/app/documents", label: "Ask someone to sign" },
];

/**
 * Home in the redesigned app: the question and the box first, then every tool, then what needs attention and what's
 * recent. The data and every sentence about it come from the same place as the current Home (app/app/page.tsx).
 */
export function HomeV2(props: {
  today: string;
  docs: HomeSummary;
  groups: { label: string; rows: AttentionRow[] }[];
  moreLine: string | null;
  canUpload: boolean;
  next: { href: string; title: string; body: string; done: number; of: number } | null;
  recent: DocRow[];
  tools: readonly Tool[];
  aiOn: boolean;
}) {
  const { today, docs, groups, moreLine, canUpload, next, recent, tools, aiOn } = props;
  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <h1 id="home-title" className="large-title mx-auto max-w-[760px]">
          What do you need to get done?
        </h1>
        <AiBox tools={tools} aiOn={aiOn} />
        <ul aria-label="Suggestions" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-auto md:max-w-[760px] md:flex-wrap md:justify-center md:px-0">
          {CHIPS.map((c) => (
            <li key={c.label} className="shrink-0">
              <Link href={c.href} className="press inline-flex min-h-11 items-center rounded-full border border-line bg-paper px-4 text-sm text-ink-2 transition-colors duration-[180ms] hover:bg-tile">
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
        {next && (
          <div className="mx-auto flex max-w-[760px] flex-col gap-3 rounded-2xl bg-tile p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm">
              <span className="block font-semibold text-ink">
                Next: {next.title}
                <span className="ml-2 font-normal text-ink-3">
                  {next.done} of {next.of} done
                </span>
              </span>
              <span className="block text-ink-2">{next.body}</span>
            </p>
            <Link href={next.href} className="btn btn-block press shrink-0">
              {next.title}
            </Link>
          </div>
        )}
      </section>

      <section id="tools" aria-labelledby="tools-title" className="scroll-mt-16 space-y-4">
        <h2 id="tools-title" className="section-title">
          Tools
        </h2>
        <ToolGrid tools={tools} />
      </section>

      {/* grid-cols-1 (minmax(0, 1fr)): an implicit auto column took the truncated titles' full width and widened the phone
          page to 463 px, which pushed the fixed tab bar below the screen. */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-8">
        <section aria-labelledby="attention-title" className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="attention-title" className="section-title">
              Needs attention
            </h2>
            {docs.total > 0 && (
              <p className="text-[13px] text-ink-3">
                {docs.current} of {docs.total} current
              </p>
            )}
          </div>
          {docs.attention.length === 0 ? (
            <p className="rounded-2xl bg-tile px-4 py-4 text-sm text-ink-2">
              {docs.total === 0
                ? "Documents that have expired, expire, or have a renewal notice due in the next 30 days will be listed here."
                : "Nothing has expired, expires, or has a renewal notice due in the next 30 days."}
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-2">
                For a document that&apos;s lapsing, renew it with the issuer, then{" "}
                {canUpload ? "add the new copy and its new date, so your passport links share the current one." : "update its dates."}
              </p>
              {groups.map((g) => (
                <div key={g.label} className="space-y-2">
                  <h3 className="text-xs font-semibold text-ink-3">{g.label}</h3>
                  <ul className="group-list stagger">
                    {g.rows.map((d, n) => {
                      const line = attentionLine(d, today, canUpload);
                      return (
                        <li key={d.id} style={{ "--i": n }} className="flex flex-col gap-1 px-4 py-3">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{d.title}</span>
                            {line.renewal ? <RenewalChip renewsOn={d.attention_on} /> : <ValidityChip validity={d.validity} expiresOn={d.expires_on} />}
                          </span>
                          <span className="text-sm text-ink-2">
                            {DOC_KINDS[d.kind]} · {line.state}{" "}
                            {/* 44 px to tap (18 px line + 13 px above and below), with negative margins so the row's layout doesn't move. */}
                            <Link href={line.href} className="-my-[13px] inline-block py-[13px] text-ink underline">
                              {line.action}
                            </Link>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {moreLine && (
                <p className="text-sm text-ink-2">
                  {moreLine}{" "}
                  <Link href="/app/deadlines" className="underline">
                    See every date
                  </Link>
                  .
                </p>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="recent-title" className="space-y-3">
          <h2 id="recent-title" className="section-title">
            Recent
          </h2>
          {recent.length === 0 ? (
            <p className="rounded-2xl bg-tile px-4 py-4 text-sm text-ink-2">The documents you add or make show up here.</p>
          ) : (
            <ul className="group-list stagger">
              {recent.map((d, n) => (
                <li key={d.id} style={{ "--i": n }}>
                  <Link href={`/app/documents/${d.id}`} className="group-row">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-tile text-ink-2">
                      <Icon name="documents" />
                    </span>
                    {/* The chip sits on the second line: beside the title it cut half-column titles to "Contractor license (sam…". */}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
                        {DOC_KINDS[d.kind]}
                        <ValidityChip validity={d.validity} expiresOn={d.expires_on} />
                      </span>
                    </span>
                    <span className="text-ink-3">
                      <Icon name="chevron" size={16} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
