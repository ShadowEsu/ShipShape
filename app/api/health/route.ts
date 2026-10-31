import { dbUp } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Revision, build time and dependency flags only: no environment variable names or values. */
export async function GET() {
  const db = await dbUp();
  return Response.json(
    {
      ok: db,
      revision: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
      builtAt: process.env.SHIPSHAPE_BUILT_AT ?? null,
      db: db ? "up" : "down",
    },
    { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
