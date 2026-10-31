import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFNumber, PDFObjectStreamParser, PDFXRefStreamParser, type PDFContext, type PDFDict, type PDFRawStream } from "pdf-lib";

/**
 * Loading a PDF someone uploaded (Security R6-3, R7-1). While loading, pdf-lib unpacks every object
 * stream and cross-reference stream, used or not, and what it builds from them can be far larger
 * than the bytes: an 8 KiB upload once ran a 2 GB process out of memory. So both are checked first,
 * at the only place pdf-lib unpacks them (PDFObjectStreamParser.forStream and
 * PDFXRefStreamParser.forStream, which its parser calls), against a per-file allowance:
 * - at most MAX_INFLATED_BYTES of such streams in total, decoded in small steps that stop just past
 *   it (real files have well under 0.1 MiB; parsing costs about 45 times the bytes);
 * - at most MAX_PACKED_OBJECTS objects from them in total (object stream entries and
 *   cross-reference entries), counted from /N, /Size and /Index as pdf-lib reads them (lookup);
 * - an object stream's header must be exactly /N pairs with strictly increasing offsets, and each
 *   object must end before the next one starts, so pdf-lib parses each byte once (not one object
 *   once per entry pointing at it);
 * - a cross-reference stream's entries must fit in its data (pdf-lib builds /Size entries whatever
 *   the data holds).
 * Page content has its own allowance (lib/pdf/inert.ts). The wrap applies to every load in the
 * process, each document with its own allowance (keyed by the document being loaded).
 */

export const MAX_INFLATED_BYTES = 4 * 1024 * 1024;
export const MAX_PACKED_OBJECTS = 200_000;
const STEP = 64 * 1024;

/** The file asks pdf-lib to unpack more than ShipShape allows, or in a way it can't check. */
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
function decodeWithin(stream: PDFRawStream, left: Allowance): Uint8Array {
  const decoding = decodePDFRawStream(stream);
  const steps: (Uint8Array | Uint8ClampedArray)[] = [];
  let size = 0;
  for (;;) {
    const step = decoding.getBytes(STEP);
    left.bytes -= step.length;
    if (left.bytes < 0) exceed(left, "object or cross-reference streams inflate past the limit");
    steps.push(step);
    size += step.length;
    if (step.length < STEP) break;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const step of steps) {
    bytes.set(step, at);
    at += step.length;
  }
  return bytes;
}

/** A non-negative integer at `key`, resolved the way pdf-lib resolves it; null otherwise. */
function countAt(dict: PDFDict, key: string): number | null {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber && Number.isSafeInteger(value.asNumber()) && value.asNumber() >= 0 ? value.asNumber() : null;
}

function chargeObjects(left: Allowance, count: number) {
  left.objects -= count;
  if (left.objects < 0) exceed(left, "too many objects in object and cross-reference streams");
}

function checkObjectStream(stream: PDFRawStream) {
  const left = allowanceFor(stream.dict.context);
  if (left.exceeded) throw new PdfTooComplex(left.exceeded);
  const count = countAt(stream.dict, "N");
  const first = countAt(stream.dict, "First");
  if (count === null || first === null) exceed(left, "object stream without a usable /N and /First");
  chargeObjects(left, count);
  const bytes = decodeWithin(stream, left);
  // The header: `count` pairs of object number and offset, read as pdf-lib reads them.
  const offsets: number[] = [];
  let at = 0;
  for (let i = 0; i < count * 2; i++) {
    at = skipBlank(bytes, at);
    const start = at;
    let value = 0;
    while (at < bytes.length && bytes[at] >= 48 && bytes[at] <= 57) value = value * 10 + bytes[at++] - 48;
    if (at === start) exceed(left, "object stream header isn't a list of numbers");
    if (i % 2 === 1) offsets.push(value);
  }
  if (at > first || first > bytes.length) exceed(left, "object stream header runs past /First");
  // Each object must end before the next one starts (so offsets increase and stay inside the data):
  // then pdf-lib parses each byte once, not one object again for every entry that points into it.
  for (let i = 0; i < offsets.length; i++) {
    const end = i + 1 < offsets.length ? first + offsets[i + 1] : bytes.length;
    if (objectEnd(bytes, first + offsets[i], end) < 0) exceed(left, "object stream objects overlap or are out of order");
  }
}

