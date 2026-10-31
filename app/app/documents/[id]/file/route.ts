import { redirect } from "next/navigation";
import { downloadUrl, UserError } from "@/lib/server/documents";
import { requireWorkspace } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Checks access under RLS, logs the view or download, then redirects to a 5-minute signed link. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace();
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const version = Number(q.get("v"));
  const mode = q.get("mode") === "download" ? "download" : "view";
  if (!Number.isInteger(version) || version < 1) return new Response("Not found", { status: 404 });
  let url: string;
  try {
    url = await downloadUrl(ctx, id, version, mode);
  } catch (e) {
    if (e instanceof UserError) return new Response("Not found", { status: 404 });
    throw e;
  }
  redirect(url);
}
