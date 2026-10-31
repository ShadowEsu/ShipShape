import "server-only";
import { z } from "zod";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "./http";

/** How long a link's token rides in its cookie after the page posted it. */
export const LINK_COOKIE_SECONDS = 30 * 60;

const Body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/**
 * POST handler for /<base>/<id>/open (passport and signing links, Security E1). The page posts the
 * token from its URL fragment once; it comes back as an HttpOnly cookie scoped to /<base>/<id>, so
 * it never sits in a URL that could reach logs or a Referer header. The answer is the same whether
 * or not the token is right; the page checks it when it renders.
 */
export function openLinkHandler(base: "p" | "s", cookie: string) {
  return async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return fail("Not found", 404);
    if (await rateLimited(`${base}-open`, clientIp(req.headers), 30, 600)) return tooMany();
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return fail("Not found", 404);
    const res = Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.headers.append("Set-Cookie", `${cookie}=${body.data.token}; Path=/${base}/${id}; Max-Age=${LINK_COOKIE_SECONDS}; HttpOnly; SameSite=Strict${secure}`);
    return res;
  };
}
