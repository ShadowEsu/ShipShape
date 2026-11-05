import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { embedFonts, LETTER, pdfSurface, previewFonts, recorder, type FontKey, type PaperMark, type Surface } from "./surface";

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

const PAGE = { ...LETTER, margin: 72 };
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
/** The distinct characters of a one-line value the fonts can't draw, in order (a line break reads as "a line break"), so a refusal can name them. */
export const unprintableChars = (s: string): string[] => [...new Set(s.match(UNPRINTABLE) ?? [])].map((c) => (/[\r\n]/.test(c) ? "a line break" : c));

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
export function wrapLines(text: string, font: Pick<PDFFont, "widthOfTextAtSize">, size: number, width: number): string[] {
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

class Writer {
  page!: Surface;
  y = 0;
  pages: Surface[] = [];
  constructor(private addPage: () => Surface) {
    this.newPage();
  }
  get width() {
    return PAGE.w - PAGE.margin * 2;
  }
  newPage() {
    this.page = this.addPage();
    this.pages.push(this.page);
    this.y = PAGE.h - PAGE.margin;
  }
  ensure(height: number) {
    if (this.y - height < PAGE.margin + 24) this.newPage();
  }

  private fontFor(sans: boolean) {
    return (r: Run): FontKey => (sans ? (r.bold ? "sansBold" : "sans") : r.bold ? "serifBold" : "serif");
  }

  /** The lines `runs` wrap to in `width` at `size`: each a list of words, each word its runs. A line break or empty text is an empty line. */
  private layout(runs: Run[], width: number, size: number, sans: boolean): Run[][][] {
    const fontOf = this.fontFor(sans);
    const words = wordsOf(runs);
    const widthOf = (w: Run[]) => w.reduce((n, p) => n + this.page.width(p.text, size, fontOf(p)), 0);
    const space = (w: Run[]) => this.page.width(" ", size, fontOf(w[0]));
    const lines: Run[][][] = [];
    let line: Run[][] = [];
    let lineWidth = 0;
    const flush = () => {
      lines.push(line);
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
    return lines;
  }

  /** How far flow moves y for these runs, so a block can be kept on one page before any of it is drawn. */
  height(runs: Run[], { width = this.width, size = 10.5, leading = 1.45, sans = false } = {}) {
    return this.layout(runs, width, size, sans).length * size * leading;
  }

  /** Lays out runs as wrapped lines starting at x; returns nothing, moves y down. */
  flow(runs: Run[], { x = PAGE.margin, width = this.width, size = 10.5, leading = 1.45, color = INK, sans = false } = {}) {
    const fontOf = this.fontFor(sans);
    const lineHeight = size * leading;
    for (const line of this.layout(runs, width, size, sans)) {
      this.ensure(lineHeight);
      let cx = x;
      for (const [wi, w] of line.entries()) {
        if (wi > 0) cx += this.page.width(" ", size, fontOf(w[0]));
        for (const p of w) {
          this.page.text(p.text, cx, this.y - size, size, fontOf(p), color);
          cx += this.page.width(p.text, size, fontOf(p));
        }
      }
      this.y -= lineHeight;
    }
  }
}

/** Draws the blocks onto pages from `addPage`, then each page's footer and "Page n of N". */
function draw(blocks: Block[], footer: string, addPage: () => Surface) {
  const w = new Writer(addPage);

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
        w.page.text(b.number, PAGE.margin, top - 10.5, 10.5, "serifBold", INK);
        w.flow(b.runs, { x: PAGE.margin + 22, width: w.width - 22 });
        w.y -= 5;
        break;
      }
      case "rows":
        for (const [label, value] of b.rows) {
          // The whole row on one page: a label and value laid out from one top, one of them carried
          // onto the next page, would put the other at the old page's height there (W11-4).
          const labelRuns = [{ text: label, bold: true }];
          const valueRuns = [{ text: value || "—" }];
          w.ensure(Math.max(30, w.height(labelRuns, { width: 150, size: 9.5, sans: true }), w.height(valueRuns, { width: w.width - 160 })));
          const top = w.y;
          w.flow(labelRuns, { width: 150, size: 9.5, sans: true });
          const afterLabel = w.y;
          w.y = top;
          w.flow(valueRuns, { x: PAGE.margin + 160, width: w.width - 160 });
          w.y = Math.min(w.y, afterLabel) - 6;
          w.page.line(PAGE.margin, w.y + 3, PAGE.w - PAGE.margin, w.y + 3, 0.4, rgb(0.85, 0.85, 0.85));
        }
        w.y -= 6;
        break;
      case "table": {
        const cols = b.head.length;
        const labelW = 110;
        const colW = (w.width - labelW) / (cols - 1);
        const rowsAll = [b.head, ...b.rows];
        for (const [ri, row] of rowsAll.entries()) {
          const cells = row.map((cell, ci) => {
            const heading = ri === 0 || ci === 0;
            return {
              runs: [{ text: cell || " ", bold: heading }],
              x: ci === 0 ? PAGE.margin : PAGE.margin + labelW + colW * (ci - 1),
              opts: { width: ci === 0 ? labelW - 8 : colW - 8, size: heading ? 9.5 : 10.5, sans: heading },
            };
          });
          // Every cell of a row on one page, as with "rows" (W11-4).
          w.ensure(Math.max(28, ...cells.map((c) => w.height(c.runs, c.opts))));
          const top = w.y;
          let bottom = top;
          for (const c of cells) {
            w.y = top;
            w.flow(c.runs, { x: c.x, ...c.opts });
            bottom = Math.min(bottom, w.y);
          }
          w.y = Math.min(bottom, top - 22) - 4;
          w.page.line(PAGE.margin, w.y + 3, PAGE.w - PAGE.margin, w.y + 3, 0.4, rgb(0.7, 0.7, 0.7));
        }
        w.y -= 8;
        break;
      }
      case "space":
        w.y -= b.height;
        break;
      case "rule":
        w.ensure(12);
        w.page.line(PAGE.margin, w.y - 4, PAGE.w - PAGE.margin, w.y - 4, 0.8, INK);
        w.y -= 14;
        break;
      case "stamp": {
        // A diagonal watermark on the current page (used for SAMPLE documents).
        const size = 64;
        const tw = w.page.width(b.text, size, "sansBold");
        for (const page of w.pages) {
          page.text(b.text, PAGE.w / 2 - (tw / 2) * 0.7, PAGE.h / 2 - tw * 0.35, size, "sansBold", rgb(0.86, 0.2, 0.18), { opacity: 0.12, degrees: 35 });
        }
        break;
      }
    }
  }

  const total = w.pages.length;
  for (const [i, page] of w.pages.entries()) {
    // Wrapped upwards from the page label's baseline, so a long footer never runs off the page.
    const lines = wrapLines(footer, { widthOfTextAtSize: (t, size) => page.width(t, size, "sans") }, 7.5, PAGE.w - PAGE.margin * 2 - 70);
    for (const [li, text] of lines.entries()) {
      page.text(text, PAGE.margin, 40 + (lines.length - 1 - li) * 9.5, 7.5, "sans", MUTED);
    }
    const label = `Page ${i + 1} of ${total}`;
    page.text(label, PAGE.w - PAGE.margin - page.width(label, 7.5, "sans"), 40, 7.5, "sans", MUTED);
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
  const f = await embedFonts(doc);
  draw(blocks, meta.footer, () => pdfSurface(doc.addPage([PAGE.w, PAGE.h]), f));
  return doc.save();
}

/** Every page composePdf would draw for these blocks, as preview marks: the same calls, recorded instead of drawn. */
export async function composeMarks(blocks: Block[], footer: string): Promise<PaperMark[][]> {
  const f = await previewFonts();
  const pages: PaperMark[][] = [];
  draw(blocks, footer, () => {
    const marks: PaperMark[] = [];
    pages.push(marks);
    return recorder(f, PAGE.h, marks);
  });
  return pages;
}
