import { fail, rateLimited } from "@/lib/server/http";
import { requireWorkspace } from "@/lib/server/session";
import { backToSettings, finishSlackConnect, slackConfig } from "@/lib/server/slack";

export const dynamic = "force-dynamic";

/**
 * Where Slack sends the browser back after "Add to Slack" (lib/server/slack.ts finishSlackConnect). It comes from
 * slack.com, so it can't be same-origin: the state is what proves this session started it. Signed out: sign in
 * first. Always back to Settings' Slack row, saying how it went; never the code or anything Slack sent.
 */
export async function GET(req: Request) {
  const cfg = slackConfig();
  if (!cfg) return fail("Not found", 404);
  const ctx = await requireWorkspace();
  if (await rateLimited("slack-callback", ctx.userId, 20, 3600)) return backToSettings("busy");
  const query = new URL(req.url).searchParams;
  return backToSettings(await finishSlackConnect(cfg, ctx, { code: query.get("code"), state: query.get("state"), error: query.get("error") }));
}
