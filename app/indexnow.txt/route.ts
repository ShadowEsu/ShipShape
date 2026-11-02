import { indexNowKey } from "@/lib/server/seo";

export const dynamic = "force-dynamic";

/**
 * The IndexNow key file (https://www.indexnow.org/documentation, "keyLocation"): Bing and the other IndexNow engines
 * fetch it to check that a ping for this site came from its owner. The key isn't a secret. 404 while INDEXNOW_KEY is unset.
 */
export function GET() {
  const key = indexNowKey();
  if (!key) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
