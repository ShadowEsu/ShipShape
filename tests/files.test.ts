import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as serveFile } from "@/app/api/files/route";
import { checkUpload } from "@/lib/server/files";
import { fileUrl, localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";

/** Uploads stay under Vercel's 4.5 MB request cap, so a refused file gets our message, not Vercel's 413 page. */

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const FOUR_MB = 4 * 1024 * 1024;

const pdfOfSize = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(PDF);
  return bytes;
};

describe("the upload size limit", () => {
  it("takes a PDF of exactly 4 MB and refuses one byte more", () => {
    expect(checkUpload(pdfOfSize(FOUR_MB))).toEqual({ ok: true, mime: "application/pdf" });
    expect(checkUpload(pdfOfSize(FOUR_MB + 1))).toEqual({ ok: false, error: "That file is over 4 MB. Choose a smaller file, or save it as a smaller PDF." });
  });
});

describe("the file route (/api/files)", () => {
  let blobDir = "";
  const store = () => localBlobStore(blobDir);
  const objectPath = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/v1.pdf";
  const get = (url: string) => serveFile(new Request(`http://127.0.0.1${url}`));

  beforeAll(async () => {
    blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-files-"));
    setBlobStoreForTests(store());
  });
  afterAll(() => rm(blobDir, { recursive: true, force: true }));

  it("serves a signed link as an attachment with the header-safe name, and refuses a link whose signature doesn't match", async () => {
    await store().put(objectPath, PDF, "application/pdf");
    const url = await fileUrl(objectPath, { filename: "Certificate.pdf", inline: false });
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Certificate.pdf"');
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    const forged = await get(url.replace("i=0", "i=1"));
    expect(forged.status).toBe(403);
    expect(await forged.text()).toBe("This link has expired or isn't valid.");
    expect(forged.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a signed link to a file removed since answers 404 with the invalid-link text, not a crash (W11-12)", async () => {
    const url = await fileUrl(objectPath, { filename: "Certificate.pdf", inline: false });
    await store().remove([objectPath]);
    const res = await get(url);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("This link has expired or isn't valid.");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
