import { safeEqual } from "@/lib/server/crypto";
import { runReminders } from "@/lib/server/deadlines";
import { fail, purgeRateHits } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Daily: reminders, and clearing rate-limit windows that started over an hour ago (the privacy policy says
 * they're cleared within a day). The scheduler (vercel.json) sends `Authorization: Bearer
 * $CRON_SECRET`; nothing else may run it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return fail("Reminders aren't set up.", 503);
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail("Forbidden", 403);
  // Both run whatever the other does: a reminders failure mustn't leave fingerprints past the day
  // the privacy policy promises.
  const [sent, cleared] = await Promise.allSettled([runReminders(), purgeRateHits()]);
  // Logs the error's name only: its message may hold addresses or query text.
  if (sent.status === "rejected") console.error(`cron: reminders failed (${sent.reason instanceof Error ? sent.reason.name : "error"})`);
  if (cleared.status === "rejected") console.error(`cron: rate-limit purge failed (${cleared.reason instanceof Error ? cleared.reason.name : "error"})`);
  if (sent.status === "rejected" || cleared.status === "rejected") return fail("The daily run failed.", 500);
  return Response.json({ ok: true, sent: sent.value, cleared: cleared.value }, { headers: { "Cache-Control": "no-store" } });
}