function checkXRefStream(stream: PDFRawStream) {
  const left = allowanceFor(stream.dict.context);
  if (left.exceeded) throw new PdfTooComplex(left.exceeded);
  // Three field widths in bytes, each 0 to 8, at least one byte per entry.
  const widths = stream.dict.lookup(PDFName.of("W"));
  const w: number[] = [];
  if (widths instanceof PDFArray && widths.size() === 3) {
    for (let i = 0; i < 3; i++) {
      const width = widths.lookup(i);
      if (width instanceof PDFNumber && Number.isInteger(width.asNumber()) && width.asNumber() >= 0 && width.asNumber() <= 8) w.push(width.asNumber());
    }
  }
  const row = w.reduce((sum, n) => sum + n, 0);
  if (w.length !== 3 || row === 0) exceed(left, "cross-reference stream without usable /W widths");
  let entries = 0;
  const index = stream.dict.lookup(PDFName.of("Index"));
  if (index instanceof PDFArray) {
    if (index.size() % 2 !== 0) exceed(left, "cross-reference stream with an odd /Index");
    for (let i = 1; i < index.size(); i += 2) {
      const length = index.lookup(i);
      if (!(length instanceof PDFNumber) || !Number.isSafeInteger(length.asNumber()) || length.asNumber() < 0) exceed(left, "cross-reference stream with an unusable /Index");
      entries += length.asNumber();
    }
  } else {
    const size = countAt(stream.dict, "Size");
    if (size === null) exceed(left, "cross-reference stream without a usable /Size");
    entries = size;
  }
  chargeObjects(left, entries);
  if (entries * row > decodeWithin(stream, left).length) exceed(left, "cross-reference stream lists more entries than its data holds");
}

const isWhite = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelimiter = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;

/** Skips white space and comments. */
function skipBlank(b: Uint8Array, at: number): number {
  while (at < b.length) {
    if (isWhite(b[at])) at++;
    else if (b[at] === 37) while (at < b.length && b[at] !== 10 && b[at] !== 13) at++;
    else break;
  }
  return at;
}

/**
 * Where the object starting at `at` ends, if it ends before `limit`; -1 otherwise. One value: a
 * token, a string, or a balanced [ ] or << >> (an indirect reference's 0 R counts as what follows).
 */
function objectEnd(b: Uint8Array, at: number, limit: number): number {
  let depth = 0;
  for (;;) {
    at = skipBlank(b, at);
    if (at >= limit) return -1;
    const c = b[at];
    if (c === 91 || (c === 60 && b[at + 1] === 60)) {
      depth++;
      at += c === 91 ? 1 : 2;
    } else if (c === 93 || (c === 62 && b[at + 1] === 62)) {
      depth--;
      at += c === 93 ? 1 : 2;
      if (depth < 0) return -1;
    } else if (c === 40) {
      let parens = 1;
      at++;
      while (at < limit && parens > 0) {
        if (b[at] === 92) at++;
        else if (b[at] === 40) parens++;
        else if (b[at] === 41) parens--;
        at++;
      }
      if (parens > 0) return -1;
    } else if (c === 60) {
      while (at < limit && b[at] !== 62) at++;
      if (at >= limit) return -1;
      at++;
    } else {
      at++; // a name's slash, a stray delimiter, or the first byte of a token
      while (at < limit && !isWhite(b[at]) && !isDelimiter(b[at])) at++;
    }
    if (depth === 0) return at <= limit ? at : -1;
  }
}

// Named, so a second evaluation of this module (a dev reload) doesn't wrap the wrappers again.
if (PDFObjectStreamParser.forStream.name !== "boundedObjectStream") {
  const objectStream = PDFObjectStreamParser.forStream;
  PDFObjectStreamParser.forStream = function boundedObjectStream(stream, shouldWaitForTick) {
    checkObjectStream(stream);
    return objectStream(stream, shouldWaitForTick);
  };
}
if (PDFXRefStreamParser.forStream.name !== "boundedXRefStream") {
  const xrefStream = PDFXRefStreamParser.forStream;
  PDFXRefStreamParser.forStream = function boundedXRefStream(stream) {
    checkXRefStream(stream);
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
