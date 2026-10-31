import { deadlinesIcs, listDeadlines } from "@/lib/server/deadlines";
import { requireWorkspace } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** The workspace's upcoming dates as a calendar file to import (a download, not a public feed). */
export async function GET() {
  const ctx = await requireWorkspace();
  const ics = deadlinesIcs(ctx.name, await listDeadlines(ctx));
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="shipshape-deadlines.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
