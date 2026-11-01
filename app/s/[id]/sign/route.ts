import { cookies } from "next/headers";
import { z } from "zod";
import { completeSigning, SIGN_COOKIE } from "@/lib/server/esign";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().max(12), typedName: z.string().max(200), consented: z.literal(true).or(z.literal(false)) });

/** Signs with the typed name, the consent and the one-time code. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  const ip = clientIp(req.headers);
  if (await rateLimited("sign-complete", ip, 20, 600)) return tooMany();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Check the form and try again.");
  const { id } = await params;
  const token = (await cookies()).get(SIGN_COOKIE)?.value;
  // No cookie: the page outlived its 30-minute token (lib/server/links.ts), nothing about the link itself. Nothing was signed.
  const result = token ? await completeSigning(id, token, { ...body.data, code: body.data.code.trim(), ip }) : "reopen";
  return Response.json({ result }, { status: result === "invalid" ? 404 : 200, headers: { "Cache-Control": "no-store" } });
}
