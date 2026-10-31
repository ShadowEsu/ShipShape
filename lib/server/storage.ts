import "server-only";
import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeEqual } from "./crypto";

/**
 * Document files. Paths always start with the workspace id (`<org>/<document>/v<n>.<ext>`), and a
 * file is only reachable through a signed URL that lives at most 5 minutes, minted by the server
 * after the database confirmed (under RLS) that the caller may see that version.
 *
 * Local and tests: files on disk, served by /api/files with an HMAC signature.
 * Production: the private Supabase Storage bucket `documents` (created and checked by
 * 0013_storage_lockdown.sql) and its signed URLs, on the storage origin (added with the Supabase
 * project; Security R2, C-4).
 */

export const MAX_URL_SECONDS = 300;

/**
 * Every method throws when the store fails; none reports success it didn't have (Security C1-a).
 * Callers depend on it: deleting a vendor file and signing roll the database back when storage
 * throws. The Supabase store must check each response (supabase-js returns `{ error }` rather than
 * throwing) and throw on it.
 */
export interface BlobStore {
  put(objectPath: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(objectPath: string): Promise<Uint8Array>;
  remove(objectPaths: string[]): Promise<void>;
  signedUrl(objectPath: string, opts: { filename: string; inline: boolean; ttlSeconds?: number }): Promise<string>;
}

const SAFE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v[0-9]+\.(pdf|png|jpg)$/;

export function assertObjectPath(p: string) {
  if (!SAFE_PATH.test(p)) throw new Error("Invalid object path");
}

function urlKey(): string {
  const k = process.env.SHIPSHAPE_SESSION_SECRET;
  if (!k || k.length < 32) throw new Error("SHIPSHAPE_SESSION_SECRET must be at least 32 characters");
  return k;
}

/** The signed part of a local file URL. */
export function signFileParams(p: string, exp: number, inline: boolean, filename: string): string {
  return createHmac("sha256", urlKey()).update(`file:${p}:${exp}:${inline ? 1 : 0}:${filename}`).digest("base64url");
}

export interface VerifiedFile {
  objectPath: string;
  inline: boolean;
  filename: string;
}

export function verifyFileParams(q: URLSearchParams, now = Date.now()): VerifiedFile | null {
  const p = q.get("p") ?? "";
  const exp = Number(q.get("e"));
  const inline = q.get("i") === "1";
  const filename = q.get("n") ?? "";
  const sig = q.get("s") ?? "";
  if (!SAFE_PATH.test(p) || !Number.isFinite(exp) || exp * 1000 < now || exp * 1000 > now + MAX_URL_SECONDS * 1000 + 5000) return null;
  if (!/^[\w .()-]{1,120}$/.test(filename)) return null;
  if (!safeEqual(sig, signFileParams(p, exp, inline, filename))) return null;
  return { objectPath: p, inline, filename };
}

export function localBlobStore(root: string): BlobStore {
  const full = (p: string) => {
    assertObjectPath(p);
    return path.join(root, p);
  };
  return {
    async put(p, bytes) {
      const f = full(p);
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, bytes, { flag: "wx" }); // never overwrite: a change is a new version
    },
    async get(p) {
      return new Uint8Array(await readFile(full(p)));
    },
    async remove(paths) {
      await Promise.all(paths.map((p) => rm(full(p), { force: true })));
    },
    async signedUrl(p, { filename, inline, ttlSeconds = MAX_URL_SECONDS }) {
      assertObjectPath(p);
      const exp = Math.floor(Date.now() / 1000) + Math.min(ttlSeconds, MAX_URL_SECONDS);
      const q = new URLSearchParams({ p, e: String(exp), i: inline ? "1" : "0", n: filename });
      q.set("s", signFileParams(p, exp, inline, filename));
      return `/api/files?${q}`;
    },
  };
}

let store: BlobStore | undefined;

export function blobStore(): BlobStore {
  if (!store) {
    if (process.env.NODE_ENV === "production") throw new Error("Production storage needs the Supabase project (not configured)");
    store = localBlobStore(process.env.SHIPSHAPE_BLOB_DIR ?? path.join(process.cwd(), ".data", "blobs"));
  }
  return store;
}

/** Tests use a temporary directory. */
export function setBlobStoreForTests(s: BlobStore) {
  store = s;
}
