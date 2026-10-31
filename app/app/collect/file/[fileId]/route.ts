import { redirect } from "next/navigation";
import { vendorFileUrl } from "@/lib/server/collect";
import { requireWorkspace } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** A file a vendor sent: checked under RLS, then a 5-minute signed link that always downloads. */
export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const ctx = await requireWorkspace();
  const { fileId } = await params;
  const url = await vendorFileUrl(ctx, fileId);
  if (!url) return new Response("Not found", { status: 404 });
  redirect(url);
}
