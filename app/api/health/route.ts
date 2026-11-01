import { dbUp } from "@/lib/server/db";
import { launchProblems } from "@/lib/server/launch-check";

export const dynamic = "force-dynamic";

/**
 * Revision, build time and dependency flags only: no environment variable names or values. `config`
 * is whether the deployment has every setting it needs (W12-2), so the launch's last check fails on
 * a missing secret, not only on a database that doesn't answer.
 */
export async function GET() {
  const db = await dbUp();
  const config = launchProblems(process.env).length === 0;
  return Response.json(
    {
      ok: db && config,
      revision: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
      builtAt: process.env.SHIPSHAPE_BUILT_AT ?? null,
      db: db ? "up" : "down",
      config: config ? "ok" : "missing",
    },
    { status: db && config ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
