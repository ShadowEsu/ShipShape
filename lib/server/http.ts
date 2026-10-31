import "server-only";
import { asService } from "./db";
import { keyedHash } from "./crypto";

export const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** The caller's IP as reported by Vercel's proxy (first hop of x-forwarded-for). */
export const clientIp = (headers: Headers) => headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "unknown";

/**
 * CSRF guard for route handlers (server actions get Next.js's own origin check): the browser
 * must say the request came from this site. Requests without an Origin header are refused.
 */
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Shared-store rate limit (Postgres), counted per call. The key is an HMAC of the IP or token,
 * never the raw value.
 */
export async function rateLimited(bucket: string, rawKey: string, max: number, windowSeconds: number): Promise<boolean> {
  const key = keyedHash(rawKey, bucket);
  const [row] = await asService((tx) =>
    tx.query<{ ok: boolean }>("select app.rate_hit($1, $2, $3, $4) as ok", [bucket, key, windowSeconds, max]),
  );
  return !row.ok;
}

export const tooMany = () => fail("Too many requests. Try again in a little while.", 429);
