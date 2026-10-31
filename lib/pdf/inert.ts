import {
  concatTransformationMatrix,
  decodePDFRawStream,
  drawObject,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";

/**
 * Makes a PDF that ShipShape builds from someone's upload (a signed copy) unable to run anything
 * (Security F3, F3-1..F3-3). It works on the finished document as a whole rather than along known
 * paths, because scripts can hang off almost any object: a field's parent, a popup, presentation
 * steps, a form XObject.
 *
 * 1. Pages (and any stray copy of one) keep only Link annotations, with no appearance of their own
 *    (F3-2, R3-1). Everything else should be drawn into the page before copying (flattenAnnotations).
 * 2. Every object loses its script and trigger keys, and any /A that isn't a jump within the
 *    document or a web/mail link (F3-1, F3-3). Unsafe action objects are emptied wherever they sit.
 * 3. Objects nothing points to any more (a dropped attachment's file, say) are deleted, so they
 *    aren't even written into the file.
 */
export function makeInert(doc: PDFDocument): void {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) sweep(obj);
  dropUnreachable(doc);
}

/**
 * Draws each annotation's on-screen appearance into its page and removes the annotation; only
 * links stay, without an appearance (Security R2-3, R3-1). Viewers show and print annotations by
 * their own flags (Hidden, NoView, Print) and states, so a kept annotation could print what the
 * screen didn't show, or hide on paper what covered the page on screen. Drawn as page content,
 * screen and paper show the same thing. What's drawn is what a viewer shows: the normal appearance
 * (the current /AS state for check boxes and the like), never a hidden or NoView one, whether or
 * not it prints. Only display types and form fields are drawn; anything else (a popup, media, an
 * attachment) is left out, as are annotations with nothing to draw. The form goes too, so its own
 * logic never runs.
 */
export function flattenAnnotations(doc: PDFDocument): void {
  const read = contentReader();
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(ANNOTS);
    if (!(annots instanceof PDFArray)) continue;
    const links: PDFObject[] = [];
    const drawn: PDFDict[] = [];
    for (const entry of annots.asArray()) {
      const annot = doc.context.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = nameAt(annot, SUBTYPE);
      if (subtype === LINK) {
        plainLink(annot);
        links.push(entry);
      } else if (subtype !== null && DRAWN.has(subtype)) drawn.push(annot);
    }
    if (drawn.length) {
      isolateContent(page, read);
      for (const annot of drawn) drawAppearance(page, annot);
    }
    if (links.length) page.node.set(ANNOTS, doc.context.obj(links));
    else page.node.delete(ANNOTS);
  }
  doc.catalog.delete(ACROFORM);
}

/**
 * True when viewers can disagree about what the file shows (Security R2-1, R3-1): a layer hidden by
 * default or switched between screen and print, a form that asks the viewer to redraw its fields,
 * or an object defined twice in a file with a single revision. The signer reviews ShipShape's own
 * copy either way; these are refused so nobody is shown one thing in their viewer and another in
 * ShipShape's.
 */
