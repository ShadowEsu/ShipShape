import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { breakWord, composePdf, wordsOf, wrapLines, type Run } from "@/lib/pdf/compose";

/** Each word drawn in a generated PDF, with the pages it's on (composePdf draws word by word). */
async function pagesOfWords(bytes: Uint8Array): Promise<Map<string, number[]>> {
  const doc = await PDFDocument.load(bytes);
  const at = new Map<string, number[]>();
  for (const [i, page] of doc.getPages().entries()) {
    const contents = page.node.lookup(PDFName.of("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray().map((s) => doc.context.lookup(s)) : [contents];
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const text = Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
      for (const [, hex] of text.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) {
        const word = Buffer.from(hex, "hex").toString("latin1");
        at.set(word, [...(at.get(word) ?? []), i]);
      }
    }
  }
  return at;
}

const texts = (words: ReturnType<typeof wordsOf>) => words.map((w) => (w === "br" ? "br" : w.map((p) => p.text).join("+")));

describe("generated PDFs' text layout", () => {
  it("keeps a bold run joined to the quotes around it, and spaces only where the text has one", () => {
    const words = wordsOf([{ text: "this Cover Page (“" }, { text: "Cover Page", bold: true }, { text: "”) and " }, { text: "Introduction", bold: true }, { text: ". This" }]);
    expect(texts(words)).toEqual(["this", "Cover", "Page", "(“+Cover", "Page+”)", "and", "Introduction+.", "This"]);
    const [quote, cover] = words[3] === "br" ? [] : words[3];
    expect([quote?.bold, cover?.bold]).toEqual([undefined, true]);
  });

  it("keeps line breaks from a form's text box, and empty text has no words", () => {
    expect(texts(wordsOf([{ text: "Northwind Builders\n12 Main St" }]))).toEqual(["Northwind", "Builders", "br", "12", "Main", "St"]);
    expect(wordsOf([{ text: " " }])).toEqual([]);
  });

  it("wraps a long footer into lines that fit, losing no words", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const footer = "Cover Page filled with ShipShape; Standard Terms unchanged from Common Paper (CC BY 4.0). ShipShape is not a law firm.";
    const lines = wrapLines(footer, font, 7.5, 398);
    expect(lines.length).toBe(2);
    expect(lines.every((l) => font.widthOfTextAtSize(l, 7.5) <= 398)).toBe(true);
    expect(lines.join(" ")).toBe(footer);
  });

  it("cuts a notice email wider than its table column into pieces that fit, the next word after the last piece", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.TimesRoman);
    const email = "accounts.payable@harborplumbingandheating.com";
    expect(font.widthOfTextAtSize(email, 10.5)).toBeGreaterThan(171);
    const lines = wrapLines(`${email} Attn`, font, 10.5, 171);
    expect(lines.length).toBe(2);
    expect(lines.every((l) => font.widthOfTextAtSize(l, 10.5) <= 171)).toBe(true);
    expect(lines.at(-1)?.endsWith(" Attn")).toBe(true);
    expect(lines.join("")).toBe(`${email} Attn`);
  });

  it("puts a SHA-256 value on two lines of the certificate's 308 pt column, each part keeping its style", async () => {
    const doc = await PDFDocument.create();
    const [regular, bold] = [await doc.embedFont(StandardFonts.TimesRoman), await doc.embedFont(StandardFonts.TimesRomanBold)];
    const widthOf = (w: Run[]) => w.reduce((n, p) => n + (p.bold ? bold : regular).widthOfTextAtSize(p.text, 10.5), 0);
    const hex = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const pieces = breakWord([{ text: hex }], 308, widthOf).map((p) => p.map((r) => r.text).join(""));
    expect(pieces.length).toBe(2);
    expect(pieces.join("")).toBe(hex);
    expect(pieces.every((p) => regular.widthOfTextAtSize(p, 10.5) <= 308)).toBe(true);
    // The first piece is the longest that fits: one more character would not.
    expect(regular.widthOfTextAtSize(hex.slice(0, (pieces[0] ?? "").length + 1), 10.5)).toBeGreaterThan(308);

    const split = breakWord([{ text: "SHA-256:" }, { text: hex, bold: true }], 308, widthOf);
    expect(split.flat().map((r) => `${r.bold ? "b" : "r"}:${r.text}`).join("|")).toMatch(/^r:SHA-256:\|b:[0-9a-f]+\|b:[0-9a-f]+$/);
    expect(split.flat().map((r) => r.text).join("")).toBe(`SHA-256:${hex}`);
  });

  it("never splits a table row or a label-value row across pages, wherever the page break falls (W11-4)", async () => {
    const alphas = Array.from({ length: 30 }, (_, i) => `alpha${i}`);
    const charlies = Array.from({ length: 30 }, (_, i) => `charlie${i}`);
    let crossed = 0;
    // Push the rows down 5 pt at a time, so every position against the bottom margin comes up.
    for (let height = 0; height <= 650; height += 5) {
      const bytes = await composePdf(
        [
          { type: "space", height },
          { type: "table", head: ["", "Party 1", "Party 2"], rows: [["Notice", alphas.join(" "), "bravo"]] },
          { type: "rows", rows: [["Delta", charlies.join(" ")]] },
        ],
        { title: "Layout", footer: "Footer" },
      );
      const pages = await pagesOfWords(bytes);
      const pagesOf = (words: string[]) => new Set(words.flatMap((word) => pages.get(word) ?? [NaN]));
      const table = pagesOf(["Notice", ...alphas, "bravo"]);
      const rows = pagesOf(["Delta", ...charlies]);
      expect([...table], `table row at ${height}`).toHaveLength(1);
      expect([...rows], `rows row at ${height}`).toHaveLength(1);
      expect(table.has(NaN) || rows.has(NaN), `a word went missing at ${height}`).toBe(false);
      if ([...table][0] > 0 || [...rows][0] > 0) crossed++;
    }
    expect(crossed).toBeGreaterThan(0); // some positions did put a row on the next page
  });
});
