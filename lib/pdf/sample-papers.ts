import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { wrapLines } from "./compose";

/**
 * The sample workspace's papers drawn as full pages (ledger 461, weakest spot 5a): an insurance certificate, a state
 * contractor license and a city business license that read as the real thing at a glance. Each layout is ShipShape's
 * own (not a copy of any issuer's or ACORD's form), every name and number is made up, and every page says SAMPLE in
 * its watermark, its headings and its footer.
 */

export interface SampleBusiness {
  legalName: string;
  dba: string;
  /** Street, then city, state and ZIP. */
  address: [string, string];
  /** The person who signs for it. */
  signer: string;
}

const W = 612;
const H = 792;
const M = 36;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.38, 0.38, 0.38);
const RULE = rgb(0.55, 0.55, 0.55);
const TINT = rgb(0.94, 0.94, 0.92);
const WHITE = rgb(1, 1, 1);
const FOOTER = "SAMPLE DOCUMENT made by ShipShape for its demo. The business, people, numbers and issuer are fictional.";

interface Fonts {
  sans: PDFFont;
  sansBold: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
  serifItalic: PDFFont;
}

/** 2026-03-14 as 03/14/2026, the way US paperwork prints dates. */
export const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

async function paper(title: string, draw: (page: PDFPage, f: Fonts) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} (sample)`);
  doc.setProducer("ShipShape");
  doc.setCreator("ShipShape");
  const f: Fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
  const page = doc.addPage([W, H]);
  draw(page, f);
  // The watermark over everything, and the footer under it.
  const mark = "SAMPLE";
  const size = 96;
  const tw = f.sansBold.widthOfTextAtSize(mark, size);
  page.drawText(mark, { x: W / 2 - (tw / 2) * 0.72, y: H / 2 - tw * 0.36, size, font: f.sansBold, color: rgb(0.86, 0.2, 0.18), opacity: 0.1, rotate: degrees(35) });
  page.drawText(FOOTER, { x: M, y: 18, size: 7, font: f.sans, color: MUTED });
  return doc.save();
}

/** Text whose top is at `top` (PDF y grows upward; forms are drawn top-down). */
function text(page: PDFPage, s: string, x: number, top: number, size: number, font: PDFFont, color = INK) {
  page.drawText(s, { x, y: top - size * 0.8, size, font, color });
}
function centred(page: PDFPage, s: string, top: number, size: number, font: PDFFont, color = INK, cx = W / 2) {
  text(page, s, cx - font.widthOfTextAtSize(s, size) / 2, top, size, font, color);
}
/** Wrapped text from `top` down; returns the y under its last line. */
function para(page: PDFPage, s: string, x: number, top: number, width: number, size: number, font: PDFFont, color = INK, leading = 1.3) {
  let y = top;
  for (const line of wrapLines(s, font, size, width)) {
    text(page, line, x, y, size, font, color);
    y -= size * leading;
  }
  return y;
}
/** A box by its top-left corner, with a small capitals label inside its top edge. */
function box(page: PDFPage, f: Fonts, x: number, top: number, w: number, h: number, label?: string) {
  page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: INK, borderWidth: 0.6 });
  if (label) text(page, label, x + 4, top - 4, 6.5, f.sansBold, MUTED);
}
function rule(page: PDFPage, x1: number, x2: number, y: number, thickness = 0.5, color = RULE) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}
/** A band of ink across the page with white words in it. */
function band(page: PDFPage, f: Fonts, top: number, h: number, words: string, size: number, x = M, w = W - M * 2) {
  page.drawRectangle({ x, y: top - h, width: w, height: h, color: INK });
  text(page, words, x + 8, top - (h - size) / 2, size, f.sansBold, WHITE);
}
/** Lines in a box, from just under its label. */
function lines(page: PDFPage, f: Fonts, rows: string[], x: number, top: number, size = 9) {
  rows.forEach((r, i) => text(page, r, x + 8, top - 16 - i * size * 1.35, size, i === 0 ? f.sansBold : f.sans));
}

export interface CertificateDates {
  issued: string;
  /** The policy period, ISO days. */
  from: string;
  to: string;
}

/** A certificate of liability insurance: producer, insured, insurers, coverages with limits, the holder as additional insured. */
export function sampleCertificate(b: SampleBusiness, d: CertificateDates): Promise<Uint8Array> {
  return paper("Certificate of liability insurance", (page, f) => {
    const right = W - M;
    const mid = W / 2;
    band(page, f, H - M, 30, "CERTIFICATE OF LIABILITY INSURANCE", 13, M, 400);
    box(page, f, M + 404, H - M, right - (M + 404), 30, "DATE ISSUED (MM/DD/YYYY)");
    text(page, usDate(d.issued), M + 412, H - M - 15, 10, f.sansBold);
    let y = H - M - 38;
    y = para(
      page,
      "This certificate is a summary, given for information only. It doesn't change, extend or replace the coverage of the policies below, and it gives the certificate holder no rights beyond what those policies give. Where the holder is an additional insured, the policy must say so in an endorsement.",
      M,
      y,
      W - M * 2,
      7,
      f.sans,
      MUTED,
    );

    const top1 = y - 6;
    box(page, f, M, top1, mid - M, 74, "PRODUCER");
    lines(page, f, ["Example Insurance Agency (sample)", "300 Example Boulevard, Suite 4", "Springfield, CA 90000", "License 0X00000 (sample)"], M, top1);
    box(page, f, mid, top1, right - mid, 74, "CONTACT");
    lines(page, f, ["Pat Example (sample)", "Phone (555) 010-0199", "certificates@agency.example"], mid, top1);

    const top2 = top1 - 74;
    box(page, f, M, top2, mid - M, 74, "INSURED");
    lines(page, f, [b.legalName, `DBA ${b.dba}`, b.address[0], b.address[1]], M, top2);
    box(page, f, mid, top2, right - mid, 74, "INSURERS AFFORDING COVERAGE");
    for (const [i, [ltr, name, naic]] of [
      ["A", "Example Mutual Insurance (sample)", "00000"],
      ["B", "Example Casualty Company (sample)", "00001"],
    ].entries()) {
      const ry = top2 - 18 - i * 16;
      text(page, `INSURER ${ltr}`, mid + 8, ry, 7, f.sansBold, MUTED);
      text(page, name, mid + 52, ry, 9, f.sans);
      text(page, `NAIC ${naic}`, right - 8 - f.sans.widthOfTextAtSize(`NAIC ${naic}`, 8), ry, 8, f.sans, MUTED);
    }

    const top3 = top2 - 82;
    band(page, f, top3, 18, "COVERAGES", 9);
    const certNo = "CERTIFICATE NUMBER SAMPLE-0001";
    text(page, certNo, right - 8 - f.sansBold.widthOfTextAtSize(certNo, 7.5), top3 - 5.5, 7.5, f.sansBold, WHITE);
    // Letter, type, additional insured, policy number, effective, expires, limits: 540 points across.
    const cols = [20, 148, 34, 100, 54, 54, 130];
    let edge = M;
    const xs = cols.map((w) => {
      const x = edge;
      edge += w;
      return x;
    });
    const head = ["LTR", "TYPE OF INSURANCE", "ADDL INSD", "POLICY NUMBER", "EFFECTIVE", "EXPIRES", "LIMITS"];
    let ty = top3 - 18;
    page.drawRectangle({ x: M, y: ty - 16, width: W - M * 2, height: 16, color: TINT });
    head.forEach((h, i) => text(page, h, xs[i] + 3, ty - 5, 6.5, f.sansBold, MUTED));
    ty -= 16;
    const period = [usDate(d.from), usDate(d.to)];
    const rows: { ltr: string; type: string[]; addl: string; policy: string; limits: [string, string][] }[] = [
      {
        ltr: "A",
        type: ["Commercial general liability", "Occurrence"],
        addl: "Y",
        policy: "SAMPLE-GL-0000001",
        limits: [
          ["Each occurrence", "$1,000,000"],
          ["Damage to rented premises", "$100,000"],
          ["Medical expense, 1 person", "$5,000"],
          ["Personal and adv. injury", "$1,000,000"],
          ["General aggregate", "$2,000,000"],
          ["Products and comp. ops", "$2,000,000"],
        ],
      },
      { ltr: "A", type: ["Automobile liability", "Any auto"], addl: "Y", policy: "SAMPLE-AU-0000002", limits: [["Combined single limit", "$1,000,000"]] },
      { ltr: "A", type: ["Umbrella liability", "Occurrence"], addl: "", policy: "SAMPLE-UM-0000003", limits: [["Each occurrence", "$2,000,000"], ["Aggregate", "$2,000,000"]] },
      {
        ltr: "B",
        type: ["Workers' compensation and", "employers' liability"],
        addl: "",
        policy: "SAMPLE-WC-0000004",
        limits: [
          ["Statutory limits", "Yes"],
          ["Each accident", "$1,000,000"],
          ["Disease, each employee", "$1,000,000"],
          ["Disease, policy limit", "$1,000,000"],
        ],
      },
    ];
    for (const r of rows) {
      const h = Math.max(r.type.length, r.limits.length) * 10 + 8;
      const top = ty;
      text(page, r.ltr, xs[0] + 6, top - 5, 8.5, f.sansBold);
      r.type.forEach((t, i) => text(page, t, xs[1] + 3, top - 5 - i * 10, 8.5, i === 0 ? f.sansBold : f.sans));
      if (r.addl) text(page, r.addl, xs[2] + 13, top - 5, 8.5, f.sansBold);
      text(page, r.policy, xs[3] + 3, top - 5, 8, f.sans);
      text(page, period[0], xs[4] + 3, top - 5, 8, f.sans);
      text(page, period[1], xs[5] + 3, top - 5, 8, f.sans);
      r.limits.forEach(([label, value], i) => {
        text(page, label, xs[6] + 3, top - 5 - i * 10, 6.5, f.sans, MUTED);
        text(page, value, right - 4 - f.sansBold.widthOfTextAtSize(value, 7.5), top - 5 - i * 10, 7.5, f.sansBold);
      });
      ty -= h;
      rule(page, M, right, ty);
    }
    page.drawRectangle({ x: M, y: ty, width: W - M * 2, height: top3 - 18 - ty, borderColor: INK, borderWidth: 0.6 });
    for (const x of xs.slice(1)) page.drawLine({ start: { x, y: ty }, end: { x, y: top3 - 18 }, thickness: 0.4, color: RULE });

    const top4 = ty - 8;
    box(page, f, M, top4, W - M * 2, 52, "DESCRIPTION OF OPERATIONS, LOCATIONS AND VEHICLES");
    para(
      page,
      "Plumbing contractor. Northwind Builders (sample) is an additional insured on the general liability and automobile policies for the insured's work for it, as the written contract between them requires.",
      M + 8,
      top4 - 16,
      W - M * 2 - 16,
      8.5,
      f.sans,
    );

    const top5 = top4 - 60;
    box(page, f, M, top5, mid - M, 96, "CERTIFICATE HOLDER");
    lines(page, f, ["Northwind Builders (sample)", "Attn: Jordan Lee", "200 Example Avenue", "Springfield, CA 90000"], M, top5, 10);
    box(page, f, mid, top5, right - mid, 96, "CANCELLATION");
    para(page, "If any policy above is cancelled before its expiration date, notice will be delivered under the policy's own terms.", mid + 8, top5 - 16, right - mid - 16, 8, f.sans);
    rule(page, mid + 8, right - 8, top5 - 78, 0.6, INK);
    text(page, "R. Example", mid + 12, top5 - 60, 14, f.serifItalic);
    text(page, "AUTHORIZED REPRESENTATIVE (SAMPLE)", mid + 8, top5 - 82, 6.5, f.sansBold, MUTED);
  });
}

/** A seal: two rings and three lines of capitals inside. */
function seal(page: PDFPage, f: Fonts, cx: number, cy: number, words: [string, string, string]) {
  page.drawCircle({ x: cx, y: cy, size: 38, borderColor: INK, borderWidth: 1.2 });
  page.drawCircle({ x: cx, y: cy, size: 32, borderColor: INK, borderWidth: 0.5 });
  words.forEach((w, i) => centred(page, w, cy + 14 - i * 11, i === 1 ? 9 : 6.5, i === 1 ? f.serifBold : f.sansBold, INK, cx));
}

/** A field: a small capitals label over its value, with a rule under. */
function field(page: PDFPage, f: Fonts, label: string, value: string, x: number, top: number, w: number) {
  text(page, label, x, top, 6.5, f.sansBold, MUTED);
  text(page, value, x, top - 11, 11, f.serif);
  rule(page, x, x + w, top - 26);
}

/** A state contractor license, framed as the certificate that hangs in the office. */
export function sampleContractorLicense(b: SampleBusiness, d: { issued: string; expires: string; number: string }): Promise<Uint8Array> {
  return paper("Contractor license", (page, f) => {
    page.drawRectangle({ x: M - 8, y: M + 4, width: W - (M - 8) * 2, height: H - M * 2 - 4, borderColor: INK, borderWidth: 2 });
    page.drawRectangle({ x: M - 2, y: M + 10, width: W - (M - 2) * 2, height: H - M * 2 - 16, borderColor: INK, borderWidth: 0.5 });
    centred(page, "STATE CONTRACTORS LICENSE BOARD (SAMPLE)", H - 64, 10, f.sansBold);
    centred(page, "A made-up board for ShipShape's sample. No board issued this license.", H - 78, 7.5, f.sans, MUTED);
    seal(page, f, W / 2, H - 140, ["STATE OF", "EXAMPLE", "BOARD SEAL"]);
    centred(page, "Contractor License", H - 210, 34, f.serifBold);
    centred(page, "This certifies that", H - 262, 13, f.serifItalic, MUTED);
    centred(page, b.legalName.toUpperCase(), H - 284, 22, f.serifBold);
    centred(page, `doing business as ${b.dba}`, H - 312, 11, f.serifItalic, MUTED);
    centred(page, "is licensed as a contractor under the laws of this state, in the classification below,", H - 336, 11, f.serif);
    centred(page, "and may contract for that work until the date this license expires.", H - 351, 11, f.serif);

    const no = `License No. ${d.number}`;
    const nw = f.sansBold.widthOfTextAtSize(no, 15) + 32;
    page.drawRectangle({ x: W / 2 - nw / 2, y: H - 404, width: nw, height: 28, color: TINT, borderColor: INK, borderWidth: 0.6 });
    centred(page, no, H - 384, 15, f.sansBold);

    const left = 96;
    const colW = (W - left * 2 - 32) / 2;
    const second = left + colW + 32;
    const rows: [string, string, string, string][] = [
      ["CLASSIFICATION", "C-36 Plumbing (sample)", "STATUS", "Active"],
      ["ENTITY", "Limited liability company", "QUALIFIER (RMO)", b.signer],
      ["ISSUED", usDate(d.issued), "EXPIRES", usDate(d.expires)],
      ["BUSINESS ADDRESS", b.address[0], "", b.address[1]],
    ];
    rows.forEach(([l1, v1, l2, v2], i) => {
      const top = H - 436 - i * 42;
      field(page, f, l1, v1, left, top, colW);
      field(page, f, l2, v2, second, top, colW);
    });

    const sy = M + 120;
    text(page, "J. Example", left + 6, sy + 22, 18, f.serifItalic);
    rule(page, left, left + colW, sy, 0.6, INK);
    text(page, "REGISTRAR OF CONTRACTORS (SAMPLE)", left, sy - 6, 6.5, f.sansBold, MUTED);
    para(
      page,
      "Display this license where you do business. A license is personal to the licensee and can't be transferred. Anyone can check its status with the board.",
      second,
      sy + 24,
      colW,
      8,
      f.sans,
      MUTED,
    );
  });
}

/** A city business license and tax certificate, as posted at the business. */
export function sampleCityLicense(b: SampleBusiness, d: { from: string; to: string; account: string }): Promise<Uint8Array> {
  return paper("City business license", (page, f) => {
    const right = W - M;
    seal(page, f, M + 42, H - M - 42, ["CITY OF", "SPRINGFIELD", "SAMPLE"]);
    text(page, "CITY OF SPRINGFIELD (SAMPLE)", M + 96, H - M - 18, 14, f.serifBold);
    text(page, "Finance Department, Business License Division", M + 96, H - M - 36, 9.5, f.sans, MUTED);
    text(page, "400 Example Plaza, Springfield, CA 90000", M + 96, H - M - 50, 9.5, f.sans, MUTED);
    box(page, f, right - 150, H - M - 4, 150, 64);
    text(page, "ACCOUNT NUMBER", right - 142, H - M - 12, 6.5, f.sansBold, MUTED);
    text(page, d.account, right - 142, H - M - 24, 11, f.sansBold);
    text(page, "LICENSE YEAR", right - 142, H - M - 42, 6.5, f.sansBold, MUTED);
    text(page, `${d.from.slice(0, 4)} to ${d.to.slice(0, 4)}`, right - 142, H - M - 54, 11, f.sansBold);

    band(page, f, H - 130, 36, "BUSINESS LICENSE AND TAX CERTIFICATE", 15);

    const left = M + 12;
    const colW = (W - M * 2 - 24 - 32) / 2;
    const second = left + colW + 32;
    const rows: [string, string, string, string][] = [
      ["BUSINESS NAME", b.dba, "OWNER", b.legalName],
      ["BUSINESS LOCATION", b.address[0], "", b.address[1]],
      ["BUSINESS TYPE", "Plumbing contractor", "EMPLOYEES", "6"],
      ["VALID FROM", usDate(d.from), "VALID THROUGH", usDate(d.to)],
      ["TAX PAID", "$185.00 (sample)", "RECEIPT", `${d.account}-R`],
    ];
    rows.forEach(([l1, v1, l2, v2], i) => {
      const top = H - 196 - i * 44;
      field(page, f, l1, v1, left, top, colW);
      field(page, f, l2, v2, second, top, colW);
    });

    const notice = H - 196 - rows.length * 44 - 12;
    page.drawRectangle({ x: M, y: notice - 64, width: W - M * 2, height: 64, color: TINT, borderColor: INK, borderWidth: 0.6 });
    centred(page, "POST IN A CONSPICUOUS PLACE AT THE BUSINESS LOCATION", notice - 12, 10, f.sansBold);
    para(
      page,
      "This certificate shows that the business tax was paid for the period above. It isn't a permit for any work, it isn't an endorsement, and it can't be transferred to another owner or location.",
      M + 12,
      notice - 30,
      W - M * 2 - 24,
      8.5,
      f.sans,
    );

    const sy = notice - 140;
    text(page, "M. Example", left + 6, sy + 22, 18, f.serifItalic);
    rule(page, left, left + colW, sy, 0.6, INK);
    text(page, "FINANCE DIRECTOR (SAMPLE)", left, sy - 6, 6.5, f.sansBold, MUTED);

    // The tear-off stub the city keeps.
    const stub = M + 90;
    page.drawLine({ start: { x: M, y: stub }, end: { x: right, y: stub }, thickness: 0.8, color: RULE, dashArray: [4, 3] });
    text(page, "CITY COPY (SAMPLE)", M, stub - 12, 6.5, f.sansBold, MUTED);
    text(page, `${b.dba}  ·  Account ${d.account}  ·  Valid through ${usDate(d.to)}`, M, stub - 28, 9, f.sans);
  });
}
