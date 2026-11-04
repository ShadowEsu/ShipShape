import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { z } from "zod";
import { wrapLines } from "./compose";

/**
 * The sample workspace's papers drawn as full pages (ledger 461, weakest spot 5a): an insurance certificate, a state
 * contractor license and a city business license that read as the real thing at a glance. Each layout is ShipShape's
 * own (not a copy of any issuer's or ACORD's form), every name and number is made up, and every page says SAMPLE in
 * its watermark, its headings and its footer.
 *
 * One drawing, two outputs (spot 5b): the PDF the sample stores, and the preview its document page shows, drawn by the
 * same calls from the same values (kept with the version), so the preview is the file's first page without reading it.
 */

const business = z.object({
  legalName: z.string().max(200),
  dba: z.string().max(200),
  /** Street, then city, state and ZIP. */
  address: z.tuple([z.string().max(200), z.string().max(200)]),
  /** The person who signs for it. */
  signer: z.string().max(200),
});
export type SampleBusiness = z.infer<typeof business>;

/** What a sample paper is drawn from: its kind and every value it prints. */
export const samplePaper = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coi"), business, dates: z.object({ issued: z.iso.date(), from: z.iso.date(), to: z.iso.date() }) }),
  z.object({ kind: z.literal("contractor-license"), business, license: z.object({ issued: z.iso.date(), expires: z.iso.date(), number: z.string().max(40) }) }),
  z.object({ kind: z.literal("city-license"), business, license: z.object({ from: z.iso.date(), to: z.iso.date(), account: z.string().max(40) }) }),
]);
export type SamplePaper = z.infer<typeof samplePaper>;

/** The page size, in points: US Letter. */
export const PAPER = { w: 612, h: 792 };
const W = PAPER.w;
const H = PAPER.h;
const M = 36;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.38, 0.38, 0.38);
const RULE = rgb(0.55, 0.55, 0.55);
const TINT = rgb(0.94, 0.94, 0.92);
const WHITE = rgb(1, 1, 1);
const MARK = rgb(0.86, 0.2, 0.18);
const FOOTER = "SAMPLE DOCUMENT made by ShipShape for its demo. The business, people, numbers and issuer are fictional.";

export type FontKey = "sans" | "sansBold" | "serif" | "serifBold" | "serifItalic";
type Fonts = Record<FontKey, PDFFont>;

/** 2026-03-14 as 03/14/2026, the way US paperwork prints dates. */
export const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** What a paper is drawn on, in PDF points (y grows upward): a PDF page, or the preview's recorder. */
interface Surface {
  text(s: string, x: number, y: number, size: number, font: FontKey, color: RGB, turn?: { opacity: number; degrees: number }): void;
  rect(x: number, y: number, w: number, h: number, look: { fill?: RGB; stroke?: RGB; strokeWidth?: number }): void;
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, color: RGB, dash?: [number, number]): void;
  circle(cx: number, cy: number, r: number, stroke: RGB, strokeWidth: number): void;
  width(s: string, size: number, font: FontKey): number;
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifItalic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
}

