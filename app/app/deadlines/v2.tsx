import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import type { Deadline, OutboxMessage } from "@/lib/server/deadlines";
import { DOC_KINDS } from "@/lib/server/documents";
import { fmtDay, timeOf } from "@/lib/today";
import { when } from "./when";

const TONE = {
  bad: { chip: "bg-bad-soft text-bad", icon: "!" },
  warn: { chip: "bg-warn-soft text-warn", icon: "◷" },
  ok: { chip: "bg-ok-soft text-ok", icon: "✓" },
} as const;

/**
 * The dates that put a document on Home's "Needs attention" (ATTENTION_SQL in lib/server/documents.ts): an expiry that
 * has lapsed or falls within 30 days, and a renewal notice due within 30 days. A passed renewal date isn't one: Home
 * drops it, so the filtered list does too.
 */
export function needsAttention(d: Deadline): boolean {
  return d.date_kind === "expires" ? d.days_left <= 30 : d.days_left >= 0 && d.days_left <= 30;
}

function Group({ title, items, tone }: { title: string; items: Deadline[]; tone: keyof typeof TONE }) {
  if (!items.length) return null;
  const t = TONE[tone];
  return (
    <section className="space-y-2">
      <h2 className="section-title flex items-baseline gap-2">
        {title}
        <span className="text-[15px] font-normal text-ink-3">{items.length}</span>
      </h2>
      <ul className="group-list stagger">
        {items.map((d, n) => (
          <li key={`${d.document_id}-${d.date_kind}`} style={{ "--i": n }}>
            {/* As on Documents: on the phone the chip wraps under the text, lined up with it; from sm up it sits beside it. */}
            <Link href={`/app/documents/${d.document_id}`} className="group-row flex-wrap gap-y-1.5 sm:flex-nowrap">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-tile text-ink-2">
                <Icon name="documents" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.title}</span>
                <span className="block truncate text-[13px] text-ink-3">
                  {DOC_KINDS[d.kind]} · {d.date_kind === "expires" ? "expires" : "renewal notice"} {fmtDay(d.due_on)}
                </span>
              </span>
              <span className="ml-11 basis-full sm:ml-0 sm:basis-auto">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${t.chip}`}>
                  <span aria-hidden="true">{t.icon}</span>
                  {when(d)}
                </span>
              </span>
              <span className="hidden text-ink-3 sm:block">
                <Icon name="chevron" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One reminder: its subject, who it went to and when, and the email itself behind "Show the email" (Design, 02 Nov). */
function Sent({ m, zone }: { m: OutboxMessage; zone: string }) {
  return (
    <details className="group">
      <summary className="flex min-h-15 cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{m.subject}</span>
          <span className="block text-[13px] text-ink-3">
            To {m.to_email} ·{" "}
            <time dateTime={m.created_at}>{timeOf(m.created_at, zone)}</time>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm text-ink underline">
          <span className="group-open:hidden">Show the email</span>
          <span className="hidden group-open:inline">Hide the email</span>
          <span className="disclosure-chevron rotate-90 group-open:-rotate-90">
            <Icon name="chevron" size={16} />
          </span>
        </span>
      </summary>
      <p className="mx-4 mb-3 rounded-xl bg-tile px-3 py-2.5 text-sm whitespace-pre-line text-ink-2">{m.body}</p>
    </details>
  );
}

/**
 * Deadlines in the redesigned app (Design spec 2026-11-02 §4, PR 7): the same dates, groups and words as the current
 * page, as grouped lists with each group's count; "Add to my calendar" is the one primary; each reminder's email opens
 * in place. `soon`: only what needs attention (Home's "See all N in Deadlines"), with the way back to every date.
 */
export function DeadlinesV2({
  all,
  outbox,
  reminders,
  member,
  demo,
  first,
  zone,
  quiet,
  soon,
}: {
  all: Deadline[];
  outbox: OutboxMessage[];
  reminders: boolean;
  member: boolean;
  demo: boolean;
  first: { id: string; title: string } | null;
  zone: string;
  quiet: boolean;
  soon: boolean;
}) {
  const shown = soon ? all.filter(needsAttention) : all;
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Deadlines" title="What's coming up">
        {all.some((d) => d.days_left >= 0) && (
          <a href="/app/deadlines/calendar.ics" className="btn press">
            Add to my calendar
          </a>
        )}
      </PageHeader>
      <p className="max-w-2xl text-ink-2">
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
          {soon && (
            <p className="rounded-2xl bg-tile px-4 py-3 text-sm text-ink-2">
              {shown.length === 0 ? "Nothing has lapsed or is due in the next 30 days." : "Showing what has lapsed or is due in the next 30 days."}{" "}
              <Link href="/app/deadlines" className="text-ink underline">
                Show every date
              </Link>
            </p>
          )}
          {quiet && !soon && (
            <p role="status" className="rounded-2xl bg-tile px-4 py-3 text-sm text-ink-2">
              Nothing expires in the next 90 days.{" "}
              {reminders ? "We'll remind owners and admins 90, 30 and 7 days before." : "Add these dates to your calendar and set reminders there for 30 and 7 days before."}
            </p>
          )}
          <Group title="Lapsed" items={shown.filter((d) => d.days_left < 0)} tone="bad" />
          <Group title="Next 30 days" items={shown.filter((d) => d.days_left >= 0 && d.days_left <= 30)} tone="warn" />
          <Group title="Later" items={shown.filter((d) => d.days_left > 30)} tone="ok" />
        </>
      )}

      <section className="space-y-2">
        <h2 className="section-title">Reminders sent</h2>
        {member ? (
          <p className="rounded-2xl bg-tile px-4 py-3 text-sm text-ink-2">Reminders go to owners and admins, and only they can see what was sent.</p>
        ) : (
          <p className="text-sm text-ink-3">
            {demo
              ? "During the preview ShipShape doesn't send email; reminders and signing codes land here instead."
              : "During the preview, ShipShape doesn't send email: reminders land here instead, and signing codes for real documents aren't shown."}
          </p>
        )}
        {member ? null : outbox.length === 0 ? (
          <p className="rounded-2xl bg-tile px-4 py-3 text-sm text-ink-2">
            {reminders ? "Nothing yet. The first reminder lands here 90 days before a date." : "Nothing here: on the Free plan ShipShape doesn't send reminders."}
          </p>
        ) : (
          <ul className="group-list plain">
            {outbox.map((m) => (
              <li key={m.id}>
                <Sent m={m} zone={zone} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
