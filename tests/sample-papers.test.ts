import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { composeMarks, composePdf, type Block } from "@/lib/pdf/compose";
import { samplePaperMarks, samplePaperPdf, type SampleBusiness, type SamplePaper } from "@/lib/pdf/sample-papers";
import { LETTER, type FontKey, type PaperMark } from "@/lib/pdf/surface";

interface Drawn {
  text: string;
  font: string;
  size: number;
  x: number;
  y: number;
}

/** Each page's drawn strings, in order, with the font, size and place pdf-lib's drawText wrote for them. */
async function drawnPages(bytes: Uint8Array): Promise<Drawn[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.lookup(PDFName.of("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray().map((s) => doc.context.lookup(s)) : [contents];
    const out: Drawn[] = [];
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const ops = Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
      // "/Helvetica-Bold-123 6.5 Tf ... a b c d x y Tm <hex> Tj": the font's name carries a random suffix.
      for (const m of ops.matchAll(/\/([A-Za-z-]+)-\d+ ([\d.]+) Tf[\s\S]*?([-\d.]+) ([-\d.]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g)) {
        out.push({ font: m[1], size: Number(m[2]), x: Number(m[3]), y: Number(m[4]), text: Buffer.from(m[5], "hex").toString("latin1") });
      }
    }
    return out;
  });
}

const BASE_FONT: Record<FontKey, string> = { sans: "Helvetica", sansBold: "Helvetica-Bold", serif: "Times-Roman", serifBold: "Times-Bold", serifItalic: "Times-Italic" };
const texts = (marks: PaperMark[]) => marks.flatMap((m) => (m.kind === "text" ? [m] : []));

/** The preview's texts are the file's: same strings, fonts and sizes in the same order, at the same place (y flipped). */
function expectSamePage(marks: PaperMark[], file: Drawn[]) {
  const t = texts(marks);
  expect(t.map((m) => [m.text, BASE_FONT[m.font], m.size])).toEqual(file.map((d) => [d.text, d.font, d.size]));
  const off = t.flatMap((m, i) => (Math.abs(m.x - file[i].x) < 0.01 && Math.abs(LETTER.h - m.y - file[i].y) < 0.01 ? [] : [m.text]));
  expect(off).toEqual([]);
}

const business: SampleBusiness = { legalName: "Harbor Plumbing LLC", dba: "Harbor Plumbing", address: ["100 Example Street", "Springfield, CA 90000"], signer: "Alex Rivera" };
const PAPERS: SamplePaper[] = [
  { kind: "coi", business, dates: { issued: "2025-11-25", from: "2025-11-25", to: "2026-11-25" } },
  { kind: "contractor-license", business, license: { issued: "2025-07-12", expires: "2027-07-12", number: "SAMPLE-000000" } },
  { kind: "city-license", business, license: { from: "2025-10-23", to: "2026-10-23", account: "SAMPLE-BL-0000" } },
];

describe("the sample's papers", () => {
  it("each says SAMPLE across the page and in its footer, and names no real form, agency or board", async () => {
    for (const paper of PAPERS) {
      const strings = (await drawnPages(await samplePaperPdf(paper))).flat().map((d) => d.text);
      expect(strings).toContain("SAMPLE");
      expect(strings.some((s) => s.startsWith("SAMPLE DOCUMENT made by ShipShape"))).toBe(true);
      // ACORD's name, the NAIC's codes, and California's board, classification and registrar names (review PR45-01, 03).
      expect(strings.filter((s) => /ACORD|NAIC|CSLB|C-36|Registrar of Contractors|Contractors License Board/i.test(s))).toEqual([]);
    }
  });

  it("gives a city license that runs inside one calendar year one year, not the same year twice", async () => {
    const city = (license: { from: string; to: string }) =>
      samplePaperPdf({ kind: "city-license", business, license: { ...license, account: "SAMPLE-BL-0000" } }).then(drawnPages);
    const one = (await city({ from: "2024-01-01", to: "2024-12-31" })).flat().map((d) => d.text);
    expect(one).toContain("2024");
    expect(one).not.toContain("2024 to 2024");
    expect((await city({ from: "2025-10-23", to: "2026-10-23" })).flat().map((d) => d.text)).toContain("2025 to 2026");
  });

  it("keeps every text clear of the next one on its line (a heading wider than its column ran into the next)", async () => {
    for (const paper of PAPERS) {
      const lines = new Map<number, Extract<PaperMark, { kind: "text" }>[]>();
      for (const m of texts(await samplePaperMarks(paper))) if (!m.rotate) lines.set(Math.round(m.y * 2), [...(lines.get(Math.round(m.y * 2)) ?? []), m]);
      const touching = [...lines.values()].flatMap((line) =>
        line
          .sort((a, b) => a.x - b.x)
          .flatMap((m, i) => (i > 0 && line[i - 1].x + line[i - 1].width > m.x - 0.5 ? [`${line[i - 1].text} | ${m.text}`] : [])),
      );
      expect(touching).toEqual([]);
    }
  });
});

describe("a preview and its file", () => {
  it("draws each paper's page as its PDF does: the same texts, fonts and sizes, at the same places", async () => {
    for (const paper of PAPERS) {
      const [page] = await drawnPages(await samplePaperPdf(paper));
      expectSamePage(await samplePaperMarks(paper), page);
    }
  });

  it("draws a composed document's pages as its PDF does, footer and page numbers included", async () => {
    const blocks: Block[] = [
      { type: "title", text: "Mutual Non-Disclosure Agreement" },
      { type: "para", runs: [{ text: "This " }, { text: "Cover Page", bold: true }, { text: " is drawn twice, once as a file and once as a preview." }] },
      { type: "rows", rows: [["Purpose", "Testing the preview."], ["Effective Date", "2026-09-25"]] },
      ...Array.from({ length: 24 }, (_, i): Block => ({ type: "clause", number: `${i + 1}.`, runs: [{ text: "A clause long enough to wrap onto a second line at this width, so the pages fill and break. ".repeat(2) }] })),
      { type: "stamp", text: "SAMPLE" },
    ];
    const footer = "A footer long enough to wrap, as the NDA's does: Cover Page filled with ShipShape; Standard Terms unchanged from Common Paper (CC BY 4.0).";
    const file = await drawnPages(await composePdf(blocks, { title: "t", subject: "s", footer }));
    const preview = await composeMarks(blocks, footer);
    expect(preview).toHaveLength(file.length);
    expect(file.length).toBeGreaterThan(1);
    preview.forEach((marks, i) => expectSamePage(marks, file[i]));
  });
});
