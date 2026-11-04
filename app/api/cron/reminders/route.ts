import { DAILY_RUN_BUDGET_MS, finishDeletions, purgeSampleAccounts, retryStorageCleanup, sweepDeletedWorkspaces } from "@/lib/server/account";
import { safeEqual } from "@/lib/server/crypto";
import { purgeOutbox, runReminders } from "@/lib/server/deadlines";
import { cronSecret } from "@/lib/server/flags";
import { fail, purgeRateHits } from "@/lib/server/http";
import { sendQueuedMail } from "@/lib/server/mail";
import { purgeSessions } from "@/lib/server/session";

export const dynamic = "force-dynamic";
// The whole run has 50 s from the request (DAILY_RUN_BUDGET_MS, shared by the deletions, the sample
// purge and the stored-file cleanup, Security N-091b); this keeps the function alive for it whatever
// the project's default limit is (N-091c). A run cut short loses nothing: leftovers wait a day.
export const maxDuration = 60;

/**
 * Daily: reminders, clearing rate-limit windows that started over an hour ago (the privacy policy says
 * they're cleared within about a day), finishing account deletions that didn't finish when they
 * were asked for (Security CG-3; the privacy policy says within two days: Vercel runs a daily cron
 * anywhere in its hour, and a failed run leaves the request for the next, CG-6), deleting sample
 * workspaces' accounts within two days, removing stored files a deletion couldn't remove
 * (Security N-091a) and whatever else is still stored under a deleted workspace (W11-7, 0040),
 * deleting session rows that ended over 30 days ago (Design row 34), and deleting
 * outbox reminders over 90 days old and signing-code messages over 1 day old (the privacy policy
 * says so; Security 2026-11-01 0749). Where email is on (SHIPSHAPE_EMAIL=1, lib/server/mail.ts), the
 * reminders just written, and the queued email of each other kind that is on, are then emailed. The scheduler (vercel.json) sends
 * `Authorization: Bearer $CRON_SECRET`; nothing else may run it.
 */
export async function GET(req: Request) {
  const secret = cronSecret();
  if (!secret) return fail("Reminders aren't set up.", 503);
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail("Forbidden", 403);
  // Each runs whatever the others do: a reminders failure mustn't leave fingerprints, deleted
  // accounts or their files past the day the privacy policy promises. Deletions go before the file
  // cleanup, so files a deletion couldn't remove today are retried in the same run.
  const until = Date.now() + DAILY_RUN_BUDGET_MS;
  const reminders = runReminders();
  // Email goes after the reminders are written, whether or not each was: rows already in the outbox still go out.
  const mailing = reminders.then(
    () => sendQueuedMail(until),
    () => sendQueuedMail(until),
  );
  const [sent, mailed, cleared, deletions, samples, sessions, outbox] = await Promise.allSettled([reminders, mailing, purgeRateHits(), finishDeletions(until), purgeSampleAccounts(until), purgeSessions(), purgeOutbox()]);
  const [files, swept] = await Promise.allSettled([retryStorageCleanup(until), sweepDeletedWorkspaces(until)]);
  // Logs the error's name only: its message may hold addresses or query text.
  const log = (what: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected") console.error(`cron: ${what} failed (${r.reason instanceof Error ? r.reason.name : "error"})`);
  };
  log("reminders", sent);
  log("reminder email", mailed);
  log("rate-limit purge", cleared);
  log("account deletions", deletions);
  log("sample purge", samples);
  log("stored-file cleanup", files);
  log("workspace sweep", swept);
  log("session purge", sessions);
  log("outbox purge", outbox);
  const mailFailed = mailed.status === "rejected" || (mailed.value?.failed ?? 0) > 0;
  if (sent.status === "rejected" || sent.value.failed > 0 || mailFailed || cleared.status === "rejected" || deletions.status === "rejected" || deletions.value.failed > 0 || samples.status === "rejected" || samples.value.failed > 0 || files.status === "rejected" || swept.status === "rejected" || sessions.status === "rejected" || outbox.status === "rejected") {
    return fail("The daily run failed.", 500);
  }
  // `mail` only where email is on: off, the answer is exactly what it was before email existed.
  const mail = mailed.value ? { mail: mailed.value } : {};
  return Response.json({ ok: true, sent: sent.value, ...mail, cleared: cleared.value, deletions: deletions.value, samples: samples.value, files: files.value, swept: swept.value, sessions: sessions.value, outbox: outbox.value }, { headers: { "Cache-Control": "no-store" } });
}