function pdfSurface(page: PDFPage, f: Fonts): Surface {
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

/** One mark of a preview, in SVG units (y grows downward), with colours as hex. */
export type PaperMark =
  | { kind: "text"; text: string; x: number; y: number; size: number; font: FontKey; fill: string; opacity?: number; rotate?: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dash?: string }
  | { kind: "circle"; cx: number; cy: number; r: number; stroke: string; strokeWidth: number };

const hex = (c: RGB) => `#${[c.red, c.green, c.blue].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
/** Rounded to a hundredth of a point: the preview's size, not the PDF's precision. */
const at = (n: number) => Math.round(n * 100) / 100;

function recorder(f: Fonts, marks: PaperMark[]): Surface {
  return {
    text: (str, x, y, size, font, color, turn) =>
      marks.push({ kind: "text", text: str, x: at(x), y: at(H - y), size, font, fill: hex(color), ...(turn && { opacity: turn.opacity, rotate: turn.degrees }) }),
    rect: (x, y, width, height, look) =>
      marks.push({
        kind: "rect",
        x: at(x),
        y: at(H - y - height),
        width: at(width),
        height: at(height),
        ...(look.fill && { fill: hex(look.fill) }),
        ...(look.stroke && { stroke: hex(look.stroke), strokeWidth: look.strokeWidth ?? 1 }),
      }),
    line: (x1, y1, x2, y2, strokeWidth, color, dash) =>
      marks.push({ kind: "line", x1: at(x1), y1: at(H - y1), x2: at(x2), y2: at(H - y2), stroke: hex(color), strokeWidth, ...(dash && { dash: dash.join(" ") }) }),
    circle: (cx, cy, r, stroke, strokeWidth) => marks.push({ kind: "circle", cx: at(cx), cy: at(H - cy), r, stroke: hex(stroke), strokeWidth }),
    width: (s, size, font) => f[font].widthOfTextAtSize(s, size),
  };
}

const TITLE: Record<SamplePaper["kind"], string> = {
  coi: "Certificate of liability insurance",
  "contractor-license": "Contractor license",
  "city-license": "City business license",
};

/** The paper, then the watermark over everything and the footer under it. */
function drawPaper(s: Surface, p: SamplePaper) {
  if (p.kind === "coi") certificate(s, p.business, p.dates);
  else if (p.kind === "contractor-license") contractorLicense(s, p.business, p.license);
  else cityLicense(s, p.business, p.license);
  const mark = "SAMPLE";
  const size = 96;
  const tw = s.width(mark, size, "sansBold");
  s.text(mark, W / 2 - (tw / 2) * 0.72, H / 2 - tw * 0.36, size, "sansBold", MARK, { opacity: 0.1, degrees: 35 });
  s.text(FOOTER, M, 18, 7, "sans", MUTED);
}

/** The paper as the PDF the sample stores. */
export async function samplePaperPdf(p: SamplePaper): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${TITLE[p.kind]} (sample)`);
  doc.setProducer("ShipShape");
  doc.setCreator("ShipShape");
  drawPaper(pdfSurface(doc.addPage([W, H]), await embedFonts(doc)), p);
  return doc.save();
}

// Text widths for the preview: the same standard-font metrics the PDF lays out with. Kept for the process.
let metrics: Promise<Fonts> | undefined;

/** The paper as preview marks: the same calls as its PDF, recorded instead of drawn. */
export async function samplePaperMarks(p: SamplePaper): Promise<PaperMark[]> {
  metrics ??= PDFDocument.create().then(embedFonts);
  const marks: PaperMark[] = [];
  drawPaper(recorder(await metrics, marks), p);
  return marks;
}

/** Text whose top is at `top` (PDF y grows upward; forms are drawn top-down). */
function text(s: Surface, str: string, x: number, top: number, size: number, font: FontKey, color = INK) {
  s.text(str, x, top - size * 0.8, size, font, color);
}
function centred(s: Surface, str: string, top: number, size: number, font: FontKey, color = INK, cx = W / 2) {
  text(s, str, cx - s.width(str, size, font) / 2, top, size, font, color);
}
/** Wrapped text from `top` down; returns the y under its last line. */
function para(s: Surface, str: string, x: number, top: number, width: number, size: number, font: FontKey, color = INK, leading = 1.3) {
  let y = top;
  for (const line of wrapLines(str, { widthOfTextAtSize: (t, z) => s.width(t, z, font) }, size, width)) {
    text(s, line, x, y, size, font, color);
    y -= size * leading;
  }
  return y;
}
/** A box by its top-left corner, with a small capitals label inside its top edge. */
function box(s: Surface, x: number, top: number, w: number, h: number, label?: string) {
  s.rect(x, top - h, w, h, { stroke: INK, strokeWidth: 0.6 });
  if (label) text(s, label, x + 4, top - 4, 6.5, "sansBold", MUTED);
}
function rule(s: Surface, x1: number, x2: number, y: number, thickness = 0.5, color = RULE) {
  s.line(x1, y, x2, y, thickness, color);
}
/** A band of ink across the page with white words in it. */
function band(s: Surface, top: number, h: number, words: string, size: number, x = M, w = W - M * 2) {
  s.rect(x, top - h, w, h, { fill: INK });
  text(s, words, x + 8, top - (h - size) / 2, size, "sansBold", WHITE);
}
/** Lines in a box, from just under its label. */
function lines(s: Surface, rows: string[], x: number, top: number, size = 9) {
  rows.forEach((r, i) => text(s, r, x + 8, top - 16 - i * size * 1.35, size, i === 0 ? "sansBold" : "sans"));
}

