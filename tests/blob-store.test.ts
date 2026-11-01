import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CreateBucketCommand, GetObjectCommand, PutBucketVersioningCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { productionAwsClient } from "@/lib/server/aws";
import { type BlobStore, localBlobStore, MAX_URL_SECONDS, ObjectExists, ObjectMissing, s3BlobStore, storeFromEnv, verifyFileParams } from "@/lib/server/storage";

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

  it("never overwrites: a second write to a path fails as ObjectExists and the first file stays", async () => {
    const p = newPath();
    await store().put(p, bytes("first"), "application/pdf");
    await expect(store().put(p, bytes("second"), "application/pdf")).rejects.toThrow(ObjectExists);
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

  it("removes everything under one workspace's prefix and nothing under another's; a prefix with nothing under it removes nothing (W11-7)", async () => {
    const [doomed, kept] = [randomUUID(), randomUUID()];
    const under = (org: string) => `${org}/${randomUUID()}/v1.pdf`;
    const [a, b, c] = [under(doomed), under(doomed), under(kept)];
    for (const p of [a, b, c]) await store().put(p, bytes(p), "application/pdf");
    expect(await store().removePrefix(`${doomed}/`)).toBe(2);
    await expect(store().get(a)).rejects.toThrow();
    await expect(store().get(b)).rejects.toThrow();
    expect(text(await store().get(c))).toBe(c);
    expect(await store().removePrefix(`${doomed}/`)).toBe(0);
    expect(await store().removePrefix(`${randomUUID()}/`)).toBe(0);
  });

  it("refuses, before anything is listed, a prefix that isn't exactly a workspace id and a slash", async () => {
    const id = randomUUID();
    const kept = `${id}/${randomUUID()}/v1.pdf`;
    await store().put(kept, bytes("kept"), "application/pdf");
    for (const bad of ["", "/", id, `${id}/x/`, "../", `${id.slice(0, 8)}/`]) {
      await expect(store().removePrefix(bad), bad).rejects.toThrow("Invalid workspace prefix");
    }
    expect(text(await store().get(kept))).toBe("kept");
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

  it("links a file under any name, made safe for the download header, so the link always opens", async () => {
    const p = newPath();
    const nameOf = async (filename: string) => verifyFileParams(new URL(await store().signedUrl(p, { filename, inline: false }), "http://x").searchParams)?.filename;
    expect(await nameOf("Müller & O'Brien, COI 2026+.pdf")).toBe("Muller OBrien COI 2026.pdf");
    expect(await nameOf("日本語の書類.pdf")).toBe("file.pdf");
    const long = await nameOf(`${"Certificate ".repeat(20)}.pdf`);
    expect(long?.length).toBeLessThanOrEqual(120);
    expect(long?.endsWith(".pdf")).toBe(true);
    expect(await nameOf('a"\r\nSet-Cookie: x=1.pdf')).toBe("aSet-Cookie x1.pdf");
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
    expect(() => storeFromEnv({ ...production, SHIPSHAPE_S3_ENDPOINT: "http://127.0.0.1:5917" })).toThrow("refuses SHIPSHAPE_S3_ENDPOINT");
    expect(() => storeFromEnv({ ...production, AWS_ENDPOINT_URL: "https://elsewhere.example" })).toThrow("refuses AWS_ENDPOINT_URL");
    expect(() => storeFromEnv({ ...production, AWS_ENDPOINT_URL_S3: "https://elsewhere.example" })).toThrow("refuses AWS_ENDPOINT_URL_S3");
    expect(() => storeFromEnv({ ...production, AWS_REGION: undefined })).toThrow("needs AWS_REGION");
    // The complete set is accepted (no AWS call happens until a file is stored or read).
    expect(() => storeFromEnv(production)).not.toThrow();
  });

  it("in production, an endpoint_url in the SDK's config file is ignored too: requests go to AWS (CG-1)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aws-config-"));
    const config = path.join(dir, "config");
    await writeFile(config, "[default]\nendpoint_url = http://127.0.0.1:9\n");
    vi.stubEnv("AWS_CONFIG_FILE", config);
    vi.stubEnv("AWS_PROFILE", "default");
    try {
      // Production's settings, with test keys instead of the OIDC token (there is none here).
      const client = new S3Client({ region: "us-east-1", ...productionAwsClient(production, "test"), credentials: { accessKeyId: "test", secretAccessKey: "test" } });
      let host: string | undefined;
      // Reads where the request would go once its endpoint is resolved, and answers it here.
      client.middlewareStack.add(
        (_next, context) => async () => {
          host = context.endpointV2?.url.hostname;
          return { output: { $metadata: {} }, response: {} };
        },
        { step: "build" },
      );
      await client.send(new GetObjectCommand({ Bucket: "shipshape-files", Key: "k" }));
      expect(host).toBe("shipshape-files.s3.us-east-1.amazonaws.com");
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true });
    }
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

  it("never lists the bucket for a prefix that isn't a workspace id and a slash (W11-7)", async () => {
    const client = offlineClient();
    let sent = 0;
    client.middlewareStack.add(
      () => async () => {
        sent++;
        return { output: { $metadata: {} }, response: {} };
      },
      { step: "initialize" },
    );
    for (const bad of ["", randomUUID(), "a/"]) await expect(s3BlobStore(client, "documents").removePrefix(bad)).rejects.toThrow("Invalid workspace prefix");
    expect(sent).toBe(0);
  });

  it("sweeps a prefix listed over several pages, deleting each page, and only keys under it", async () => {
    const client = offlineClient();
    const org = randomUUID();
    const keys = Array.from({ length: 1500 }, () => `${org}/${randomUUID()}/v1.pdf`);
    const pages = [keys.slice(0, 1000), [...keys.slice(1000), `${randomUUID()}/stray/v1.pdf`]];
    const listed: { prefix?: string; token?: string }[] = [];
    const deleted: string[][] = [];
    client.middlewareStack.add(
      () => async (args) => {
        if ("Delete" in args.input) {
          deleted.push((args.input.Delete?.Objects ?? []).map((o) => o.Key ?? ""));
          return { output: { $metadata: {} }, response: {} };
        }
        const input = "ContinuationToken" in args.input && "Prefix" in args.input ? args.input : {};
        listed.push({ prefix: input.Prefix, token: input.ContinuationToken });
        const page = input.ContinuationToken ? pages[1] : pages[0];
        return { output: { Contents: page.map((Key) => ({ Key })), IsTruncated: !input.ContinuationToken, NextContinuationToken: "next", $metadata: {} }, response: {} };
      },
      { step: "initialize" },
    );
    expect(await s3BlobStore(client, "documents").removePrefix(`${org}/`)).toBe(1500);
    expect(listed).toEqual([{ prefix: `${org}/`, token: undefined }, { prefix: `${org}/`, token: "next" }]);
    expect(deleted.flat()).toEqual(keys);
  });

  it("after a 403 on a file, says it's missing only when listing that exact key finds nothing; otherwise keeps the 403 (W12-1)", async () => {
    // Without s3:ListBucket for the key, S3 answers a missing object with 403 AccessDenied, not 404.
    const denied = () => new S3ServiceException({ name: "AccessDenied", $fault: "client", $metadata: { httpStatusCode: 403 }, message: "Access Denied" });
    const storeListing = (list: () => Promise<{ Contents?: { Key: string }[] }>) => {
      const client = offlineClient();
      const listed: string[] = [];
      client.middlewareStack.add(
        () => async (args) => {
          if (!("MaxKeys" in args.input && "Prefix" in args.input)) throw denied();
          listed.push(String(args.input.Prefix));
          return { output: { ...(await list()), $metadata: {} }, response: {} };
        },
        { step: "initialize" },
      );
      return { store: s3BlobStore(client, "documents"), listed };
    };
    const p = newPath();
    // Nothing under the key, or only a longer key it is a prefix of: missing.
    for (const keys of [[], [`${p}.bak`]]) {
      const { store, listed } = storeListing(async () => ({ Contents: keys.map((Key) => ({ Key })) }));
      await expect(store.get(p)).rejects.toBeInstanceOf(ObjectMissing);
      expect(listed).toEqual([p]);
    }
    // The key is there (a real permission or key fault), or the list fails too: the original 403.
    const there = storeListing(async () => ({ Contents: [{ Key: p }] }));
    await expect(there.store.get(p)).rejects.toMatchObject({ name: "AccessDenied", message: "Access Denied" });
    const failing = storeListing(async () => {
      throw new Error("list refused");
    });
    await expect(failing.store.get(p)).rejects.toMatchObject({ name: "AccessDenied", message: "Access Denied" });
    // A key whose first part isn't a workspace id is never listed.
    const odd = storeListing(async () => ({ Contents: [] }));
    await expect(odd.store.get(`${"-".repeat(36)}/${randomUUID()}/v1.pdf`)).rejects.toMatchObject({ name: "AccessDenied" });
    expect(odd.listed).toEqual([]);
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
