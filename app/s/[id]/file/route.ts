import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SIGN_COOKIE, signingFileUrl } from "@/lib/server/esign";
import { clientIp, fail, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** The document to sign (or, after signing, the signed copy) as a 5-minute download. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await rateLimited("sign-file", clientIp(req.headers), 30, 600)) return tooMany();
  const { id } = await params;
  const url = await signingFileUrl(id, (await cookies()).get(SIGN_COOKIE)?.value ?? "");
  if (!url) return fail("This link isn't available.", 404);
  redirect(url);
}
