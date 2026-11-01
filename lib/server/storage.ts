import "server-only";
import { createHmac } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
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
  /**
   * Removes everything stored under a deleted workspace's `<org id>/` prefix, including objects no
   * row ever pointed at (W11-7); returns how many. Refuses any prefix that isn't exactly a workspace id and a slash.
   */
  removePrefix(prefix: string): Promise<number>;
  signedUrl(objectPath: string, opts: FileUrlOptions): Promise<string>;
}

/** `put` refused because an object is already stored at that path. */
export class ObjectExists extends Error {}

/** `get` found nothing at that path: the object is gone (or was never stored), not a storage fault. */
export class ObjectMissing extends Error {}

interface FileUrlOptions {
  filename: string;
  inline: boolean;
  ttlSeconds?: number;
}

const SAFE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v[0-9]+\.(pdf|png|jpg)$/;

export function assertObjectPath(p: string) {
  if (!SAFE_PATH.test(p)) throw new Error("Invalid object path");
}

// A workspace's own prefix: its id and a slash, nothing else. An empty or short prefix would list
// the whole bucket, and without the slash one id could prefix-match another (Security, 0040).
const WORKSPACE_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/;

export function assertWorkspacePrefix(prefix: string) {
  if (!WORKSPACE_PREFIX.test(prefix)) throw new Error("Invalid workspace prefix");
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
      try {
        await writeFile(f, bytes, { flag: "wx" }); // never overwrite: a change is a new version
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === "EEXIST") throw new ObjectExists(p);
        throw e;
      }
    },
    async get(p) {
      try {
        return new Uint8Array(await readFile(full(p)));
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT") throw new ObjectMissing(p);
        throw e;
      }
    },
    async remove(paths) {
      await Promise.all(paths.map((p) => rm(full(p), { force: true })));
    },
    async removePrefix(prefix) {
      assertWorkspacePrefix(prefix);
      const dir = path.join(root, prefix);
      let files = 0;
      try {
        files = (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT") return 0;
        throw e;
      }
      await rm(dir, { recursive: true, force: true });
      return files;
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
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: p, Body: bytes, ContentType: mime, IfNoneMatch: "*" }));
      } catch (e) {
        if (e instanceof S3ServiceException && (e.name === "PreconditionFailed" || e.$metadata.httpStatusCode === 412)) throw new ObjectExists(p);
        throw e;
      }
    },
    async get(p) {
      assertObjectPath(p);
      try {
        const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: p }));
        if (!Body) throw new Error("S3 returned no file");
        return await Body.transformToByteArray();
      } catch (e) {
        if (e instanceof S3ServiceException && (e.name === "NoSuchKey" || e.$metadata.httpStatusCode === 404)) throw new ObjectMissing(p);
        throw e;
      }
    },
    async remove(paths) {
      for (const p of paths) assertObjectPath(p);
      for (let i = 0; i < paths.length; i += S3_DELETE_BATCH) {
        const objects = paths.slice(i, i + S3_DELETE_BATCH).map((Key) => ({ Key }));
        const { Errors } = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
        if (Errors?.length) throw new Error(`S3 kept ${Errors.length} of the files to delete (${Errors[0].Code ?? "no error code"})`);
      }
    },
    async removePrefix(prefix) {
      // Checked before any listing: an empty or short prefix would list the whole bucket.
      assertWorkspacePrefix(prefix);
      let removed = 0;
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: S3_DELETE_BATCH }));
        const keys = (page.Contents ?? []).flatMap((o) => (o.Key?.startsWith(prefix) ? [o.Key] : []));
        if (keys.length) {
          const { Errors } = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
          if (Errors?.length) throw new Error(`S3 kept ${Errors.length} of the files to delete (${Errors[0].Code ?? "no error code"})`);
          removed += keys.length;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return removed;
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

/**
 * Stores a version's file at the path its row owns. The row was inserted a moment ago under the
 * document's lock, so anything already at that path has no row: a put that landed and then lost its
 * transaction (a failed commit, a function killed at its time limit, a retried PUT whose first try
 * went through). Left alone it would block that version number for good (review #7); it is replaced.
 * `put` itself still never overwrites.
 */
export async function putVersionFile(objectPath: string, bytes: Uint8Array, mime: string): Promise<void> {
  const s = blobStore();
  try {
    await s.put(objectPath, bytes, mime);
  } catch (e) {
    if (!(e instanceof ObjectExists)) throw e;
    console.warn(`storage: replacing a stored file that has no record (${objectPath})`);
    await s.remove([objectPath]);
    await s.put(objectPath, bytes, mime);
  }
}

/** Tests use a temporary directory. */
export function setBlobStoreForTests(s: BlobStore) {
  store = s;
}
