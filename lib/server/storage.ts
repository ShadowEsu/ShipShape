import "server-only";
import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { productionAwsClient } from "./aws";
import { safeEqual } from "./crypto";

/**
 * Document files. Paths always start with the workspace id (`<org>/<document>/v<n>.<ext>`), and a
 * file is only reachable through a link the server signs for at most 5 minutes, minted after the
 * database confirmed (under RLS) that the caller may see that version. /api/files checks the link
 * and streams the bytes from the store, so no storage URL ever reaches a browser (Security R2, C-4).
 *
 * Local and tests: files on disk. Production: one private S3 bucket (`s3BlobStore`, aws-plan.md).
 */

export const MAX_URL_SECONDS = 300;

/**
 * Every method throws when the store fails; none reports success it didn't have (Security C1-a).
 * Callers depend on it: deleting a vendor file and signing roll the database back when storage
 * throws. The S3 store gets this from the SDK, which throws on error responses, and throws itself
 * on the per-file errors a batch delete reports in a successful response.
 */
export interface BlobStore {
  put(objectPath: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(objectPath: string): Promise<Uint8Array>;
  remove(objectPaths: string[]): Promise<void>;
  signedUrl(objectPath: string, opts: FileUrlOptions): Promise<string>;
}

interface FileUrlOptions {
  filename: string;
  inline: boolean;
  ttlSeconds?: number;
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

/** The signed part of a file URL. */
export function signFileParams(p: string, exp: number, inline: boolean, filename: string): string {
  return createHmac("sha256", urlKey()).update(`file:${p}:${exp}:${inline ? 1 : 0}:${filename}`).digest("base64url");
}

/**
 * A name in the characters /api/files writes into its Content-Disposition header as they are (the
 * set verifyFileParams accepts): accents folded ("Müller" → "Muller"), anything else dropped.
 */
export function foldName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w .()-]+/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** foldName, at most 120 characters, keeping the extension; "file" when nothing else is left. */
export function headerSafeName(name: string): string {
  const folded = foldName(name);
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(folded)?.[0] ?? "";
  const base = folded
    .slice(0, folded.length - ext.length)
    .slice(0, 120 - ext.length)
    .trim();
  return `${base || "file"}${ext}`;
}

/**
 * The link /api/files serves, whichever store holds the file: signed here, valid at most 5 minutes.
 * Any name works: it's made header-safe here, so the link always passes verifyFileParams.
 */
export async function fileUrl(p: string, { filename, inline, ttlSeconds = MAX_URL_SECONDS }: FileUrlOptions): Promise<string> {
  assertObjectPath(p);
  const exp = Math.floor(Date.now() / 1000) + Math.min(ttlSeconds, MAX_URL_SECONDS);
  const name = headerSafeName(filename);
  const q = new URLSearchParams({ p, e: String(exp), i: inline ? "1" : "0", n: name });
  q.set("s", signFileParams(p, exp, inline, name));
  return `/api/files?${q}`;
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
    signedUrl: fileUrl,
  };
}

/**
 * Files in one private S3 bucket (aws-plan.md: Block Public Access, SSE-KMS by default, versioning
 * with a 7-day noncurrent expiry). Downloads still go through /api/files; the bucket is never
 * linked to.
 */
export function s3BlobStore(client: S3Client, bucket: string): BlobStore {
  return {
    async put(p, bytes, mime) {
      assertObjectPath(p);
      // Never overwrite: a change is a new version. S3 refuses the write (412) if the path exists.
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: p, Body: bytes, ContentType: mime, IfNoneMatch: "*" }));
    },
    async get(p) {
      assertObjectPath(p);
      const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: p }));
      if (!Body) throw new Error("S3 returned no file");
      return Body.transformToByteArray();
    },
    async remove(paths) {
      for (const p of paths) assertObjectPath(p);
      for (let i = 0; i < paths.length; i += S3_DELETE_BATCH) {
        const objects = paths.slice(i, i + S3_DELETE_BATCH).map((Key) => ({ Key }));
        const { Errors } = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
        if (Errors?.length) throw new Error(`S3 kept ${Errors.length} of the files to delete (${Errors[0].Code ?? "no error code"})`);
      }
    },
    signedUrl: fileUrl,
  };
}
const S3_DELETE_BATCH = 1000; // the most one DeleteObjects request takes

type Env = Record<string, string | undefined>;

/**
 * Production signs S3 calls with credentials for AWS_ROLE_ARN, obtained per request from Vercel's
 * OIDC token, and reaches only AWS's own endpoint (productionAwsClient; aws-plan.md). Elsewhere (a
 * local S3 stand-in) the SDK's usual credentials and SHIPSHAPE_S3_ENDPOINT apply.
 */
function s3Client(env: Env): S3Client {
  const region = env.AWS_REGION;
  if (!region) throw new Error("S3 storage needs AWS_REGION");
  const endpoint = env.SHIPSHAPE_S3_ENDPOINT;
  if (env.NODE_ENV === "production") {
    if (endpoint) throw new Error("Production S3 storage refuses SHIPSHAPE_S3_ENDPOINT (a local stand-in)");
    return new S3Client({ region, ...productionAwsClient(env, "Production S3 storage") });
  }
  return new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
}

/** The store a deployment uses, from its environment: S3 when a bucket is set; a folder only outside production. */
export function storeFromEnv(env: Env): BlobStore {
  const bucket = env.SHIPSHAPE_S3_BUCKET;
  if (bucket) return s3BlobStore(s3Client(env), bucket);
  if (env.NODE_ENV === "production") throw new Error("Production storage needs SHIPSHAPE_S3_BUCKET (not configured)");
  return localBlobStore(env.SHIPSHAPE_BLOB_DIR ?? path.join(process.cwd(), ".data", "blobs"));
}

let store: BlobStore | undefined;

export function blobStore(): BlobStore {
  store ??= storeFromEnv(process.env);
  return store;
}

/** Tests use a temporary directory. */
export function setBlobStoreForTests(s: BlobStore) {
  store = s;
}
