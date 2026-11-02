import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app-ui";
import { PLANS } from "@/lib/plans";
import { billingView } from "@/lib/server/billing";
import { listDeadlines, listOutbox, type Deadline } from "@/lib/server/deadlines";
import { DOC_KINDS, firstDocument } from "@/lib/server/documents";
import { uiV2 } from "@/lib/server/flags";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { fmtDay, timeOf } from "@/lib/today";
import { DeadlinesV2 } from "./v2";
import { when } from "./when";

export const metadata: Metadata = { title: "Deadlines" };

function Group({ title, items, tone }: { title: string; items: Deadline[]; tone: "bad" | "warn" | "ok" }) {
  if (!items.length) return null;
  const chip = { bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", ok: "bg-ok-soft text-ok" }[tone];
  const icon = { bad: "!", warn: "◷", ok: "✓" }[tone];
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {items.map((d) => (
          <li key={`${d.document_id}-${d.date_kind}`}>
            <Link href={`/app/documents/${d.document_id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block truncate font-medium">{d.title}</span>
                <span className="block text-sm text-ink-2">
                  {DOC_KINDS[d.kind]} · {d.date_kind === "expires" ? "expires" : "renewal notice"} {fmtDay(d.due_on)}
                </span>
              </span>
              <span className={`inline-flex shrink-0 items-center gap-1 self-start rounded-full px-2 py-0.5 text-xs font-medium sm:self-center ${chip}`}>
                <span aria-hidden="true">{icon}</span>
                {when(d)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** `?soon=1` (the redesigned app's Home, past its 20 rows): only the dates that put a document on Home's list. */
export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<{ soon?: string }> }) {
  const ctx = await requireWorkspace();
  const zone = await viewerZone();
  // Only owners and admins can read the outbox (0039), so a member's page doesn't ask for it.
  const member = ctx.role === "member";
  const [all, outbox, { plan }, sp] = await Promise.all([listDeadlines(ctx), member ? [] : listOutbox(ctx), billingView(ctx), searchParams]);
  // Reminders from ShipShape are a Pro feature (lib/server/deadlines.ts runs them for Pro only); the calendar file works on every plan.
  const reminders = PLANS[plan].emailReminders;
  const quiet = all.length > 0 && all.every((d) => d.days_left > 90);
  // With no dates yet, the action goes straight to the Expires field of the first document, as Home does.
  const first = all.length === 0 ? await firstDocument(ctx) : null;

  if (uiV2())
    return (
      <DeadlinesV2
        all={all}
        outbox={outbox}
        reminders={reminders}
        member={member}
        demo={ctx.demo}
        first={first}
        zone={zone}
        quiet={quiet}
        soon={sp.soon === "1"}
      />
    );

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader eyebrow="Deadlines" title="What's coming up">
        {all.some((d) => d.days_left >= 0) && (
          <a href="/app/deadlines/calendar.ics" className="btn-ghost">
            Add to my calendar
          </a>
        )}
      </PageHeader>
      <p className="text-ink-2">
        Dates come from your documents&apos; expiry and renewal fields.{" "}
        {reminders
          ? "ShipShape reminds owners and admins 90, 30 and 7 days before, and on the day something lapses."
          : "Add these dates to your calendar and set reminders there for 30 and 7 days before. Reminders from ShipShape come with Pro."}
      </p>

      {all.length === 0 ? (
        <EmptyState
          title="No dates yet"
          body="Expiry and renewal dates from your certificates, licenses and agreements show here, soonest first, for example: “General liability certificate · expires Mar 1, 2027 · in 121 days”. Add a date to a document to see it here."
          action={
            first
              ? { href: `/app/documents/${first.id}#expires_on`, label: `Add an expiry date to ${first.title}` }
              : { href: "/app/documents", label: "Add an expiry date" }
          }
        />
      ) : (
        <>
          {quiet && (
            <p role="status" className="card text-sm text-ink-2">
              Nothing expires in the next 90 days.{" "}
              {reminders ? "We'll remind owners and admins 90, 30 and 7 days before." : "Add these dates to your calendar and set reminders there for 30 and 7 days before."}
            </p>
          )}
          <Group title="Lapsed" items={all.filter((d) => d.days_left < 0)} tone="bad" />
          <Group title="Next 30 days" items={all.filter((d) => d.days_left >= 0 && d.days_left <= 30)} tone="warn" />
          <Group title="Later" items={all.filter((d) => d.days_left > 30)} tone="ok" />
        </>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Reminders sent</h2>
        {member ? (
          <p className="card text-sm text-ink-2">Reminders go to owners and admins, and only they can see what was sent.</p>
        ) : (
          <p className="text-sm text-ink-3">
            {ctx.demo
              ? "During the preview ShipShape doesn't send email; reminders and signing codes land here instead."
              : "During the preview, ShipShape doesn't send email: reminders land here instead, and signing codes for real documents aren't shown."}
          </p>
        )}
        {member ? null : outbox.length === 0 ? (
          <p className="card text-sm text-ink-2">
            {reminders ? "Nothing yet. The first reminder lands here 90 days before a date." : "Nothing here: on the Free plan ShipShape doesn't send reminders."}
          </p>
        ) : (
          <ul className="space-y-2">
            {outbox.map((m) => (
              <li key={m.id} className="card space-y-1">
                <p className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium">{m.subject}</span>
                  <time className="text-xs text-ink-3" dateTime={m.created_at}>
                    {timeOf(m.created_at, zone)}
                  </time>
                </p>
                <p className="text-xs text-ink-3">To {m.to_email}</p>
                <p className="whitespace-pre-line text-sm text-ink-2">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