/** A certificate of liability insurance: producer, insured, insurers, coverages with limits, the holder as additional insured. */
function certificate(s: Surface, b: SampleBusiness, d: { issued: string; from: string; to: string }) {
  const right = W - M;
  const mid = W / 2;
  band(s, H - M, 30, "CERTIFICATE OF LIABILITY INSURANCE", 13, M, 400);
  box(s, M + 404, H - M, right - (M + 404), 30, "DATE ISSUED (MM/DD/YYYY)");
  text(s, usDate(d.issued), M + 412, H - M - 15, 10, "sansBold");
  let y = H - M - 38;
  y = para(
    s,
    "This certificate is a summary, given for information only. It doesn't change, extend or replace the coverage of the policies below, and it gives the certificate holder no rights beyond what those policies give. Where the holder is an additional insured, the policy must say so in an endorsement.",
    M,
    y,
    W - M * 2,
    7,
    "sans",
    MUTED,
  );

  const top1 = y - 6;
  box(s, M, top1, mid - M, 74, "PRODUCER");
  lines(s, ["Example Insurance Agency (sample)", "300 Example Boulevard, Suite 4", "Springfield, CA 90000", "License 0X00000 (sample)"], M, top1);
  box(s, mid, top1, right - mid, 74, "CONTACT");
  lines(s, ["Pat Example (sample)", "Phone (555) 010-0199", "certificates@agency.example"], mid, top1);

  const top2 = top1 - 74;
  box(s, M, top2, mid - M, 74, "INSURED");
  lines(s, [b.legalName, `DBA ${b.dba}`, b.address[0], b.address[1]], M, top2);
  box(s, mid, top2, right - mid, 74, "INSURERS AFFORDING COVERAGE");
  for (const [i, [ltr, name, naic]] of [
    ["A", "Example Mutual Insurance (sample)", "00000"],
    ["B", "Example Casualty Company (sample)", "00001"],
  ].entries()) {
    const ry = top2 - 18 - i * 16;
    text(s, `INSURER ${ltr}`, mid + 8, ry, 7, "sansBold", MUTED);
    text(s, name, mid + 52, ry, 9, "sans");
    text(s, `NAIC ${naic}`, right - 8 - s.width(`NAIC ${naic}`, 8, "sans"), ry, 8, "sans", MUTED);
  }

  const top3 = top2 - 82;
  band(s, top3, 18, "COVERAGES", 9);
  const certNo = "CERTIFICATE NUMBER SAMPLE-0001";
  text(s, certNo, right - 8 - s.width(certNo, 7.5, "sansBold"), top3 - 5.5, 7.5, "sansBold", WHITE);
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
  s.rect(M, ty - 16, W - M * 2, 16, { fill: TINT });
  head.forEach((h, i) => text(s, h, xs[i] + 3, ty - 5, 6.5, "sansBold", MUTED));
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
    text(s, r.ltr, xs[0] + 6, top - 5, 8.5, "sansBold");
    r.type.forEach((t, i) => text(s, t, xs[1] + 3, top - 5 - i * 10, 8.5, i === 0 ? "sansBold" : "sans"));
    if (r.addl) text(s, r.addl, xs[2] + 13, top - 5, 8.5, "sansBold");
    text(s, r.policy, xs[3] + 3, top - 5, 8, "sans");
    text(s, period[0], xs[4] + 3, top - 5, 8, "sans");
    text(s, period[1], xs[5] + 3, top - 5, 8, "sans");
    r.limits.forEach(([label, value], i) => {
      text(s, label, xs[6] + 3, top - 5 - i * 10, 6.5, "sans", MUTED);
      text(s, value, right - 4 - s.width(value, 7.5, "sansBold"), top - 5 - i * 10, 7.5, "sansBold");
    });
    ty -= h;
    rule(s, M, right, ty);
  }
  s.rect(M, ty, W - M * 2, top3 - 18 - ty, { stroke: INK, strokeWidth: 0.6 });
  for (const x of xs.slice(1)) s.line(x, ty, x, top3 - 18, 0.4, RULE);

  const top4 = ty - 8;
  box(s, M, top4, W - M * 2, 52, "DESCRIPTION OF OPERATIONS, LOCATIONS AND VEHICLES");
  para(
    s,
    "Plumbing contractor. Northwind Builders (sample) is an additional insured on the general liability and automobile policies for the insured's work for it, as the written contract between them requires.",
    M + 8,
    top4 - 16,
    W - M * 2 - 16,
    8.5,
    "sans",
  );

  const top5 = top4 - 60;
  box(s, M, top5, mid - M, 96, "CERTIFICATE HOLDER");
  lines(s, ["Northwind Builders (sample)", "Attn: Jordan Lee", "200 Example Avenue", "Springfield, CA 90000"], M, top5, 10);
  box(s, mid, top5, right - mid, 96, "CANCELLATION");
  para(s, "If any policy above is cancelled before its expiration date, notice will be delivered under the policy's own terms.", mid + 8, top5 - 16, right - mid - 16, 8, "sans");
  rule(s, mid + 8, right - 8, top5 - 78, 0.6, INK);
  text(s, "R. Example", mid + 12, top5 - 60, 14, "serifItalic");
  text(s, "AUTHORIZED REPRESENTATIVE (SAMPLE)", mid + 8, top5 - 82, 6.5, "sansBold", MUTED);
}

