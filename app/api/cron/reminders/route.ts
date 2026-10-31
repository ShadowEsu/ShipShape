import { safeEqual } from "@/lib/server/crypto";
import { runReminders } from "@/lib/server/deadlines";
import { fail, purgeRateHits } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Daily: reminders, and clearing rate-limit fingerprints older than a day (the privacy policy says
 * they're cleared within a day). The scheduler (vercel.json) sends `Authorization: Bearer
 * $CRON_SECRET`; nothing else may run it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return fail("Reminders aren't set up.", 503);
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail("Forbidden", 403);
  const sent = await runReminders();
  const cleared = await purgeRateHits();
  return Response.json({ ok: true, sent, cleared }, { headers: { "Cache-Control": "no-store" } });
}
