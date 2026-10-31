import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BlobStore, localBlobStore, MAX_URL_SECONDS, s3BlobStore, storeFromEnv, verifyFileParams } from "@/lib/server/storage";

const newPath = () => `${randomUUID()}/${randomUUID()}/v1.pdf`;
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

/** What every store promises its callers (C1-a: a failure throws, never looks like success). */
function contract(store: () => BlobStore) {
  it("gives back exactly the bytes it was given", async () => {
    const p = newPath();
    const data = new Uint8Array([0, 255, 37, 80, 68, 70, 10, 13]);
    await store().put(p, data, "application/pdf");
    expect(Array.from(await store().get(p))).toEqual(Array.from(data));
  });

  it("never overwrites: a second write to a path fails and the first file stays", async () => {
    const p = newPath();
    await store().put(p, bytes("first"), "application/pdf");
    await expect(store().put(p, bytes("second"), "application/pdf")).rejects.toThrow();
    expect(text(await store().get(p))).toBe("first");
  });

  it("fails on a missing file instead of returning nothing", async () => {
    await expect(store().get(newPath())).rejects.toThrow();
  });

  it("removes the files named, accepts ones already gone, and leaves the rest", async () => {
    const [gone, kept, never] = [newPath(), newPath(), newPath()];
    await store().put(gone, bytes("gone"), "application/pdf");
    await store().put(kept, bytes("kept"), "application/pdf");
    await store().remove([gone, never]);
    await expect(store().get(gone)).rejects.toThrow();
    expect(text(await store().get(kept))).toBe("kept");
    await store().remove([]);
  });

  it("refuses a path outside <org>/<document>/v<n>.<ext> on every call", async () => {
    for (const bad of ["../../etc/passwd", `${randomUUID()}/${randomUUID()}/v1.html`, `${randomUUID()}/v1.pdf`]) {
      await expect(store().put(bad, bytes("x"), "application/pdf")).rejects.toThrow("Invalid object path");
      await expect(store().get(bad)).rejects.toThrow("Invalid object path");
      await expect(store().remove([newPath(), bad])).rejects.toThrow("Invalid object path");
      await expect(store().signedUrl(bad, { filename: "a.pdf", inline: true })).rejects.toThrow("Invalid object path");
    }
  });

  it("links only through /api/files, for at most 5 minutes", async () => {
    const p = newPath();
    const url = await store().signedUrl(p, { filename: "Lease v1.pdf", inline: false, ttlSeconds: 3600 });
    expect(url.startsWith("/api/files?")).toBe(true);
    const q = new URL(url, "http://x").searchParams;
    expect(verifyFileParams(q)).toEqual({ objectPath: p, inline: false, filename: "Lease v1.pdf" });
    expect(Number(q.get("e")) - Date.now() / 1000).toBeLessThanOrEqual(MAX_URL_SECONDS);
  });
}

describe("local file store", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "shipshape-blobs-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));
  contract(() => localBlobStore(dir));
});

describe("which store a deployment uses (Security D-2)", () => {
  const production = { NODE_ENV: "production", SHIPSHAPE_S3_BUCKET: "shipshape-files", AWS_REGION: "us-east-1", AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/shipshape-prod-app" };

  it("in production, only the S3 bucket through the OIDC role: no folder, no stand-in endpoint, nothing half set", () => {
    expect(() => storeFromEnv({ NODE_ENV: "production" })).toThrow("needs SHIPSHAPE_S3_BUCKET");
    expect(() => storeFromEnv({ ...production, SHIPSHAPE_BLOB_DIR: "/tmp/files", SHIPSHAPE_S3_BUCKET: undefined })).toThrow("needs SHIPSHAPE_S3_BUCKET");
    expect(() => storeFromEnv({ ...production, AWS_ROLE_ARN: undefined })).toThrow("needs AWS_ROLE_ARN");
    expect(() => storeFromEnv({ ...production, SHIPSHAPE_S3_ENDPOINT: "http://127.0.0.1:5917" })).toThrow("no SHIPSHAPE_S3_ENDPOINT");
    expect(() => storeFromEnv({ ...production, AWS_REGION: undefined })).toThrow("needs AWS_REGION");
    // The complete set is accepted (no AWS call happens until a file is stored or read).
    expect(() => storeFromEnv(production)).not.toThrow();
  });
});

describe("S3 store, offline", () => {
  const offlineClient = () => new S3Client({ region: "us-east-1", credentials: { accessKeyId: "test", secretAccessKey: "test" } });

  it("throws when S3 answers a batch delete but kept some of the files (C1-a)", async () => {
    const client = offlineClient();
    // Answers every request itself, the way S3 reports per-file failures inside a 200 response.
    client.middlewareStack.add(() => async () => ({ output: { Errors: [{ Key: "k", Code: "AccessDenied" }], $metadata: {} }, response: {} }), { step: "initialize" });
    await expect(s3BlobStore(client, "documents").remove([newPath()])).rejects.toThrow("S3 kept 1 of the files to delete (AccessDenied)");
  });

  it("splits a large delete into requests S3 accepts (at most 1,000 files each), every file once", async () => {
    const client = offlineClient();
    const sent: string[][] = [];
    client.middlewareStack.add(
      () => async (args) => {
        if ("Delete" in args.input) sent.push((args.input.Delete?.Objects ?? []).map((o) => o.Key ?? ""));
        return { output: { $metadata: {} }, response: {} };
      },
      { step: "initialize" },
    );
    const paths = Array.from({ length: 2001 }, newPath);
    await s3BlobStore(client, "documents").remove(paths);
    expect(sent.map((keys) => keys.length)).toEqual([1000, 1000, 1]);
    expect(sent.flat()).toEqual(paths);
  });
});

// Against a real S3 API (moto locally; see README "Run it"). Skipped unless the endpoint is set.
const endpoint = process.env.SHIPSHAPE_S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)("S3 store against an S3 API (npm run test:s3)", () => {
  const client = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } });
  const bucket = `shipshape-test-${randomUUID()}`;
  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    // Like production: deleted files become noncurrent versions, and writes still never overwrite.
    await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
  });
  contract(() => s3BlobStore(client, bucket));

  it("throws on every call when the bucket isn't there (C1-a)", async () => {
    const store = s3BlobStore(client, `missing-${randomUUID()}`);
    await expect(store.put(newPath(), bytes("x"), "application/pdf")).rejects.toThrow();
    await expect(store.get(newPath())).rejects.toThrow();
    await expect(store.remove([newPath()])).rejects.toThrow();
  });
});
