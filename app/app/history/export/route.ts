import { redirect } from "next/navigation";
import { historyTab } from "@/lib/history";
import { daysParam, HISTORY_DAYS_DEFAULT, historyCsv, listHistory, readsAllHistory } from "@/lib/server/activity";
import { asUser } from "@/lib/server/db";
import { fail, sameOrigin } from "@/lib/server/http";
import { recentEnough, requireWorkspace } from "@/lib/server/session";
import { todayIn } from "@/lib/today";

export const dynamic = "force-dynamic";

/**
 * History's Export: exactly the rows and columns the page lists for these choices, as CSV (Security S6). Owners and
 * admins only, after a recent sign-in, as the workspace export (S2); a form POST, so another site can't start it.
 * Logged as an export in the workspace's own History.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  const ctx = await requireWorkspace();
  if (!readsAllHistory(ctx)) redirect("/app/history?error=role");
  if (!recentEnough(ctx)) redirect("/app/history?error=reauth");
  const form = await req.formData();
  const q = { tab: historyTab(form.get("tab")), mine: form.get("who") === "me", days: daysParam(form.get("days")) ?? HISTORY_DAYS_DEFAULT };
  const { rows } = await listHistory(ctx, q);
  await asUser(ctx.userId, (tx) => tx.query("select app.audit_append($1, 'workspace.exported', $1)", [ctx.orgId]));
  const body = new TextEncoder().encode(historyCsv(rows));
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="shipshape-history-${todayIn("UTC")}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