/** A seal: two rings and three lines of capitals inside. */
function seal(s: Surface, cx: number, cy: number, words: [string, string, string]) {
  s.circle(cx, cy, 38, INK, 1.2);
  s.circle(cx, cy, 32, INK, 0.5);
  words.forEach((w, i) => centred(s, w, cy + 14 - i * 11, i === 1 ? 9 : 6.5, i === 1 ? "serifBold" : "sansBold", INK, cx));
}

/** A field: a small capitals label over its value, with a rule under. */
function field(s: Surface, label: string, value: string, x: number, top: number, w: number) {
  text(s, label, x, top, 6.5, "sansBold", MUTED);
  text(s, value, x, top - 11, 11, "serif");
  rule(s, x, x + w, top - 26);
}

/** A state contractor license, framed as the certificate that hangs in the office. */
function contractorLicense(s: Surface, b: SampleBusiness, d: { issued: string; expires: string; number: string }) {
  s.rect(M - 8, M + 4, W - (M - 8) * 2, H - M * 2 - 4, { stroke: INK, strokeWidth: 2 });
  s.rect(M - 2, M + 10, W - (M - 2) * 2, H - M * 2 - 16, { stroke: INK, strokeWidth: 0.5 });
  centred(s, "STATE CONTRACTORS LICENSE BOARD (SAMPLE)", H - 64, 10, "sansBold");
  centred(s, "A made-up board for ShipShape's sample. No board issued this license.", H - 78, 7.5, "sans", MUTED);
  seal(s, W / 2, H - 140, ["STATE OF", "EXAMPLE", "BOARD SEAL"]);
  centred(s, "Contractor License", H - 210, 34, "serifBold");
  centred(s, "This certifies that", H - 262, 13, "serifItalic", MUTED);
  centred(s, b.legalName.toUpperCase(), H - 284, 22, "serifBold");
  centred(s, `doing business as ${b.dba}`, H - 312, 11, "serifItalic", MUTED);
  centred(s, "is licensed as a contractor under the laws of this state, in the classification below,", H - 336, 11, "serif");
  centred(s, "and may contract for that work until the date this license expires.", H - 351, 11, "serif");

  const no = `License No. ${d.number}`;
  const nw = s.width(no, 15, "sansBold") + 32;
  s.rect(W / 2 - nw / 2, H - 404, nw, 28, { fill: TINT, stroke: INK, strokeWidth: 0.6 });
  centred(s, no, H - 384, 15, "sansBold");

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
    field(s, l1, v1, left, top, colW);
    field(s, l2, v2, second, top, colW);
  });

  const sy = M + 120;
  text(s, "J. Example", left + 6, sy + 22, 18, "serifItalic");
  rule(s, left, left + colW, sy, 0.6, INK);
  text(s, "REGISTRAR OF CONTRACTORS (SAMPLE)", left, sy - 6, 6.5, "sansBold", MUTED);
  para(
    s,
    "Display this license where you do business. A license is personal to the licensee and can't be transferred. Anyone can check its status with the board.",
    second,
    sy + 24,
    colW,
    8,
    "sans",
    MUTED,
  );
}

