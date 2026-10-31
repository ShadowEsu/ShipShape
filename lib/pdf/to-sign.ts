import { PDFDocument } from "pdf-lib";
import { attachLinkTargets, detachLinkTargets, flattenAnnotations, makeInert, viewerDependent } from "./inert";
import { loadUntrusted } from "./load";

/** Why a file can't be sent for signature; `cause` says what ShipShape couldn't read (for logs and tests, never shown). */
export class NotSignable extends Error {
  constructor(
    readonly reason: "viewer_dependent" | "unreadable",
    cause?: unknown,
  ) {
    super(reason, { cause });
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
      const img = mime === "image/png" ? await out.embedPng(original) : await out.embedJpg(original);
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
