import "server-only";
import { asService } from "./db";
import { keyedHash } from "./crypto";

export const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

const STREAM_CHUNK_BYTES = 1024 * 1024;

/**
 * A response body that hands over `bytes` 1 MiB at a time. Vercel caps a buffered function
 * response at 4.5 MB but not a streamed one, so downloads and exports go out this way.
 */
export function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + STREAM_CHUNK_BYTES));
      offset += STREAM_CHUNK_BYTES;
    },
  });
}

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
 * For a link followed on this site (a GET navigation, which carries no Origin header): the browser must say the
 * request came from this site (Sec-Fetch-Site: same-origin), or send a matching Origin. A link on another site, a
 * typed or bookmarked address, and a browser that says neither are refused.
 */
export function sameOriginNavigation(headers: Headers): boolean {
  return headers.get("sec-fetch-site") === "same-origin" || sameOrigin(headers);
}

/** The longest rate-limit window; see app.purge_rate_hits. */
const MAX_WINDOW_SECONDS = 3600;

/**
 * Shared-store rate limit (Postgres), counted per call. The key is an HMAC of the IP or token,
 * never the raw value.
 */
export async function rateLimited(bucket: string, rawKey: string, max: number, windowSeconds: number): Promise<boolean> {
  // app.purge_rate_hits (migration 0020) clears windows that started over an hour ago, so a longer
  // window would be wiped while it's still counting.
  if (windowSeconds > MAX_WINDOW_SECONDS) throw new Error(`Rate limit "${bucket}": a window can't be longer than ${MAX_WINDOW_SECONDS} seconds`);
  const key = keyedHash(rawKey, bucket);
  const [row] = await asService((tx) =>
    tx.query<{ ok: boolean }>("select app.rate_hit($1, $2, $3, $4) as ok", [bucket, key, windowSeconds, max]),
  );
  return !row.ok;
}

/**
 * A public link's limit (W15-13): `max` per network for each link, so one busy link doesn't close another
 * for the same office, and 5× that per network across every link (`<bucket>-net`) as a backstop. The
 * backstop is asked first: once a network is over it, made-up link ids add no more per-link rows.
 */
export async function linkRateLimited(bucket: string, ip: string, linkId: string, max: number, windowSeconds: number): Promise<boolean> {
  return (await rateLimited(`${bucket}-net`, ip, 5 * max, windowSeconds)) || (await rateLimited(bucket, `${ip}|${linkId}`, max, windowSeconds));
}

/** Clears rate-limit windows that started over an hour ago, even with no traffic (the daily cron). Returns how many. */
export async function purgeRateHits(): Promise<number> {
  const [row] = await asService((tx) => tx.query<{ n: number }>("select app.purge_rate_hits() as n"));
  return row.n;
}

// Every limit's window is an hour at most (MAX_WINDOW_SECONDS), so "up to an hour" is always true.
export const tooMany = () => fail("Too many tries from this network. Wait up to an hour, then try again.", 429);
