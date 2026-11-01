import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SIGN_COOKIE, signingFileUrl } from "@/lib/server/esign";
import { clientIp, fail, rateLimited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * The document to sign (or, after signing, the signed copy) as a 5-minute download. A plain link in a
 * browser tab, so a refusal sends the signer back to the page, which says what happened, never a JSON answer.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("Not found", 404);
  if (await rateLimited("sign-file", clientIp(req.headers), 30, 600)) redirect(`/s/${id}?r=busy`);
  const token = (await cookies()).get(SIGN_COOKIE)?.value;
  const url = token ? await signingFileUrl(id, token) : null;
  if (!url) redirect(token ? `/s/${id}` : `/s/${id}?r=reopen`);
  redirect(url);
}
