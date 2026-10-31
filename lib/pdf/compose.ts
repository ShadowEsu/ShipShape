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
// clear message rather than silently dropped. One-line values (titles, names, labels, typed
// signatures) can't hold a line break: drawn on one line, it can't be encoded (Security F4-1).
const LINE_SET = String.raw`\x20-\x7E\u00A0-\u00FF\u2018\u2019\u201C\u201D\u2013\u2014\u2022\u2026\u20AC`;
const PRINTABLE_LINE = new RegExp(`^[${LINE_SET}]*$`, "u");
const PRINTABLE_TEXT = new RegExp(`^[${LINE_SET}\\n]*$`, "u");
const UNPRINTABLE = new RegExp(`[^${LINE_SET}]`, "gu");
/** A one-line value the PDF fonts can draw. */
export const isPrintable = (s: string) => PRINTABLE_LINE.test(s);
/** Multi-line text (a form's text box) the PDF fonts can draw. */
export const isPrintableText = (s: string) => PRINTABLE_TEXT.test(s);
/** For one-line text that must be drawn whatever it holds (a certificate row): line breaks become spaces, anything else the fonts can't draw becomes "?". */
export const printableOnly = (s: string) => s.replace(/\r\n?|\n/g, " ").replace(UNPRINTABLE, "?");

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

/**
 * Splits runs into words at spaces only, for laying out. A run that starts or ends without a space
 * stays joined to the text beside it (“**Cover Page**” draws no space inside the quotes), and a
 * joined word is split across lines only when it is wider than a line (see `breakWord`). "br" is a
 * line break in the text (a form's text box).
 */
export function wordsOf(runs: Run[]): (Run[] | "br")[] {
  const words: (Run[] | "br")[] = [];
  let joined = false; // the next piece continues the last word: no space came between them
  for (const r of runs) {
    for (const [li, segment] of r.text.split("\n").entries()) {
      if (li > 0) {
        words.push("br");
        joined = false;
      }
      for (const [i, text] of segment.split(" ").entries()) {
        if (i > 0) joined = false;
        if (text === "") continue;
        const last = words.at(-1);
        if (joined && last !== undefined && last !== "br") last.push({ ...r, text });
        else words.push([{ ...r, text }]);
        joined = true;
      }
    }
  }
  return words;
}

/**
 * Cuts a word wider than `width` (a long email address, a SHA-256 value) into the longest pieces
 * that fit, each at least one character, so it never runs past its line or column. Each part keeps
 * its run's style. A word that fits comes back whole.
 */
export function breakWord(word: Run[], width: number, widthOf: (w: Run[]) => number): Run[][] {
  if (widthOf(word) <= width) return [word];
  const pieces: Run[][] = [];
  let done: Run[] = []; // the piece so far, from the runs before this one
  for (const r of word) {
    let text = ""; // the piece's part of this run
    for (const ch of r.text) {
      if ((done.length || text) && widthOf([...done, { ...r, text: text + ch }]) > width) {
        pieces.push(text ? [...done, { ...r, text }] : done);
        done = [];
        text = ch;
      } else text += ch;
    }
    if (text) done.push({ ...r, text });
  }
  if (done.length) pieces.push(done);
  return pieces;
}

/** Wraps one-font text into lines no wider than `width`; a word wider than a line is cut (`breakWord`). */
export function wrapLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const widthOf = (w: Run[]) => font.widthOfTextAtSize(w.map((r) => r.text).join(""), size);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const pieces = breakWord([{ text: word }], width, widthOf);
    for (const piece of pieces) {
      const p = piece.map((r) => r.text).join("");
      const next = line ? `${line} ${p}` : p;
      // Each piece of a cut word starts its own line; the words after it continue on the last one.
      if (line && (pieces.length > 1 || font.widthOfTextAtSize(next, size) > width)) {
        lines.push(line);
        line = p;
      } else line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
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
    const fontOf = (r: Run) => (sans ? (r.bold ? this.f.sansBold : this.f.sans) : r.bold ? this.f.bold : this.f.regular);
    const words = wordsOf(runs);
    const lineHeight = size * leading;
    const widthOf = (w: Run[]) => w.reduce((n, p) => n + fontOf(p).widthOfTextAtSize(p.text, size), 0);
    const space = (w: Run[]) => fontOf(w[0]).widthOfTextAtSize(" ", size);
    let line: Run[][] = [];
    let lineWidth = 0;
    const flush = () => {
      this.ensure(lineHeight);
      let cx = x;
      for (const [wi, w] of line.entries()) {
        if (wi > 0) cx += space(w);
        for (const p of w) {
          this.page.drawText(p.text, { x: cx, y: this.y - size, size, font: fontOf(p), color });
          cx += fontOf(p).widthOfTextAtSize(p.text, size);
        }
      }
      this.y -= lineHeight;
      line = [];
      lineWidth = 0;
    };
    for (const w of words) {
      if (w === "br") {
        flush();
        continue;
      }
      const pieces = breakWord(w, width, widthOf);
      for (const p of pieces) {
        const pw = widthOf(p);
        // Each piece of a cut word starts its own line; the words after it continue on the last one.
        if (line.length && (pieces.length > 1 || lineWidth + space(p) + pw > width)) flush();
        lineWidth += (line.length ? space(p) : 0) + pw;
        line.push(p);
      }
    }
    // Empty text still takes one line (an empty table cell keeps its row height).
    if (line.length || !words.length) flush();
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
    // Wrapped upwards from the page label's baseline, so a long footer never runs off the page.
    const lines = wrapLines(meta.footer, f.sans, 7.5, PAGE.w - PAGE.margin * 2 - 70);
    for (const [li, text] of lines.entries()) {
      page.drawText(text, { x: PAGE.margin, y: 40 + (lines.length - 1 - li) * 9.5, size: 7.5, font: f.sans, color: MUTED });
    }
    const label = `Page ${i + 1} of ${total}`;
    page.drawText(label, { x: PAGE.w - PAGE.margin - f.sans.widthOfTextAtSize(label, 7.5), y: 40, size: 7.5, font: f.sans, color: MUTED });
  }
  return doc.save();
}