export function viewerDependent(doc: PDFDocument, raw: Uint8Array): boolean {
  const oc = doc.catalog.lookup(OCPROPERTIES);
  const config = oc instanceof PDFDict ? oc.lookup(D) : undefined;
  if (config instanceof PDFDict) {
    const off = config.lookup(OFF);
    if ((off instanceof PDFArray && off.size() > 0) || nameAt(config, BASE_STATE) === OFF) return true;
    if (config.has(AS)) return true; // auto states: layers that turn on or off for printing or viewing
  }
  // Membership rules (/OCMD) decide visibility by expression; refused rather than evaluated (R4-4).
  if (hasOcmd(doc)) return true;
  const form = doc.catalog.lookup(ACROFORM);
  const redraw = form instanceof PDFDict ? form.lookup(NEED_APPEARANCES) : undefined;
  if (redraw instanceof PDFBool && redraw.asBoolean()) return true;
  const text = new TextDecoder("latin1").decode(raw);
  const revisions = text.match(/startxref/g)?.length ?? 0;
  if (revisions > 1) return false; // later revisions legitimately redefine objects
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g)) {
    const key = `${m[1]} ${m[2]}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * Before copyPages (Security R2-2): a link's target page becomes its page number. Copying would
 * otherwise drag each target along as a stray duplicate page outside the page tree, leaving every
 * internal link dead. Targets that aren't pages of this document (named destinations, other files)
 * are dropped. attachLinkTargets turns the numbers back into the copied pages.
 */
export function detachLinkTargets(doc: PDFDocument): void {
  const pages = doc.getPages();
  const index = new Map(pages.map((p, i) => [p.ref.tag, i]));
  const toNumber = (target: PDFObject | undefined) => (target instanceof PDFRef ? index.get(target.tag) : undefined);
  for (const page of pages) eachLink(page.node, (holder, key) => retarget(holder, key, toNumber));
}

/** After copyPages: page numbers left by detachLinkTargets point at the copied pages again. */
export function attachLinkTargets(doc: PDFDocument): void {
  const pages = doc.getPages();
  const toRef = (target: PDFObject | undefined) => (target instanceof PDFNumber ? pages[target.asNumber()]?.ref : undefined);
  for (const page of pages) eachLink(page.node, (holder, key) => retarget(holder, key, toRef));
}

/** Annotation types that only show something; their appearance is drawn into the page (R3-1). */
const DRAWN = new Set(
  ["Widget", "Text", "FreeText", "Line", "Square", "Circle", "Polygon", "PolyLine", "Highlight", "Underline", "Squiggly", "StrikeOut", "Stamp", "Caret", "Ink"].map(
    (s) => PDFName.of(s),
  ),
);

// Keys that trigger or carry scripts, other documents, media, attachments or links to other
// annotations; none matters for how a page looks.
const DROP_KEYS = [
  "JS", "AA", "OpenAction", "Next", "PresSteps", "Popup", "IRT", "EF", "RichMediaContent", "RichMediaSettings", "3DD",
  // Not run by viewers once nothing references them, but still payloads (Security R2-4).
  "XFA", "RF", "AF", "PA",
].map((k) => PDFName.of(k));
// Action types other than a jump or a link. /S also names structure roles, transitions and border
// styles, so only these exact action names mark a dictionary as an action to empty.
const UNSAFE_ACTIONS = new Set(
  ["JavaScript", "Launch", "SubmitForm", "ImportData", "RichMediaExecute", "Named", "GoToR", "GoToE", "Hide", "Rendition", "ResetForm", "SetOCGState", "Thread", "Sound", "Movie", "Trans", "GoTo3DView"].map((s) =>
    PDFName.of(s),
  ),
);
const A = PDFName.of("A");
const S = PDFName.of("S");
const URI = PDFName.of("URI");
const GOTO = PDFName.of("GoTo");
const TYPE = PDFName.of("Type");
const ACTION = PDFName.of("Action");
const ANNOTS = PDFName.of("Annots");
const SUBTYPE = PDFName.of("Subtype");
// A mail link with a query can carry ?attach= for some mail programs (Security R2-7).
const SAFE_URI = /^(https?:|mailto:[^?]*$)/i;
const AP = PDFName.of("AP");
const AS = PDFName.of("AS");
const BASE_STATE = PDFName.of("BaseState");
const BBOX = PDFName.of("BBox");
const D = PDFName.of("D");
const DEST = PDFName.of("Dest");
const F = PDFName.of("F");
const FORM = PDFName.of("Form");
const MATRIX = PDFName.of("Matrix");
const NORMAL = PDFName.of("N");
const NEED_APPEARANCES = PDFName.of("NeedAppearances");
const OCPROPERTIES = PDFName.of("OCProperties");
const OFF = PDFName.of("OFF");
const P = PDFName.of("P");
const RECT = PDFName.of("Rect");
const LINK = PDFName.of("Link");
const CONTENTS = PDFName.of("Contents");
const DECODE_PARMS = PDFName.of("DecodeParms");
const EXTGSTATE = PDFName.of("ExtGState");
const OCMD = PDFName.of("OCMD");
const BORDER = PDFName.of("Border");
// What makes a link draw something itself: appearance, border style and colour, click highlight.
const LINK_LOOK = ["AP", "AS", "BS", "C", "H", "BE", "IC"].map((k) => PDFName.of(k));
// Graphics-state keys whose effect depends on the output device and renderer (Security R4-2):
// transfer functions, black generation, undercolour removal, halftones.
const DEVICE_KEYS = ["TR", "TR2", "BG", "BG2", "UCR", "UCR2", "HT"].map((k) => PDFName.of(k));
const XOBJECT = PDFName.of("XObject");
const ACROFORM = PDFName.of("AcroForm");
// Annotation flags: Hidden (2) and NoView (32).
const NOT_SHOWN = 2 | 32;

/** The n numbers of an array such as /Rect or /Matrix, or null if it isn't exactly that. */
function numbersAt(dict: PDFDict, key: PDFName, n: number): number[] | null {
  const arr = dict.lookup(key);
  if (!(arr instanceof PDFArray) || arr.size() !== n) return null;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = arr.lookup(i);
    if (!(v instanceof PDFNumber) || !Number.isFinite(v.asNumber())) return null;
    out.push(v.asNumber());
  }
  return out;
}

/** The annotation's normal appearance stream (for check boxes and radio buttons, its current state's). */
function normalAppearance(annot: PDFDict): { ref: PDFRef; stream: PDFStream } | null {
  const ap = annot.lookup(AP);
  if (!(ap instanceof PDFDict)) return null;
  let entry = ap.get(NORMAL);
  let target = annot.context.lookup(entry);
  if (target instanceof PDFDict) {
    const state = nameAt(annot, AS);
    if (state === null) return null;
    entry = target.get(state);
    target = annot.context.lookup(entry);
  }
  return entry instanceof PDFRef && target instanceof PDFStream ? { ref: entry, stream: target } : null;
}

/** Draws one annotation's appearance where it sits (PDF 32000-1 12.5.5: BBox through Matrix onto Rect). */
function drawAppearance(page: PDFPage, annot: PDFDict) {
  const flags = annot.lookup(F);
  if (flags instanceof PDFNumber && (flags.asNumber() & NOT_SHOWN) !== 0) return;
  const appearance = normalAppearance(annot);
  const rect = numbersAt(annot, RECT, 4);
  if (!appearance || !rect) return;
  const [x1, x2] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2])];
  const [y1, y2] = [Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])];
  const bbox = numbersAt(appearance.stream.dict, BBOX, 4) ?? [0, 0, x2 - x1, y2 - y1];
  const [a, b, c, d, e, f] = numbersAt(appearance.stream.dict, MATRIX, 6) ?? [1, 0, 0, 1, 0, 0];
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const bx1 = Math.min(...corners.map((p) => p[0]));
  const bx2 = Math.max(...corners.map((p) => p[0]));
  const by1 = Math.min(...corners.map((p) => p[1]));
  const by2 = Math.max(...corners.map((p) => p[1]));
  if (bx2 - bx1 <= 0 || by2 - by1 <= 0 || x2 - x1 <= 0 || y2 - y1 <= 0) return;
  const sx = (x2 - x1) / (bx2 - bx1);
  const sy = (y2 - y1) / (by2 - by1);
  appearance.stream.dict.set(TYPE, XOBJECT);
  appearance.stream.dict.set(SUBTYPE, FORM);
  const name = page.node.newXObject("Flat", appearance.ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, x1 - bx1 * sx, y1 - by1 * sy), drawObject(name), popGraphicsState());
}

/** Calls back with each place a page's links name a destination: an annotation's /Dest and a GoTo action's /D. */
function eachLink(page: PDFDict, visit: (holder: PDFDict, key: PDFName) => void) {
  const annots = page.lookup(ANNOTS);
  if (!(annots instanceof PDFArray)) return;
  for (const entry of annots.asArray()) {
    const annot = page.context.lookup(entry);
    if (!(annot instanceof PDFDict)) continue;
    annot.delete(P); // the annotation's own page: copying would duplicate it too
    if (annot.has(DEST)) visit(annot, DEST);
    const action = annot.lookup(A);
    if (action instanceof PDFDict && nameAt(action, S) === GOTO) {
      visit(action, D);
      if (!action.has(D)) annot.delete(A);
    }
  }
}

/** Swaps an explicit destination's page through `map`; drops the destination when there's no match. */
function retarget(holder: PDFDict, key: PDFName, map: (target: PDFObject | undefined) => PDFRef | number | undefined) {
  const dest = holder.lookup(key);
  const page = dest instanceof PDFArray && dest.size() > 0 ? map(dest.get(0)) : undefined;
  if (!(dest instanceof PDFArray) || page === undefined) {
    holder.delete(key);
    return;
  }
  const target = typeof page === "number" ? PDFNumber.of(page) : page;
  holder.set(key, holder.context.obj([target, ...dest.asArray().slice(1)]));
}

/** A name value, or null when the key is missing or holds anything else (hostile files do that). */
function nameAt(dict: PDFDict, key: PDFName): PDFName | null {
  const v = dict.lookup(key);
  return v instanceof PDFName ? v : null;
}

/**
 * A kept link draws nothing of its own (Security R3-1, R4-1): no appearance, no colour, and a border
 * of width 0 whatever its flags say. Viewers otherwise draw link borders on screen and decide
 * differently whether they print, which can cover or uncover text.
 */
function plainLink(annot: PDFDict) {
  for (const key of LINK_LOOK) annot.delete(key);
  annot.set(BORDER, annot.context.obj([0, 0, 0]));
}

/**
 * Moves the page's own content into a form XObject drawn inside q…Q (Security R4-3), so whatever
 * graphics state it leaves open (an unclosed q with a clip or a shift) can't reach the annotations
 * drawn after it. Viewers draw annotations in a fresh state; this keeps that true once they are
 * page content. The streams are joined as viewers read them (R5-1, R6-1; see `joint`). Content
 * ShipShape can't read exactly as viewers do throws, which makes the file unreadable for signing.
 */
function isolateContent(page: PDFPage, read: ContentReader) {
  const ctx = page.node.context;
  const contents = page.node.lookup(CONTENTS);
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : contents === undefined ? [] : [contents];
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (!(s instanceof PDFRawStream)) throw new Error("page content isn't a stream ShipShape can read");
    const part = read.stream(s);
    if (!part.length) continue;
    const before = parts.at(-1);
    const how = before ? joint(before, part, tailOf(parts, WINDOW_REACH)) : "join";
    if (how === "refuse") throw new Error("page content splits a comment, string, inline image or token across streams");
    if (how === "space") parts.push(SPACE);
    parts.push(part);
  }
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  const { x, y, width, height } = page.getMediaBox();
  const resources = page.node.Resources();
  const original = ctx.flateStream(bytes, { Type: "XObject", Subtype: "Form", BBox: [x, y, x + width, y + height], ...(resources ? { Resources: resources } : {}) });
  const name = page.node.newXObject("Page", ctx.register(original));
  page.node.set(CONTENTS, ctx.obj([]));
  page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState());
}

/** The last `n` bytes of everything joined so far: the parts and the spaces between them. */
function tailOf(parts: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let free = n;
  for (let i = parts.length - 1; i >= 0 && free > 0; i--) {
    const take = Math.min(free, parts[i].length);
    out.set(parts[i].subarray(parts[i].length - take), free - take);
    free -= take;
  }
  return out.subarray(free);
}

const SPACE = new Uint8Array([32]);

/**
 * The most page content one file may make ShipShape decode and copy (Security R5-2): a small
 * upload can inflate to far more, or repeat one large stream on every page.
 */
export const MAX_CONTENT_BYTES = 50 * 1024 * 1024;
const STEP = 64 * 1024;

/** Thrown when a file's page content passes MAX_CONTENT_BYTES. */
export class TooMuchContent extends Error {}

interface ContentReader {
  /**
   * A content stream's decoded bytes, decoded once per file. Its size counts against the file's
   * allowance when it's decoded and again each time another page reuses it (that page copies it).
   */
  stream(s: PDFRawStream): Uint8Array;
}

function contentReader(): ContentReader {
  const decoded = new Map<PDFRawStream, Uint8Array>();
  let left = MAX_CONTENT_BYTES;
  const take = (bytes: number) => {
    left -= bytes;
    if (left < 0) throw new TooMuchContent("too much page content to rewrite");
  };
  return {
    stream(s) {
      const known = decoded.get(s);
      if (known) {
        take(known.length);
        return known;
      }
      // pdf-lib ignores predictors and other decode parameters, so such content would come out wrong (R5-1).
      if (s.dict.has(DECODE_PARMS)) throw new Error("page content uses decode parameters");
      // In steps, so decoding stops just past the allowance whatever the filters expand to (R6-4).
      const decoding = decodePDFRawStream(s);
      const steps: (Uint8Array | Uint8ClampedArray)[] = [];
      let size = 0;
      for (;;) {
        const step = decoding.getBytes(STEP);
        take(step.length);
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
      decoded.set(s, bytes);
      return bytes;
    },
  };
}

/**
 * How two of a page's content streams meet. Viewers read them as one, and the format only allows a
 * split between tokens (Security R5-1, R6-1, R6-2, R7-5):
 * - "join" when the split falls at white space or a delimiter: the bytes go together as they are;
 * - "space" when it falls between two complete operators that can't run together (ET|Q, Q|q, as
 *   pdf-lib's own stamping makes): viewers read two operators there, and one space says so;
 * - "refuse" for anything viewers read differently: a split inside a comment, a string or inline
 *   image data, through a name (/|F1) or a << or >>, or through any other token (T|j, 1|2, BM|C).
 *   pdf.js extends an operator one character at a time while that still names one, so g|sh reads
 *   as gs + h there: refused when the left operator plus the right one's first character starts
 *   any operator. pdf.js also ends inline image data only at EI followed by white space, so EI|Q is
 *   refused too.
 */
function joint(before: Uint8Array, after: Uint8Array, joined: Uint8Array): "join" | "space" | "refuse" {
  if (endsInside(before)) return "refuse";
  const last = before[before.length - 1];
  const first = after[0];
  if (last === SLASH && regular(first)) return "refuse";
  if ((last === LESS && first === LESS) || (last === GREATER && first === GREATER)) return "refuse";
  if (!regular(last) || !regular(first)) return "join";
  let start = before.length - 1;
  while (start > 0 && regular(before[start - 1])) start--;
  if (start > 0 && before[start - 1] === SLASH) return "refuse"; // a name, not an operator
  let end = 0;
  while (end < after.length && regular(after[end])) end++;
  const left = latin1(before.subarray(start));
  const right = latin1(after.subarray(0, end));
  if (!OPERATORS.has(left) || !OPERATORS.has(right) || left === "EI") return "refuse";
  const extended = left + right[0];
  for (const op of OPERATORS) if (op.startsWith(extended)) return "refuse";
  // pdf.js ends inline image data only at an "EI" + SP/LF/CR followed by 15 bytes of text; when it
  // rejects the real EI (a tab, % or binary after it) it reads on across the split. A space added here
  // would shift a stray "EI "'s window by a byte and could change where pdf.js ends the image (R11-1).
  // The window can reach back across earlier, shorter streams, so `joined` is the tail of everything
  // joined so far, spaces included, not just `before` (R12-1).
  for (let j = 0; j + 2 < joined.length; j++) {
    if (joined[j] === 69 && joined[j + 1] === 73 && (joined[j + 2] === 32 || joined[j + 2] === 10 || joined[j + 2] === 13)) return "refuse";
  }
  return "space";
}

/** How far back a split can matter: "EI", its white space and the 15 bytes pdf.js checks after it. */
const WINDOW_REACH = 18;

const latin1 = (b: Uint8Array) => String.fromCharCode(...b.subarray(0, 8));

// Every content stream operator (PDF 32000-1, Annex A).
const OPERATORS = new Set(
  "b B b* B* BDC BI BMC BT BX c cm CS cs d d0 d1 Do DP EI EMC ET EX f F f* G g gs h i ID j J K k l m M MP n q Q re RG rg ri s S SC sc SCN scn sh T* Tc Td TD Tf Tj TJ TL Tm Tr Ts Tw Tz v w W W* y ' \"".split(" "),
);

/** True if the content ends inside a comment, a literal or hex string, or inline image data (or can't tell). */
function endsInside(b: Uint8Array): boolean {
  let depth = 0;
  let comment = false;
  let imageAt = -1; // where the last BI operator starts
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (comment) comment = c !== 10 && c !== 13;
    else if (depth > 0) {
      if (c === 92) i++; // backslash: the next byte is escaped
      else if (c === 40) depth++;
      else if (c === 41) depth--;
    } else if (c === 37) comment = true;
    else if (c === 40) depth = 1;
    else if (c === LESS && b[i + 1] === LESS) i++; // << opens a dictionary
    else if (c === LESS) {
      // A hex string: nothing in it is a comment (R7-6), and it ends at the next >. Anything but hex
      // digits and white space in it means it isn't one, so where the content stands is unknown (R8-1).
      const close = b.indexOf(GREATER, i + 1);
      if (close < 0) return true;
      for (let j = i + 1; j < close; j++) if (!WHITE.has(b[j]) && !HEX.test(String.fromCharCode(b[j]))) return true;
      i = close;
    } else if (operatorAt(b, i, "BI")) imageAt = i;
    else if (operatorAt(b, i, "ID")) {
      const end = inlineImageEnd(b, imageAt, i);
      if (end < 0) return true;
      i = end;
    }
  }
  return comment || depth > 0;
}

/** True if the two-letter operator `op` starts at `i` (not part of a longer token or a name). */
function operatorAt(b: Uint8Array, i: number, op: string): boolean {
  return b[i] === op.charCodeAt(0) && b[i + 1] === op.charCodeAt(1) && (i === 0 || (!regular(b[i - 1]) && b[i - 1] !== SLASH)) && (i + 2 >= b.length || !regular(b[i + 2]));
}

/**
 * The index of the I in the EI that ends inline image data whose BI is at `imageAt` and ID at
 * `idAt`, or -1 if the data runs to the end or its length can't be known (Security R8-1). Viewers
 * read the data by its size (poppler) or reject an EI followed by binary (pdf.js), so an " EI "
 * among the pixels doesn't end it: only an unfiltered image of known size is read, white space
 * then EI must follow exactly there, and no EI inside may look like an end to pdf.js (R9-3).
 */
function inlineImageEnd(b: Uint8Array, imageAt: number, idAt: number): number {
  if (imageAt < 0 || idAt - imageAt > 1024 || !WHITE.has(b[idAt + 2])) return -1;
  const size = inlineImageSize(String.fromCharCode(...b.subarray(imageAt + 2, idAt)));
  if (size === null) return -1;
  const start = idAt + 3; // ID, one white-space byte, the data
  if (pdfjsEndsEarly(b, start, start + size)) return -1;
  let at = start + size;
  if (at >= b.length || !WHITE.has(b[at])) return -1;
  while (at < b.length && WHITE.has(b[at])) at++;
  return operatorAt(b, at, "EI") ? at + 1 : -1;
}

/**
 * True if pdf.js would end the unfiltered inline data in b[start, end) early (Security R9-3): it
 * ignores the size and stops at the first EI followed by white space and 15 bytes it counts as text
 * (pdf.js findDefaultInlineStreamEnd), then reads the rest of the pixels as content.
 */
function pdfjsEndsEarly(b: Uint8Array, start: number, end: number): boolean {
  // pdf.js counts a NUL as text unless another NUL follows it inside its window, so at the window's end
  // it's always text; every NUL counts here (R10-2).
  const text = (k: number) => b[k] === 0 || b[k] === 10 || b[k] === 13 || (b[k] >= 32 && b[k] <= 127);
  for (let j = start; j + 1 < end && j + 2 < b.length; j++) {
    if (b[j] !== 69 || b[j + 1] !== 73 || (b[j + 2] !== 32 && b[j + 2] !== 10 && b[j + 2] !== 13)) continue;
    let allText = true;
    for (let k = j + 3; k < Math.min(j + 18, b.length); k++) if (!text(k)) allText = false;
    if (allText) return true;
  }
  return false;
}

/** Bytes of image data an inline image dictionary describes, if it is unfiltered and plainly sized; null otherwise. */
function inlineImageSize(dict: string): number | null {
  // Only printable ASCII and the white space viewers and the tokenizer below agree on: JS \s leaves out NUL
  // (white to viewers: "/F\0" is the key /F, R10-3) and takes VT and 0xA0 (regular to viewers). And no #:
  // viewers decode #xx in names (/#46 is /F), which this reader doesn't (R9-4). No real producer writes either.
  if (!/^[\t\n\f\r\x20-\x7e]*$/.test(dict) || dict.includes("#")) return null;
  const tokens = dict.match(/\/[^\s/[\]<>(){}%]*|[[\]<>(){}%]|[^\s/[\]<>(){}%]+/g) ?? [];
  const entries = new Map<string, string>();
  for (let k = 0; k < tokens.length; k += 2) {
    const key = tokens[k];
    const value = tokens[k + 1];
    if (!key.startsWith("/") || value === undefined || /^[[\]<>(){}%]$/.test(value)) return null; // arrays, strings, dictionaries: not plain
    const name = INLINE_KEYS[key.slice(1)] ?? key.slice(1);
    if (entries.has(name)) return null;
    entries.set(name, value);
  }
  if (entries.has("F") || entries.has("DP")) return null;
  const integer = (name: string) => {
    const v = entries.get(name);
    return v !== undefined && /^\d{1,6}$/.test(v) ? Number(v) : 0;
  };
  const mask = entries.get("IM") === "true";
  const bits = mask ? 1 : integer("BPC");
  const colours = mask ? 1 : COLOUR_COMPONENTS[entries.get("CS") ?? ""];
  const width = integer("W");
  const height = integer("H");
  if (!width || !height || !colours || ![1, 2, 4, 8, 16].includes(bits)) return null;
  return Math.ceil((width * bits * colours) / 8) * height;
}

// Inline image keys may be written in full (PDF 32000-1, Table 91); these are the ones that size the data.
const INLINE_KEYS: Record<string, string> = { Width: "W", Height: "H", BitsPerComponent: "BPC", ColorSpace: "CS", ImageMask: "IM", Filter: "F", DecodeParms: "DP" };
const COLOUR_COMPONENTS: Record<string, number> = { "/G": 1, "/DeviceGray": 1, "/RGB": 3, "/DeviceRGB": 3, "/CMYK": 4, "/DeviceCMYK": 4 };
const HEX = /^[0-9A-Fa-f]$/;

/** A byte that is neither white space nor a delimiter, so it belongs to the token beside it. */
function regular(c: number): boolean {
  return !WHITE.has(c) && !DELIMITERS.has(c);
}
// NUL, tab, line feed, form feed, carriage return, space; then ( ) < > [ ] { } / %.
const WHITE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const SLASH = 47;
const LESS = 60;
const GREATER = 62;

/** True if any object in the file is an optional-content membership dictionary (/Type /OCMD). */
function hasOcmd(doc: PDFDocument): boolean {
  const visit = (o: PDFObject): boolean => {
    const d = o instanceof PDFStream ? o.dict : o;
    if (d instanceof PDFArray) return d.asArray().some(visit);
    if (!(d instanceof PDFDict)) return false;
    if (nameAt(d, TYPE) === OCMD) return true;
    return d.values().some((v) => !(v instanceof PDFRef) && visit(v));
  };
  return doc.context.enumerateIndirectObjects().some(([, o]) => visit(o));
}

function stripDeviceKeys(state: PDFDict) {
  for (const key of DEVICE_KEYS) state.delete(key);
}

/** Keeps only Link annotations, drawing nothing of their own; anything else was drawn or is dropped (R3-1, R4-1). */
function keepSafeAnnotations(page: PDFDict) {
  const annots = page.lookup(ANNOTS);
  const kept: PDFObject[] = [];
  if (annots instanceof PDFArray) {
    for (const entry of annots.asArray()) {
      const annot = page.context.lookup(entry);
      if (!(annot instanceof PDFDict) || nameAt(annot, SUBTYPE) !== LINK) continue;
      plainLink(annot);
      kept.push(entry);
    }
  }
  if (kept.length) page.set(ANNOTS, page.context.obj(kept));
  else page.delete(ANNOTS);
}

/** True for an action that only jumps within the document or opens a web or mail address. */
function safeAction(action: PDFDict): boolean {
  const kind = nameAt(action, S);
  if (kind === GOTO) return true;
  if (kind !== URI) return false;
  const uri = action.lookup(URI);
  const text = uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : "";
  return SAFE_URI.test(text.trim());
}

/** Cleans one object and the dictionaries and arrays written inside it (referenced objects get their own turn). */
function sweep(obj: PDFObject) {
  const dict = obj instanceof PDFStream ? obj.dict : obj;
  if (dict instanceof PDFArray) {
    for (const item of dict.asArray()) sweep(item);
    return;
  }
  if (!(dict instanceof PDFDict)) return;
  // Every holder of annotations, not just the pages in the page tree: copyPages also copies a page a
  // link's destination names, annotations and all, as a stray object.
  if (dict.has(ANNOTS)) keepSafeAnnotations(dict);
  // Graphics states: a /Type /ExtGState dict, and each state a resource dictionary lists (an SMask's
  // own /TR is a different key and stays).
  if (nameAt(dict, TYPE) === EXTGSTATE) stripDeviceKeys(dict);
  const states = dict.lookup(EXTGSTATE);
  if (states instanceof PDFDict) {
    for (const value of states.values()) {
      const state = dict.context.lookup(value);
      if (state instanceof PDFDict) stripDeviceKeys(state);
    }
  }
  for (const key of DROP_KEYS) dict.delete(key);
  if (dict.has(A)) {
    const action = dict.lookup(A);
    if (!(action instanceof PDFDict) || !safeAction(action)) dict.delete(A);
  }
  // An action object anywhere else (reachable through a key nobody expects) is emptied unless safe.
  const kind = nameAt(dict, S);
  // A link action with a bad address counts whether or not it says /Type /Action (Security R2-4).
  if (((nameAt(dict, TYPE) === ACTION || kind === URI) && !safeAction(dict)) || (kind !== null && UNSAFE_ACTIONS.has(kind))) {
    for (const key of dict.keys()) dict.delete(key);
  }
  for (const [, value] of dict.entries()) if (!(value instanceof PDFRef)) sweep(value);
}

function dropUnreachable(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter((o): o is PDFObject => o !== undefined);
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (seen.has(obj.tag)) continue;
      seen.add(obj.tag);
      const target = ctx.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    } else if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
    } else if (obj instanceof PDFArray) {
      stack.push(...obj.asArray());
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
}
