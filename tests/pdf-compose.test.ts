import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { wordsOf, wrapLines } from "@/lib/pdf/compose";

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
});
