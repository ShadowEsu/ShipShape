import { PDFDocument, StandardFonts, degrees, type PDFFont, type PDFPage, type RGB } from "pdf-lib";

/**
 * What ShipShape's own documents are drawn on (spot 5b): a pdf-lib page for the file, or a recorder for the preview a
 * sample's document page shows. The same drawing calls go to either, with the same standard-font widths, so a preview
 * is the file's page without reading the file.
 */

/** US Letter, in points: every page ShipShape draws. */
export const LETTER = { w: 612, h: 792 };
/** The PDF standard fonts ShipShape draws with: Helvetica and Times. */
export type FontKey = "sans" | "sansBold" | "serif" | "serifBold" | "serifItalic";
export type Fonts = Record<FontKey, PDFFont>;

/** A page to draw on, in PDF points (y grows upward). */
export interface Surface {
  text(s: string, x: number, y: number, size: number, font: FontKey, color: RGB, turn?: { opacity: number; degrees: number }): void;
  rect(x: number, y: number, w: number, h: number, look: { fill?: RGB; stroke?: RGB; strokeWidth?: number }): void;
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, color: RGB, dash?: [number, number]): void;
  circle(cx: number, cy: number, r: number, stroke: RGB, strokeWidth: number): void;
  width(s: string, size: number, font: FontKey): number;
}

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
}

export function pdfSurface(page: PDFPage, f: Fonts): Surface {
  return {
    text: (s, x, y, size, font, color, turn) =>
      page.drawText(s, { x, y, size, font: f[font], color, ...(turn && { opacity: turn.opacity, rotate: degrees(turn.degrees) }) }),
    rect: (x, y, width, height, look) =>
      page.drawRectangle({ x, y, width, height, ...(look.fill && { color: look.fill }), ...(look.stroke && { borderColor: look.stroke, borderWidth: look.strokeWidth ?? 1 }) }),
    line: (x1, y1, x2, y2, thickness, color, dash) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color, ...(dash && { dashArray: dash }) }),
    circle: (x, y, size, borderColor, borderWidth) => page.drawCircle({ x, y, size, borderColor, borderWidth }),
    width: (s, size, font) => f[font].widthOfTextAtSize(s, size),
  };
}

/**
 * One mark of a preview, in SVG units (y grows downward), with colours as hex. A text's `width` is its width in the
 * PDF's own font: the SVG fits the browser's face to it (textLength), so a phone without Arial or Times New Roman
 * still sets each word where the file has it.
 */
export type PaperMark =
  | { kind: "text"; text: string; x: number; y: number; size: number; font: FontKey; fill: string; width: number; opacity?: number; rotate?: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dash?: string }
  | { kind: "circle"; cx: number; cy: number; r: number; stroke: string; strokeWidth: number };

const hex = (c: RGB) => `#${[c.red, c.green, c.blue].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
/** Rounded to a hundredth of a point: the preview's size, not the PDF's precision. */
const at = (n: number) => Math.round(n * 100) / 100;

/** A surface that records marks for a page `height` points tall, flipping y for SVG. */
export function recorder(f: Fonts, height: number, marks: PaperMark[]): Surface {
  return {
    text: (str, x, y, size, font, color, turn) =>
      marks.push({
        kind: "text",
        text: str,
        x: at(x),
        y: at(height - y),
        size,
        font,
        fill: hex(color),
        width: at(f[font].widthOfTextAtSize(str, size)),
        ...(turn && { opacity: turn.opacity, rotate: turn.degrees }),
      }),
    rect: (x, y, width, h, look) =>
      marks.push({
        kind: "rect",
        x: at(x),
        y: at(height - y - h),
        width: at(width),
        height: at(h),
        ...(look.fill && { fill: hex(look.fill) }),
        ...(look.stroke && { stroke: hex(look.stroke), strokeWidth: look.strokeWidth ?? 1 }),
      }),
    line: (x1, y1, x2, y2, strokeWidth, color, dash) =>
      marks.push({ kind: "line", x1: at(x1), y1: at(height - y1), x2: at(x2), y2: at(height - y2), stroke: hex(color), strokeWidth, ...(dash && { dash: dash.join(" ") }) }),
    circle: (cx, cy, r, stroke, strokeWidth) => marks.push({ kind: "circle", cx: at(cx), cy: at(height - cy), r, stroke: hex(stroke), strokeWidth }),
    width: (s, size, font) => f[font].widthOfTextAtSize(s, size),
  };
}

// The standard fonts' metrics for previews, from a document that's never saved. Kept for the process once they load;
// a load that fails isn't kept, so the next preview tries again.
let metrics: Promise<Fonts> | undefined;
export const previewFonts = () =>
  (metrics ??= PDFDocument.create()
    .then(embedFonts)
    .catch((e: unknown) => {
      metrics = undefined;
      throw e;
    }));
