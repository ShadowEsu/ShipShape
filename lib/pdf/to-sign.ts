// Runs in Node itself too, in the child process build-isolated.ts starts: hence the `.ts` imports and
// only TypeScript Node can strip (no parameter properties, enums or namespaces).
import { PDFDocument } from "pdf-lib";
import { attachLinkTargets, detachLinkTargets, flattenAnnotations, makeInert, viewerDependent } from "./inert.ts";
import { loadUntrusted } from "./load.ts";

/** Why a file can't be sent for signature; `cause` says what ShipShape couldn't read (for logs and tests, never shown). */
export class NotSignable extends Error {
  readonly reason: "viewer_dependent" | "unreadable";
  constructor(reason: "viewer_dependent" | "unreadable", cause?: unknown) {
    super(reason, { cause });
    this.reason = reason;
  }
}

/**
 * The file a signer reviews, built once when the signature is requested (Security R2-1): the
 * upload's pages with form fields and other annotations drawn in as they show on screen (so paper
 * matches the screen, R3-1), internal links pointing at the copied pages, and nothing
 * that can run. An image becomes a page. At signing, the certificate is appended to exactly these
 * bytes (appendPages), so the signed copy starts with the file the signer saw.
 *
 * Saved with a classic cross-reference table, which an appended revision can point back to.
 */
export async function buildToSign(original: Uint8Array, mime: "application/pdf" | "image/png" | "image/jpeg"): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });
  if (mime === "application/pdf") {
    let source: PDFDocument;
    try {
      source = await loadUntrusted(original);
    } catch (e) {
      throw new NotSignable("unreadable", e); // e.g. password-protected, or too much to unpack (R6-3)
    }
    if (viewerDependent(source, original)) throw new NotSignable("viewer_dependent");
    try {
      flattenAnnotations(source);
      detachLinkTargets(source);
      for (const page of await out.copyPages(source, source.getPageIndices())) out.addPage(page);
    } catch (e) {
      throw new NotSignable("unreadable", e); // a broken page tree, say, or page content ShipShape can't read as viewers do
    }
    attachLinkTargets(out);
  } else {
    try {
      // pdf-lib 1.17 reads a JPEG through `new DataView(bytes.buffer)`, ignoring where the view
      // starts. Bytes that reach the build process over IPC sit at an offset in a larger buffer, so
      // every JPEG was refused as unreadable ("SOI not found"); a copy starts at 0.
      const img = mime === "image/png" ? await out.embedPng(original) : await out.embedJpg(original.slice());
      const scale = Math.min(540 / img.width, 720 / img.height, 1);
      const page = out.addPage([612, 792]);
      page.drawImage(img, { x: (612 - img.width * scale) / 2, y: (792 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    } catch {
      throw new NotSignable("unreadable");
    }
  }
  makeInert(out);
  return out.save({ useObjectStreams: false });
}
