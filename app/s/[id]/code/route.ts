import { cookies } from "next/headers";
import { sendSigningCode, SIGN_COOKIE } from "@/lib/server/esign";
import { clientIp, fail, linkRateLimited, sameOrigin, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Sends the signer a one-time code (5 per request in the database, plus a per-network limit here). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  const { id } = await params;
  if (await linkRateLimited("sign-code", clientIp(req.headers), id, 10, 600)) return tooMany();
  const token = (await cookies()).get(SIGN_COOKIE)?.value;
  // No cookie: the page outlived its 30-minute token (lib/server/links.ts), nothing about the link itself. The signer reopens it.
  const result = token ? await sendSigningCode(id, token) : "reopen";
  return Response.json({ result }, { status: result === "invalid" ? 404 : 200, headers: { "Cache-Control": "no-store" } });
}
