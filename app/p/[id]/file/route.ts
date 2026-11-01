import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp, fail, linkRateLimited } from "@/lib/server/http";
import { PASSPORT_COOKIE, passportFileUrl } from "@/lib/server/passport";

export const dynamic = "force-dynamic";

/**
 * Download from a passport: checks the link again, logs the download, redirects to a 5-minute link.
 * Download is a plain link in a browser tab, so a refusal sends the visitor back to the page, which says
 * what happened (its own limit, the link closed, or its token cookie gone), never a JSON answer.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("Not found", 404);
  const ip = clientIp(req.headers);
  if (await linkRateLimited("passport-file", ip, id, 60, 600)) redirect(`/p/${id}?r=busy`);
  const token = (await cookies()).get(PASSPORT_COOKIE)?.value;
  const url = token ? await passportFileUrl(id, token, new URL(req.url).searchParams.get("d") ?? "", ip) : null;
  if (!url) redirect(token ? `/p/${id}` : `/p/${id}?r=reopen`);
  redirect(url);
}
