import { cookies } from "next/headers";
import { sendSigningCode, SIGN_COOKIE } from "@/lib/server/esign";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Sends the signer a one-time code (5 per request in the database, plus a per-network limit here). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  if (await rateLimited("sign-code", clientIp(req.headers), 10, 600)) return tooMany();
  const { id } = await params;
  const token = (await cookies()).get(SIGN_COOKIE)?.value ?? "";
  const result = await sendSigningCode(id, token);
  return Response.json({ result }, { status: result === "invalid" ? 404 : 200, headers: { "Cache-Control": "no-store" } });
}