/** A city business license and tax certificate, as posted at the business. */
function cityLicense(s: Surface, b: SampleBusiness, d: { from: string; to: string; account: string }) {
  const right = W - M;
  seal(s, M + 42, H - M - 42, ["CITY OF", "SPRINGFIELD", "SAMPLE"]);
  text(s, "CITY OF SPRINGFIELD (SAMPLE)", M + 96, H - M - 18, 14, "serifBold");
  text(s, "Finance Department, Business License Division", M + 96, H - M - 36, 9.5, "sans", MUTED);
  text(s, "400 Example Plaza, Springfield, CA 90000", M + 96, H - M - 50, 9.5, "sans", MUTED);
  box(s, right - 150, H - M - 4, 150, 64);
  text(s, "ACCOUNT NUMBER", right - 142, H - M - 12, 6.5, "sansBold", MUTED);
  text(s, d.account, right - 142, H - M - 24, 11, "sansBold");
  text(s, "LICENSE YEAR", right - 142, H - M - 42, 6.5, "sansBold", MUTED);
  text(s, `${d.from.slice(0, 4)} to ${d.to.slice(0, 4)}`, right - 142, H - M - 54, 11, "sansBold");

  band(s, H - 130, 36, "BUSINESS LICENSE AND TAX CERTIFICATE", 15);

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
    field(s, l1, v1, left, top, colW);
    field(s, l2, v2, second, top, colW);
  });

  const notice = H - 196 - rows.length * 44 - 12;
  s.rect(M, notice - 64, W - M * 2, 64, { fill: TINT, stroke: INK, strokeWidth: 0.6 });
  centred(s, "POST IN A CONSPICUOUS PLACE AT THE BUSINESS LOCATION", notice - 12, 10, "sansBold");
  para(
    s,
    "This certificate shows that the business tax was paid for the period above. It isn't a permit for any work, it isn't an endorsement, and it can't be transferred to another owner or location.",
    M + 12,
    notice - 30,
    W - M * 2 - 24,
    8.5,
    "sans",
  );

  const sy = notice - 140;
  text(s, "M. Example", left + 6, sy + 22, 18, "serifItalic");
  rule(s, left, left + colW, sy, 0.6, INK);
  text(s, "FINANCE DIRECTOR (SAMPLE)", left, sy - 6, 6.5, "sansBold", MUTED);

  // The tear-off stub the city keeps.
  const stub = M + 90;
  s.line(M, stub, right, stub, 0.8, RULE, [4, 3]);
  text(s, "CITY COPY (SAMPLE)", M, stub - 12, 6.5, "sansBold", MUTED);
  text(s, `${b.dba}  ·  Account ${d.account}  ·  Valid through ${usDate(d.to)}`, M, stub - 28, 9, "sans");
}
