import { decodePDFRawStream, PDFDocument, PDFName, PDFNumber, PDFObjectStreamParser, PDFXRefStreamParser, type PDFContext, type PDFRawStream } from "pdf-lib";

/**
 * Loading a PDF someone uploaded (Security R6-3). While loading, pdf-lib inflates every object
 * stream and cross-reference stream in full, whether or not anything uses it: a 512 KiB upload
 * once took 975 MB of memory. So both are bounded per file, at the only place pdf-lib inflates them
 * (PDFObjectStreamParser.forStream and PDFXRefStreamParser.forStream, which its parser calls):
 * - at most MAX_INFLATED_BYTES of such streams in total, measured by decoding in small steps that
 *   stop just past the allowance, before pdf-lib decodes the stream itself;
 * - at most MAX_PACKED_OBJECTS objects packed in object streams in total (each becomes a JS object).
 * Page content has its own allowance (lib/pdf/inert.ts). The wrap applies to every load in the
 * process, each document with its own allowance (keyed by the document being loaded).
 */

export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;
export const MAX_PACKED_OBJECTS = 200_000;
const STEP = 64 * 1024;

/** The file asks pdf-lib to unpack more than ShipShape allows. */
export class PdfTooComplex extends Error {}

interface Allowance {
  bytes: number;
  objects: number;
  /** Set once the file went past a limit. pdf-lib catches errors per object and carries on without that object, so loadUntrusted checks this afterwards. */
  exceeded: string | null;
}
const allowances = new WeakMap<PDFContext, Allowance>();

function allowanceFor(context: PDFContext): Allowance {
  let left = allowances.get(context);
  if (!left) {
    left = { bytes: MAX_INFLATED_BYTES, objects: MAX_PACKED_OBJECTS, exceeded: null };
    allowances.set(context, left);
  }
  return left;
}

function exceed(left: Allowance, why: string): never {
  left.exceeded = why;
  throw new PdfTooComplex(why);
}

/** Decodes `stream` in steps, charging its size; throws as soon as it passes what's left. */
function charge(stream: PDFRawStream) {
  const left = allowanceFor(stream.dict.context);
  if (left.exceeded) throw new PdfTooComplex(left.exceeded);
  const packed = stream.dict.get(PDFName.of("N"));
  if (packed instanceof PDFNumber) {
    left.objects -= Math.max(0, packed.asNumber());
    if (left.objects < 0) exceed(left, "too many objects packed in object streams");
  }
  const decoding = decodePDFRawStream(stream);
  for (;;) {
    const step = decoding.getBytes(STEP);
    left.bytes -= step.length;
    if (left.bytes < 0) exceed(left, "object or cross-reference streams inflate past the limit");
    if (step.length < STEP) return;
  }
}

// Named, so a second evaluation of this module (a dev reload) doesn't wrap the wrappers again.
if (PDFObjectStreamParser.forStream.name !== "boundedObjectStream") {
  const objectStream = PDFObjectStreamParser.forStream;
  PDFObjectStreamParser.forStream = function boundedObjectStream(stream, shouldWaitForTick) {
    charge(stream);
    return objectStream(stream, shouldWaitForTick);
  };
}
if (PDFXRefStreamParser.forStream.name !== "boundedXRefStream") {
  const xrefStream = PDFXRefStreamParser.forStream;
  PDFXRefStreamParser.forStream = function boundedXRefStream(stream) {
    charge(stream);
    return xrefStream(stream);
  };
}

/** PDFDocument.load for uploads: throws PdfTooComplex past the limits above. */
export async function loadUntrusted(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const exceeded = allowances.get(doc.context)?.exceeded;
  if (exceeded) throw new PdfTooComplex(exceeded);
  return doc;
}
