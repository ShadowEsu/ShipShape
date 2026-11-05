import Link from "next/link";
import { RenewalChip, ValidityChip } from "@/components/app-ui";
import { attentionLine } from "@/lib/attention";
import { aiEnabled } from "@/lib/server/ai";
import { ATTENTION_MAX, DOC_KINDS, homeSummary, recentDocuments } from "@/lib/server/documents";
import { realDocsEnabled, uiV2 } from "@/lib/server/flags";
import { waitingOnOthers } from "@/lib/server/home";
import { listPassports } from "@/lib/server/passport";
import { loadProfile } from "@/lib/server/profile";
import { samplePaperPreviews } from "@/lib/server/sample";
import { DEFAULT_WORKSPACE_NAME, requireWorkspace, viewerZone } from "@/lib/server/session";
import { startPath } from "@/lib/server/start-here";
import { appTools } from "@/lib/server/tools";
import { dayOf } from "@/lib/today";
import { HomeV2 } from "./home-v2";

const TASKS = [
  { href: "/app/make/irs-w9", title: "Fill a W-9", body: "Filled from your business facts." },
  { href: "/app/make/common-paper-mnda", title: "Start an NDA", body: "Common Paper's mutual NDA, cover page filled for you." },
  { href: "/app/documents/new", title: "Add a certificate or license", body: "Keep it with its dates so nothing lapses." },
];

