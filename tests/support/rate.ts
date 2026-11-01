import { keyedHash } from "@/lib/server/crypto";
import { rateLimited } from "@/lib/server/http";
import type { TestDb } from "./db";

/**
 * Puts `hits` into a rate-limit bucket's current window for `rawKey`, as if that many calls had come in:
 * one real call opens the window, then its count is set directly instead of looping.
 */
export async function fillBucket(db: TestDb, bucket: string, rawKey: string, hits: number, windowSeconds: number) {
  await rateLimited(bucket, rawKey, hits, windowSeconds);
  await db.root((tx) => tx.query("update app.rate_hits set n = $3 where bucket = $1 and key = $2", [bucket, keyedHash(rawKey, bucket), hits]));
}
