import { z } from "zod";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "@/lib/server/http";
import { PASSPORT_COOKIE, PASSPORT_COOKIE_SECONDS } from "@/lib/server/passport";

export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/**
 * The passport page posts the token from its URL fragment here once. The token then travels as an
 * HttpOnly cookie scoped to /p/<id>, never in a URL that could reach logs or a Referer header.
 * The answer is the same whether or not the token is right; the page checks it when it renders.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("Not found", 404);
  if (await rateLimited("passport-open", clientIp(req.headers), 30, 600)) return tooMany();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Not found", 404);
  const res = Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `${PASSPORT_COOKIE}=${body.data.token}; Path=/p/${id}; Max-Age=${PASSPORT_COOKIE_SECONDS}; HttpOnly; SameSite=Strict${secure}`,
  );
  return res;
}
