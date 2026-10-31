import { safeEqual } from "@/lib/server/crypto";
import { runReminders } from "@/lib/server/deadlines";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Daily reminders. The scheduler sends `Authorization: Bearer $CRON_SECRET`; nothing else may run it. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return fail("Reminders aren't set up.", 503);
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail("Forbidden", 403);
  const sent = await runReminders();
  return Response.json({ ok: true, sent }, { headers: { "Cache-Control": "no-store" } });
}