export default async function AppHome() {
  const ctx = await requireWorkspace();
  if (uiV2()) {
    const [summary, recent, waiting, links, zone, start] = await Promise.all([
      homeSummary(ctx),
      recentDocuments(ctx),
      waitingOnOthers(ctx),
      listPassports(ctx),
      viewerZone(),
      startPath(ctx),
    ]);
    return (
      <HomeV2
        needs={summary.attention}
        needsTotal={summary.attentionTotal}
        today={ctx.today}
        canUpload={!ctx.demo && realDocsEnabled()}
        papers={recent}
        previews={await samplePaperPreviews(
          ctx,
          recent.map((d) => d.id),
        )}
        waiting={{ signatures: waiting.signatures.map((s) => ({ ...s, sentOn: dayOf(s.sentAt, zone) })), vendors: waiting.vendors }}
        links={links}
        zone={zone}
        tools={appTools(ctx)}
        aiOn={aiEnabled()}
        start={start}
      />
    );
  }
  const [docs, profile, links] = await Promise.all([homeSummary(ctx), loadProfile(ctx), listPassports(ctx)]);
  const { attention, current, first } = docs;
  const canUpload = !ctx.demo && realDocsEnabled();
  // The list comes most-urgent first: what can still be renewed, then what has lapsed. Shown as two labelled
  // groups, since the date order flips between them.
  const groups = [
    { label: "Coming up", rows: attention.filter((d) => d.validity !== "expired") },
    { label: "Already lapsed", rows: attention.filter((d) => d.validity === "expired") },
  ].filter((g) => g.rows.length > 0);
  // Past the cap: how many are hidden, and whether every one of them has lapsed (the lapsed come last).
  const hidden = docs.attentionTotal - ATTENTION_MAX;
  const hiddenLapsed = docs.lapsedTotal - groups.reduce((n, g) => n + (g.label === "Already lapsed" ? g.rows.length : 0), 0);
  const moreLine =
    hidden === hiddenLapsed ? (hidden === 1 ? "1 more has lapsed" : `${hidden} more have lapsed`) : hidden === 1 ? "1 more needs attention" : `${hidden} more need attention`;

  // First-run checklist, worked out from what's actually in the workspace.
  const setup = [
    {
      done: ctx.name !== DEFAULT_WORKSPACE_NAME || ctx.role === "member",
      href: "/app/settings#workspace",
      title: "Name your workspace",
      body: "People you share with see this name on your links.",
    },
    { done: Object.keys(profile.confirmed).length > 0, href: "/app/facts", title: "Confirm your business facts", body: "Name, address, EIN: typed once, used everywhere." },
    { done: docs.total > 0, href: "/app/documents/new", title: "Add a document you already have", body: "A certificate, license or signed agreement." },
    { done: docs.hasW9, href: "/app/make/irs-w9", title: "Fill a W-9", body: "The official IRS form, filled from your facts." },
    {
      done: docs.hasDates,
      // Straight to the Expires field: the first document (none has dates yet), or a new one.
      href: first ? `/app/documents/${first.id}#expires_on` : "/app/documents/new#expires_on",
      title: "Add an expiry date",
      body: first ? `Start with ${first.title}, so ShipShape can warn you before it lapses.` : "So ShipShape can warn you before it lapses.",
    },
    { done: links.length > 0, href: "/app/passport", title: "Share a passport link", body: "One link with the documents a customer asked for." },
  ];
  const done = setup.filter((s) => s.done).length;
  const next = setup.find((s) => !s.done);

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <p className="eyebrow">{ctx.name}</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">What do you need to get done?</h1>
      </section>

      {next && (
        <section aria-labelledby="setup-title" className="card space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="setup-title" className="font-semibold">
              Get set up
            </h2>
            <p className="text-sm text-ink-2">
              {done} of {setup.length} done
            </p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(done / setup.length) * 100}%` }} />
          </div>
          <p className="text-sm text-ink-2">Once these are done, this page lists only what needs you: documents about to lapse or with a renewal notice due, and what to do about each.</p>
          <ol className="space-y-2">
            {setup.map((s) =>
              s === next ? (
                // The next step is the one action on the card: its body says why, its button does it.
                <li key={s.href} className="flex items-start gap-3 rounded-xl bg-canvas px-2 py-1.5">
                  <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line text-xs" />
                  <span className="space-y-2">
                    <span className="block text-sm font-medium">
                      {s.title}
                      <span className="sr-only"> (next step)</span>
                    </span>
                    <span className="block text-sm text-ink-2">{s.body}</span>
                    <Link href={s.href} className="btn">
                      {s.title}
                    </Link>
                  </span>
                </li>
              ) : (
                <li key={s.href}>
                  <Link href={s.href} className="flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-canvas">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-ok text-white" : "border border-line"}`}
                    >
                      {s.done ? "✓" : ""}
                    </span>
                    <span className={`block text-sm font-medium ${s.done ? "text-ink-3 line-through" : ""}`}>
                      {s.title}
                      <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                    </span>
                  </Link>
                </li>
              ),
            )}
          </ol>
        </section>
      )}

      <ul className="grid gap-3 sm:grid-cols-3">
        {TASKS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="card block h-full hover:border-ink">
              <span className="block font-semibold">{t.title}</span>
              <span className="mt-1 block text-sm text-ink-2">{t.body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl font-semibold">Needs attention</h2>
          {docs.total > 0 && (
            <p className="text-sm text-ink-2">
              {current} of {docs.total} documents current
            </p>
          )}
        </div>
        {attention.length === 0 ? (
          <p className="card text-sm text-ink-2">
            {docs.total === 0
              ? "Documents that have expired, expire, or have a renewal notice due in the next 30 days will be listed here."
              : "Nothing has expired, expires, or has a renewal notice due in the next 30 days."}
          </p>
        ) : (
          <>
            {/* Rule 6, once for the list: what renews a document; each row then says only its own state and action. */}
            <p className="text-sm text-ink-2">
              For a document that&apos;s lapsing, renew it with the issuer, then{" "}
              {canUpload ? "add the new copy and its new date, so your passport links share the current one." : "update its dates."}
            </p>
            {groups.map((g) => (
              <div key={g.label} className="space-y-2">
                <h3 className="eyebrow">{g.label}</h3>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
                  {g.rows.map((d) => {
                    const line = attentionLine(d, ctx.today, canUpload);
                    return (
                      <li key={d.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <span className="min-w-0 space-y-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{d.title}</span>
                            <span className="text-sm text-ink-3">{DOC_KINDS[d.kind]}</span>
                            {line.renewal ? <RenewalChip renewsOn={d.attention_on} /> : <ValidityChip validity={d.validity} expiresOn={d.expires_on} />}
                          </span>
                          <span className="block text-sm text-ink-2">{line.state}</span>
                        </span>
                        <Link href={line.href} className="inline-flex min-h-6 shrink-0 items-center text-sm text-ink-2 underline">
                          {line.action}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
        {docs.attentionTotal > ATTENTION_MAX && (
          <p className="text-sm text-ink-2">
            {`The ${ATTENTION_MAX} most urgent are listed; ${moreLine}.`}{" "}
            <Link href="/app/deadlines" className="underline">
              See every date
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}
