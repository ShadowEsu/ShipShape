import { redirect } from "next/navigation";
import { exportWorkspace } from "@/lib/server/account";
import { UserError } from "@/lib/server/documents";
import { fail, sameOrigin } from "@/lib/server/http";
import { NeedsRecentSignIn } from "@/lib/server/profile";
import { requireWorkspace } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Downloads the whole workspace as a ZIP (a form POST, so another site can't start it). */
export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  const ctx = await requireWorkspace();
  let out: { filename: string; bytes: Uint8Array };
  try {
    out = await exportWorkspace(ctx);
  } catch (e) {
    if (e instanceof NeedsRecentSignIn) redirect("/app/settings?error=reauth");
    if (e instanceof UserError) redirect(`/app/settings?error=${ctx.role === "member" ? "role" : "size"}`);
    throw e;
  }
  return new Response(Buffer.from(out.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
