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
    // pdf-lib decodes a whole PNG outside V8's heap, which the build's heap limit doesn't cap, and a
    // small, flat PNG can declare 100 megapixels (W11-3), so what decoding it takes is checked
    // first. A JPEG is copied into the PDF as it is, never decoded here.
    if (mime === "image/png") checkPng(original);
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

/**
 * The most memory decoding one PNG sent for signature may take (MAX_BUILDS at once). UPNG inflates
 * the image as stored (a filter byte a row; an interlaced one is copied once more), turns it into
 * 4 bytes a pixel, and pdf-lib copies that and splits it into 3 + 1: 12 bytes a pixel on top of the
 * stored size (Security INFO-D1). 512 MiB lets in an 8-bit RGB letter page at 600 dpi (5100 × 6600,
 * 505 MB) and refuses the same page with alpha or 16 bits a channel.
 */
export const MAX_PNG_DECODE_BYTES = 512 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels for each PNG color type, and the bit depths the format allows it (PNG spec, table 11.1). */
const PNG_COLOR_TYPES = new Map([
  [0, { channels: 1, depths: [1, 2, 4, 8, 16] }],
  [2, { channels: 3, depths: [8, 16] }],
  [3, { channels: 1, depths: [1, 2, 4, 8] }],
  [4, { channels: 2, depths: [8, 16] }],
  [6, { channels: 4, depths: [8, 16] }],
]);

/**
 * Refuses a PNG whose decoding would take over MAX_PNG_DECODE_BYTES, without decoding it (W11-3).
 * UPNG takes the last IHDR before IEND wherever it sits, and for an animated PNG allocates every
 * frame at its fcTL size before pdf-lib refuses animation (Security MUST-P1), so the chunks are
 * walked to IEND: the first is the only IHDR, 13 bytes long; there are no animation chunks (acTL,
 * fcTL, fdAT); every chunk ends inside the file. Exported for its tests, which needn't decode.
 */
export function checkPng(bytes: Uint8Array): void {
  const refuse = (why: string) => new NotSignable("unreadable", new Error(why));
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw refuse("no PNG signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let decodeBytes = 0;
  for (let at = 8; ; ) {
    // Length, type and CRC are 12 bytes around the chunk's data.
    if (at + 12 > bytes.length) throw refuse("the PNG ends before IEND");
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (at + 12 + length > bytes.length) throw refuse(`the ${type} chunk runs past the end`);
    if ((at === 8) !== (type === "IHDR")) throw refuse(at === 8 ? "no IHDR first" : "a second IHDR");
    if (type === "IHDR") {
      if (length !== 13) throw refuse("an IHDR that isn't 13 bytes");
      const [width, height, depth, color, interlaced] = [view.getUint32(at + 8), view.getUint32(at + 12), bytes[at + 16], bytes[at + 17], bytes[at + 20] === 1];
      const kind = PNG_COLOR_TYPES.get(color);
      if (!kind || !kind.depths.includes(depth)) throw refuse(`color type ${color} at ${depth} bits`);
      const stored = (Math.ceil((width * kind.channels * depth) / 8) + 1) * height;
      decodeBytes = stored * (interlaced ? 2 : 1) + 12 * width * height;
    }
    if (type === "acTL" || type === "fcTL" || type === "fdAT") throw refuse("an animated PNG");
    if (type === "IEND") break;
    at += 12 + length;
  }
  if (decodeBytes > MAX_PNG_DECODE_BYTES) throw refuse(`${Math.ceil(decodeBytes / 1e6)} MB to decode is over the limit`);
}
