import { fail, rateLimited, sameOriginNavigation } from "@/lib/server/http";
import { requireWorkspace } from "@/lib/server/session";
import { backToSettings, newSlackState, onPro, slackAuthorizeUrl, slackConfig } from "@/lib/server/slack";

export const dynamic = "force-dynamic";

/**
 * "Connect" on Settings' Slack row (lib/server/slack.ts): an owner or admin of a real workspace on Pro, following the
 * link on this site, is sent to Slack's consent screen with a state bound to this session and workspace. Slack not
 * configured: there's nothing here (404). Another site's link: refused. A member or a sample: back to Settings,
 * refused. Off Pro: back to Settings, Pro only (reminders are part of Pro).
 */
export async function GET(req: Request) {
  const cfg = slackConfig();
  if (!cfg) return fail("Not found", 404);
  if (!sameOriginNavigation(req.headers)) return fail("Forbidden", 403);
  const ctx = await requireWorkspace();
  if (ctx.demo || ctx.role === "member") return backToSettings("refused");
  if (!(await onPro(ctx))) return backToSettings("pro_only");
  if (await rateLimited("slack-start", ctx.userId, 20, 3600)) return backToSettings("busy");
  return new Response(null, { status: 302, headers: { Location: slackAuthorizeUrl(cfg, newSlackState(ctx)), "Cache-Control": "no-store" } });
}
