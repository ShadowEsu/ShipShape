import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { breakWord, wordsOf, wrapLines, type Run } from "@/lib/pdf/compose";

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
});
