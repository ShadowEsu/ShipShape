import { createHash } from "node:crypto";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, type PDFObject } from "pdf-lib";

const PARENT = PDFName.of("Parent");

/**
 * A hash of how a PDF's page is drawn: its content streams and everything its resources reach (fonts, form appearances,
 * images), streams decoded, in the order they're reached. The same page drawn again hashes the same, since the file's
 * dates and IDs aren't part of it. The sample W-9's preview images (lib/server/sample.ts SAMPLE_W9_IMAGES) are made
 * with it (scripts/sample-w9-image.run.ts) and checked against it (tests/sample-preview.test.ts). Test and script code
 * only, outside app/lib/components: it loads bytes ShipShape made, never an upload (scripts/check-pdf-load.mjs).
 */
export async function pageHash(bytes: Uint8Array, index = 0): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const hash = createHash("sha256");
  const seen = new Set<string>();
  const walk = (o: PDFObject | undefined): void => {
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) return;
      seen.add(o.tag);
      walk(doc.context.lookup(o));
    } else if (o instanceof PDFRawStream) {
      hash.update(decodePDFRawStream(o).decode());
      walkDict(o.dict);
    } else if (o instanceof PDFArray) {
      for (const item of o.asArray()) walk(item);
    } else if (o instanceof PDFDict) {
      walkDict(o);
    } else if (o) {
      hash.update(o.toString());
    }
  };
  // Not /Parent: it leads back up the page tree to every other page.
  const walkDict = (d: PDFDict) => {
    for (const [key, value] of d.entries()) {
      if (key === PARENT) continue;
      hash.update(key.toString());
      walk(value);
    }
  };
  const page = doc.getPage(index).node;
  walk(page.get(PDFName.of("Contents")));
  walk(page.get(PDFName.of("Resources")));
  return hash.digest("hex");
}
