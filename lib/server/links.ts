import "server-only";
import { z } from "zod";
import { sha256Hex } from "./crypto";
import { asAnon } from "./db";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "./http";

/** How long a link's token rides in its cookie after the page posted it. */
export const LINK_COOKIE_SECONDS = 30 * 60;

const Body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/** Why a link someone holds no longer opens: it ran out (when) or its sender turned it off. */
export type LinkEnd = { state: "expired"; endedAt: string } | { state: "revoked" };

const END_SQL: Record<"p" | "s" | "c", string> = {
  p: "select state, ended_at::text as ended_at from app.passport_state($1, $2)",
  s: "select state, ended_at::text as ended_at from app.esign_state($1, $2)",
  c: "select state, ended_at::text as ended_at from app.collect_state($1, $2)",
};

/**
 * Asked only after an open returned nothing, under the page's own rate limit (Design row 18; Security
 * 2026-11-01): the database answers only for the link's own token, says "expired" with the end time or
 * "revoked" with nothing more, and writes nothing. A wrong token or an unknown link gets null, like before.
 */
export async function linkEnd(base: "p" | "s" | "c", id: string, token: string): Promise<LinkEnd | null> {
  if (!z.uuid().safeParse(id).success || !Body.shape.token.safeParse(token).success) return null;
  const [row] = await asAnon((tx) => tx.query<{ state: string; ended_at: string | null }>(END_SQL[base], [id, sha256Hex(token)]));
  if (!row) return null;
  return row.state === "expired" && row.ended_at ? { state: "expired", endedAt: row.ended_at } : { state: "revoked" };
}

/**
 * POST handler for /<base>/<id>/open (passport, signing and upload links, Security E1). The page posts the
 * token from its URL fragment once; it comes back as an HttpOnly cookie scoped to /<base>/<id>, so
 * it never sits in a URL that could reach logs or a Referer header. The answer is the same whether
 * or not the token is right; the page checks it when it renders.
 */
export function openLinkHandler(base: "p" | "s" | "c", cookie: string) {
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
