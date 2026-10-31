import { PDFDocument } from "pdf-lib";
import { attachLinkTargets, detachLinkTargets, flattenWidgets, makeInert, viewerDependent } from "./inert";

/** Why a file can't be sent for signature. */
export class NotSignable extends Error {
  constructor(readonly reason: "viewer_dependent" | "unreadable") {
    super(reason);
  }
}

/**
 * The file a signer reviews, built once when the signature is requested (Security R2-1): the
 * upload's pages with form fields drawn in, internal links pointing at the copied pages, and nothing
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
      source = await PDFDocument.load(original, { updateMetadata: false });
    } catch {
      throw new NotSignable("unreadable"); // e.g. password-protected
    }
    if (viewerDependent(source, original)) throw new NotSignable("viewer_dependent");
    try {
      flattenWidgets(source);
      detachLinkTargets(source);
      for (const page of await out.copyPages(source, source.getPageIndices())) out.addPage(page);
    } catch {
      throw new NotSignable("unreadable"); // a broken page tree, say
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
