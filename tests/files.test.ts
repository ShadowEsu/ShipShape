import { describe, expect, it } from "vitest";
import { checkUpload } from "@/lib/server/files";

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
    expect(checkUpload(pdfOfSize(FOUR_MB + 1))).toEqual({ ok: false, error: "Files can be up to 4 MB." });
  });
});
