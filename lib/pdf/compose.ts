import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A small text composer for documents ShipShape generates (NDA cover pages, sample documents,
 * signature certificates): headings, paragraphs with **bold** runs, numbered clauses, label/value
 * rows, signature tables, and a footer on every page. US Letter, 1-inch margins.
 */

export type Run = { text: string; bold?: boolean };
export type Block =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "para"; runs: Run[]; size?: number; muted?: boolean }
  | { type: "clause"; number: string; runs: Run[] }
  | { type: "rows"; rows: [label: string, value: string][] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "space"; height: number }
  | { type: "rule" }
  | { type: "stamp"; text: string };

const PAGE = { w: 612, h: 792, margin: 72 };
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.4, 0.4, 0.4);

// Characters the standard PDF fonts can draw (WinAnsi). Inputs outside this set are refused with a
// clear message rather than silently dropped.
const PRINTABLE = /^[\x20-\x7E\u00A0-\u00FF\u2018\u2019\u201C\u201D\u2013\u2014\u2022\u2026\u20AC\n]*$/;
export const isPrintable = (s: string) => PRINTABLE.test(s);

/** Parses the inline markdown used in the Common Paper source: **bold**, [links](…), <span> tags. */
export function inlineRuns(md: string): Run[] {
  const clean = md
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return clean.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
    part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part },
  );
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  sans: PDFFont;
  sansBold: PDFFont;
}

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(private doc: PDFDocument, private f: Fonts) {
    this.newPage();
  }
  get width() {
    return PAGE.w - PAGE.margin * 2;
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    this.y = PAGE.h - PAGE.margin;
  }
  ensure(height: number) {
    if (this.y - height < PAGE.margin + 24) this.newPage();
  }

  /** Lays out runs as wrapped lines starting at x; returns nothing, moves y down. */
  flow(runs: Run[], { x = PAGE.margin, width = this.width, size = 10.5, leading = 1.45, color = INK, sans = false } = {}) {
    const words: { text: string; font: PDFFont }[] = [];
    for (const r of runs) {
      const font = sans ? (r.bold ? this.f.sansBold : this.f.sans) : r.bold ? this.f.bold : this.f.regular;
      for (const [i, w] of r.text.split(" ").entries()) {
        if (w === "" && i > 0) continue;
        words.push({ text: w, font });
      }
    }
    const lineHeight = size * leading;
    let line: typeof words = [];
    let lineWidth = 0;
    const space = (font: PDFFont) => font.widthOfTextAtSize(" ", size);
    const flush = () => {
      this.ensure(lineHeight);
      let cx = x;
      for (const w of line) {
        this.page.drawText(w.text, { x: cx, y: this.y - size, size, font: w.font, color });
        cx += w.font.widthOfTextAtSize(w.text, size) + space(w.font);
      }
      this.y -= lineHeight;
      line = [];
      lineWidth = 0;
    };
    for (const w of words) {
      const ww = w.font.widthOfTextAtSize(w.text, size);
      if (line.length && lineWidth + space(w.font) + ww > width) flush();
      lineWidth += (line.length ? space(w.font) : 0) + ww;
      line.push(w);
    }
    if (line.length) flush();
  }
}

export async function composePdf(
  blocks: Block[],
  meta: { title: string; subject?: string; footer: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  if (meta.subject) doc.setSubject(meta.subject);
  doc.setProducer("ShipShape");
  doc.setCreator("ShipShape");
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const w = new Writer(doc, f);

  for (const b of blocks) {
    switch (b.type) {
      case "title":
        w.ensure(40);
        w.flow([{ text: b.text, bold: true }], { size: 18, leading: 1.25 });
        w.y -= 8;
        break;
      case "heading":
        w.ensure(36);
        w.y -= 6;
        w.flow([{ text: b.text, bold: true }], { size: 12.5, leading: 1.3 });
        w.y -= 2;
        break;
      case "para":
        w.flow(b.runs, { size: b.size ?? 10.5, color: b.muted ? MUTED : INK });
        w.y -= 6;
        break;
      case "clause": {
        w.ensure(16);
        const top = w.y;
        w.page.drawText(b.number, { x: PAGE.margin, y: top - 10.5, size: 10.5, font: f.bold, color: INK });
        w.flow(b.runs, { x: PAGE.margin + 22, width: w.width - 22 });
        w.y -= 5;
        break;
      }
      case "rows":
        for (const [label, value] of b.rows) {
          w.ensure(30);
          const top = w.y;
          w.flow([{ text: label, bold: true }], { width: 150, size: 9.5, sans: true });
          const afterLabel = w.y;
          w.y = top;
          w.flow([{ text: value || "—" }], { x: PAGE.margin + 160, width: w.width - 160 });
          w.y = Math.min(w.y, afterLabel) - 6;
          w.page.drawLine({ start: { x: PAGE.margin, y: w.y + 3 }, end: { x: PAGE.w - PAGE.margin, y: w.y + 3 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.85) });
        }
        w.y -= 6;
        break;
      case "table": {
        const cols = b.head.length;
        const labelW = 110;
        const colW = (w.width - labelW) / (cols - 1);
        const rowsAll = [b.head, ...b.rows];
        for (const [ri, row] of rowsAll.entries()) {
          w.ensure(28);
          const top = w.y;
          let bottom = top;
          for (const [ci, cell] of row.entries()) {
            w.y = top;
            const x = ci === 0 ? PAGE.margin : PAGE.margin + labelW + colW * (ci - 1);
            const width = ci === 0 ? labelW - 8 : colW - 8;
            w.flow([{ text: cell || " ", bold: ri === 0 || ci === 0 }], { x, width, size: ri === 0 || ci === 0 ? 9.5 : 10.5, sans: ri === 0 || ci === 0 });
            bottom = Math.min(bottom, w.y);
          }
          w.y = Math.min(bottom, top - 22) - 4;
          w.page.drawLine({ start: { x: PAGE.margin, y: w.y + 3 }, end: { x: PAGE.w - PAGE.margin, y: w.y + 3 }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) });
        }
        w.y -= 8;
        break;
      }
      case "space":
        w.y -= b.height;
        break;
      case "rule":
        w.ensure(12);
        w.page.drawLine({ start: { x: PAGE.margin, y: w.y - 4 }, end: { x: PAGE.w - PAGE.margin, y: w.y - 4 }, thickness: 0.8, color: INK });
        w.y -= 14;
        break;
      case "stamp": {
        // A diagonal watermark on the current page (used for SAMPLE documents).
        const size = 64;
        const tw = f.sansBold.widthOfTextAtSize(b.text, size);
        for (const page of w.pages) {
          page.drawText(b.text, { x: PAGE.w / 2 - (tw / 2) * 0.7, y: PAGE.h / 2 - tw * 0.35, size, font: f.sansBold, color: rgb(0.86, 0.2, 0.18), opacity: 0.12, rotate: degrees(35) });
        }
        break;
      }
    }
  }

  const total = w.pages.length;
  for (const [i, page] of w.pages.entries()) {
    page.drawText(meta.footer, { x: PAGE.margin, y: 40, size: 7.5, font: f.sans, color: MUTED, maxWidth: PAGE.w - PAGE.margin * 2 - 70 });
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: PAGE.w - PAGE.margin - f.sans.widthOfTextAtSize(label, 7.5), y: 40, size: 7.5, font: f.sans, color: MUTED });
  }
  return doc.save();
}
