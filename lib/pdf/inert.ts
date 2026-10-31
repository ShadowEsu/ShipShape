import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
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
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(ANNOTS);
    if (!(annots instanceof PDFArray)) continue;
    const links: PDFObject[] = [];
    for (const entry of annots.asArray()) {
      const annot = doc.context.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = nameAt(annot, SUBTYPE);
      if (subtype === LINK) {
        annot.delete(AP);
        annot.delete(AS);
        links.push(entry);
      } else if (subtype !== null && DRAWN.has(subtype)) drawAppearance(page, annot);
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

/** Keeps only Link annotations, without an appearance; anything else was drawn or is dropped (R3-1). */
function keepSafeAnnotations(page: PDFDict) {
  const annots = page.lookup(ANNOTS);
  const kept: PDFObject[] = [];
  if (annots instanceof PDFArray) {
    for (const entry of annots.asArray()) {
      const annot = page.context.lookup(entry);
      if (!(annot instanceof PDFDict) || nameAt(annot, SUBTYPE) !== LINK) continue;
      annot.delete(AP);
      annot.delete(AS);
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
