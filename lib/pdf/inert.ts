import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, type PDFDocument, type PDFObject } from "pdf-lib";

/**
 * Makes a PDF that ShipShape builds from someone's upload (a signed copy) unable to run anything
 * (Security F3, F3-1..F3-3). It works on the finished document as a whole rather than along known
 * paths, because scripts can hang off almost any object: a field's parent, a popup, presentation
 * steps, a form XObject.
 *
 * 1. Pages (and any stray copy of one) keep only annotation types that just show something (F3-2).
 *    Form fields should be flattened into the page before copying (flattenForm), so no widget is left.
 * 2. Every object loses its script and trigger keys, and any /A that isn't a jump within the
 *    document or a web/mail link (F3-1, F3-3). Unsafe action objects are emptied wherever they sit.
 * 3. Objects nothing points to any more (a dropped attachment's file, say) are deleted, so they
 *    aren't even written into the file.
 */
export function makeInert(doc: PDFDocument): void {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) sweep(obj);
  dropUnreachable(doc);
}

/** Fields become part of the page drawing; their scripts and widgets go. False if the form can't be flattened. */
export function flattenForm(doc: PDFDocument): boolean {
  try {
    doc.getForm().flatten();
    return true;
  } catch {
    return false;
  }
}

const ANNOTATIONS = new Set(
  ["Link", "Text", "FreeText", "Line", "Square", "Circle", "Polygon", "PolyLine", "Highlight", "Underline", "Squiggly", "StrikeOut", "Stamp", "Caret", "Ink"].map((s) =>
    PDFName.of(s),
  ),
);

// Keys that trigger or carry scripts, other documents, media, attachments or links to other
// annotations; none matters for how a page looks.
const DROP_KEYS = ["JS", "AA", "OpenAction", "Next", "PresSteps", "Popup", "IRT", "EF", "RichMediaContent", "RichMediaSettings", "3DD"].map((k) => PDFName.of(k));
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
const SAFE_URI = /^(https?|mailto):/i;

/** A name value, or null when the key is missing or holds anything else (hostile files do that). */
function nameAt(dict: PDFDict, key: PDFName): PDFName | null {
  const v = dict.lookup(key);
  return v instanceof PDFName ? v : null;
}

function keepSafeAnnotations(page: PDFDict) {
  const annots = page.lookup(ANNOTS);
  const kept =
    annots instanceof PDFArray
      ? annots.asArray().filter((entry) => {
          const annot = page.context.lookup(entry);
          const subtype = annot instanceof PDFDict ? nameAt(annot, SUBTYPE) : null;
          return subtype !== null && ANNOTATIONS.has(subtype);
        })
      : [];
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
  if ((nameAt(dict, TYPE) === ACTION && !safeAction(dict)) || (kind !== null && UNSAFE_ACTIONS.has(kind))) {
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
