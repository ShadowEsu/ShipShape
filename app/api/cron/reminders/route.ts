import { finishDeletions } from "@/lib/server/account";
import { safeEqual } from "@/lib/server/crypto";
import { runReminders } from "@/lib/server/deadlines";
import { fail, purgeRateHits } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Daily: reminders, clearing rate-limit windows that started over an hour ago (the privacy policy says
 * they're cleared within about a day), and finishing account deletions that didn't finish when they
 * were asked for (Security CG-3; the privacy policy says within a day). The scheduler (vercel.json)
 * sends `Authorization: Bearer $CRON_SECRET`; nothing else may run it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return fail("Reminders aren't set up.", 503);
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail("Forbidden", 403);
  // Each runs whatever the others do: a reminders failure mustn't leave fingerprints, or deleted
  // accounts, past the day the privacy policy promises.
  const [sent, cleared, deletions] = await Promise.allSettled([runReminders(), purgeRateHits(), finishDeletions()]);
  // Logs the error's name only: its message may hold addresses or query text.
  const log = (what: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected") console.error(`cron: ${what} failed (${r.reason instanceof Error ? r.reason.name : "error"})`);
  };
  log("reminders", sent);
  log("rate-limit purge", cleared);
  log("account deletions", deletions);
  if (sent.status === "rejected" || cleared.status === "rejected" || deletions.status === "rejected" || deletions.value.failed > 0) {
    return fail("The daily run failed.", 500);
  }
  return Response.json({ ok: true, sent: sent.value, cleared: cleared.value, deletions: deletions.value }, { headers: { "Cache-Control": "no-store" } });
}
