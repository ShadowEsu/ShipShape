import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sampleCertificate, sampleCityLicense, sampleContractorLicense, type SampleBusiness } from "@/lib/pdf/sample-papers";

/** Every string a generated PDF draws, in order (one per drawText). */
async function drawn(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.lookup(PDFName.of("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray().map((s) => doc.context.lookup(s)) : [contents];
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const text = Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
      for (const [, hex] of text.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) out.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return out;
}

const business: SampleBusiness = { legalName: "Harbor Plumbing LLC", dba: "Harbor Plumbing", address: ["100 Example Street", "Springfield, CA 90000"], signer: "Alex Rivera" };

describe("the sample's papers", () => {
  it("each says SAMPLE across the page and in its footer, and names no real form, agency or board", async () => {
    const papers = await Promise.all([
      sampleCertificate(business, { issued: "2025-11-25", from: "2025-11-25", to: "2026-11-25" }),
      sampleContractorLicense(business, { issued: "2025-07-12", expires: "2027-07-12", number: "SAMPLE-000000" }),
      sampleCityLicense(business, { from: "2025-10-23", to: "2026-10-23", account: "SAMPLE-BL-0000" }),
    ]);
    for (const bytes of papers) {
      const strings = await drawn(bytes);
      expect(strings).toContain("SAMPLE");
      expect(strings.some((s) => s.startsWith("SAMPLE DOCUMENT made by ShipShape"))).toBe(true);
      // ACORD's name, the NAIC's codes, and California's board, classification and registrar names (review PR45-01, 03).
      expect(strings.filter((s) => /ACORD|NAIC|CSLB|C-36|Registrar of Contractors|Contractors License Board/i.test(s))).toEqual([]);
    }
  });

  it("gives a city license that runs inside one calendar year one year, not the same year twice", async () => {
    const one = await drawn(await sampleCityLicense(business, { from: "2024-01-01", to: "2024-12-31", account: "SAMPLE-BL-0000" }));
    expect(one).toContain("2024");
    expect(one).not.toContain("2024 to 2024");
    const two = await drawn(await sampleCityLicense(business, { from: "2025-10-23", to: "2026-10-23", account: "SAMPLE-BL-0000" }));
    expect(two).toContain("2025 to 2026");
  });
});
