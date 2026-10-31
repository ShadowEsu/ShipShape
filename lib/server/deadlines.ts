import "server-only";
import { asService, asUser, pgErrorCode } from "./db";
import { DOC_KINDS, type DocKind } from "./documents";
import type { Ctx } from "./profile";

export type DateKind = "expires" | "renews";

export interface Deadline {
  document_id: string;
  title: string;
  kind: DocKind;
  date_kind: DateKind;
  due_on: string;
  days_left: number;
}

const DATES_SQL = `
  select d.id as document_id, d.title, d.kind, x.date_kind, x.due_on::text as due_on, (x.due_on - $2::date) as days_left
  from app.documents d
  cross join lateral (values ('expires', d.expires_on), ('renews', d.renews_on)) as x(date_kind, due_on)
  where d.org_id = $1 and d.status = 'active' and x.due_on is not null
  order by x.due_on, d.title`;

/** Every expiry and renewal date in the workspace, soonest first (lapsed ones included). */
export async function listDeadlines(ctx: Ctx, today = isoToday()): Promise<Deadline[]> {
  return asUser(ctx.userId, (tx) => tx.query<Deadline>(DATES_SQL, [ctx.orgId, today]));
}

export const isoToday = () => new Date().toISOString().slice(0, 10);

// Calendar file -----------------------------------------------------------------------------------

/** RFC 5545 text: escape \ ; , and newlines, and fold lines at 75 octets. */
function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

const icsDate = (iso: string) => iso.replaceAll("-", "");

/**
 * An all-day event per upcoming date, with alarms 30 and 7 days before. The file names documents
 * by title only; it never contains the documents or any tax identifier.
 */
export function deadlinesIcs(workspace: string, deadlines: Deadline[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ShipShape//Deadlines//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(`${workspace} deadlines`)}`];
  for (const d of deadlines) {
    if (d.days_left < 0) continue;
    const next = new Date(`${d.due_on}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const what = d.date_kind === "expires" ? "expires" : "renewal notice";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${d.document_id}-${d.date_kind}-${icsDate(d.due_on)}@shipshape`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(d.due_on)}`,
      `DTEND;VALUE=DATE:${icsDate(next.toISOString().slice(0, 10))}`,
      `SUMMARY:${icsText(`${d.title} ${what}`)}`,
      `DESCRIPTION:${icsText(`${DOC_KINDS[d.kind]} in ShipShape. Renew it or upload the new one before this date.`)}`,
      "TRANSP:TRANSPARENT",
    );
    for (const days of [30, 7]) {
      if (d.days_left >= days) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(`${d.title} ${what} in ${days} days`)}`, `TRIGGER:-P${days}D`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// Reminders ---------------------------------------------------------------------------------------

/** Reminder points: 90, 30 and 7 days before a date, and once on or just after the day it lapses. */
const DUE_SQL = `
  with dates as (
    select d.id as document_id, d.org_id, d.title, x.date_kind, x.due_on, (x.due_on - $1::date) as days_left
    from app.documents d
    cross join lateral (values ('expires', d.expires_on), ('renews', d.renews_on)) as x(date_kind, due_on)
    where d.status = 'active' and x.due_on is not null and (x.due_on - $1::date) between -30 and 90
      and ($2::uuid is null or d.org_id = $2)
      and app.org_plan(d.org_id) = 'pro' -- email reminders are part of Pro (sample workspaces included)
  ), due as (
    select *, case when days_left <= 0 then 0 when days_left <= 7 then 7 when days_left <= 30 then 30 else 90 end as days_before
    from dates
  )
  select due.document_id, due.org_id, due.title, due.date_kind, due.due_on::text as due_on, due.days_left, due.days_before
  from due
  where not exists (
    select 1 from app.reminders_sent r where r.document_id = due.document_id and r.due_on = due.due_on and r.days_before = due.days_before
  )
  order by due.org_id, due.due_on`;

interface DueReminder {
  document_id: string;
  org_id: string;
  title: string;
  date_kind: DateKind;
  due_on: string;
  days_left: number;
  days_before: number;
}

function reminderText(r: DueReminder): { subject: string; body: string } {
  const what = r.date_kind === "expires" ? "expires" : "is due for renewal";
  const when = r.days_left > 0 ? `in ${r.days_left} ${r.days_left === 1 ? "day" : "days"} (${r.due_on})` : r.days_left === 0 ? "today" : `on ${r.due_on}`;
  const subject = (r.days_left >= 0 ? `${r.title} ${what} ${r.days_left > 0 ? `in ${r.days_left} days` : "today"}` : `${r.title} has lapsed`).slice(0, 200);
  const body = [
    `${r.title} ${r.days_left >= 0 ? what : r.date_kind === "expires" ? "expired" : "passed its renewal date"} ${when}.`,
    "Renew it, then upload the new version in ShipShape so your passport links share the current one.",
    "You get this reminder because you're an owner or admin of the workspace.",
  ].join("\n\n");
  return { subject, body };
}

/**
 * Sends every reminder that is due and not sent yet: to each owner and admin of the workspace,
 * through the outbox (email sending is off). Safe to run as often as you like: each reminder goes
 * out once. Runs as the service role because it works across workspaces (a scheduled job, no user);
 * `onlyOrg` limits it to one workspace (a sample workspace right after it is made).
 * Each reminder is written in its own savepoint (Security R-1tx): one that can't be written is
 * skipped, logged and left unsent, so the next run tries it again, and the others still go out.
 */
export async function runReminders(today = isoToday(), onlyOrg: string | null = null): Promise<{ sent: number; failed: number }> {
  return asService(async (tx) => {
    const due = await tx.query<DueReminder>(DUE_SQL, [today, onlyOrg]);
    let sent = 0;
    let failed = 0;
    for (const r of due) {
      try {
        await tx.savepoint(async (sp) => {
          // Sample workspaces' people have no email address; their reminders go to a made-up one.
          const recipients = await sp.query<{ email: string }>(
            `select coalesce(u.email, case when o.is_demo then 'you@sample.example' end) as email
             from app.members m join auth.users u on u.id = m.user_id join app.organizations o on o.id = m.org_id
             where m.org_id = $1 and m.role in ('owner', 'admin') and coalesce(u.email, case when o.is_demo then 'x' end) is not null`,
            [r.org_id],
          );
          const { subject, body } = reminderText(r);
          for (const to of recipients) {
            await sp.query("insert into app.outbox (org_id, to_email, subject, body) values ($1, $2, $3, $4)", [r.org_id, to.email, subject, body]);
          }
          await sp.query("insert into app.reminders_sent (document_id, org_id, due_on, days_before) values ($1, $2, $3, $4) on conflict do nothing", [
            r.document_id,
            r.org_id,
            r.due_on,
            r.days_before,
          ]);
        });
        sent++;
      } catch (e) {
        failed++;
        // The document's id and the error's code only: the message may hold addresses or query text.
        console.error(`reminders: ${r.document_id} not sent (${pgErrorCode(e) ?? (e instanceof Error ? e.name : "error")})`);
      }
    }
    return { sent, failed };
  });
}

export interface OutboxMessage {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  created_at: string;
}

export async function listOutbox(ctx: Ctx): Promise<OutboxMessage[]> {
  return asUser(ctx.userId, (tx) =>
    tx.query<OutboxMessage>(
      "select id, to_email, subject, body, created_at::text as created_at from app.outbox where org_id = $1 order by created_at desc limit 100",
      [ctx.orgId],
    ),
  );
}
