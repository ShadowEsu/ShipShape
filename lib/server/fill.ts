import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, StandardFonts, TextAlignment, layoutMultilineText, rgb, type PDFFont } from "pdf-lib";
import { z } from "zod";
import { composePdf, inlineRuns, isPrintable, isPrintableText, type Block } from "@/lib/pdf/compose";
import { makeInert } from "@/lib/pdf/inert";
import type { EntityType, ProfileKey } from "@/lib/profile-fields";
import { isVisible as visible, NDA_DEFAULT_PURPOSE } from "@/lib/templates/catalog";
import type { Facts, FieldDef, Rendered, TemplateInfo } from "@/lib/templates/types";
import { sha256Hex } from "./crypto";

const ROOT = process.cwd();
const W9_SHA256 = "2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53";

export type Values = Record<string, string>;
export type FieldSource = "facts" | "facts_edited" | "typed" | "typed_not_saved" | "typed_saved";

const TAX_CLASS: Partial<Record<EntityType, [string, string?]>> = {
  individual: ["individual"],
  sole_prop: ["individual"],
  c_corp: ["c_corp"],
  s_corp: ["s_corp"],
  partnership: ["partnership"],
  trust: ["trust"],
  llc_c: ["llc", "C"],
  llc_s: ["llc", "S"],
  llc_partnership: ["llc", "P"],
  // llc_single and other: the owner picks the box (the IRS instructions decide, not us).
};

function factValue(fact: NonNullable<FieldDef["fact"]>, facts: Facts): string {
  const v = facts.values;
  if (fact === "ein") return facts.einLast4 ? `••-•••${facts.einLast4}` : "";
  if (fact === "address") return [v.address_line1, v.address_line2].filter(Boolean).join(", ");
  if (fact === "city_state_zip") return v.city && v.state ? `${v.city}, ${v.state} ${v.postal_code}`.trim() : "";
  if (fact === "entity_type") return TAX_CLASS[v.entity_type as EntityType]?.[0] ?? "";
  return v[fact as ProfileKey] ?? "";
}

/** Starting values: facts where a field names one, the template's own defaults otherwise; `today` is the viewer's date. */
export function prefill(t: TemplateInfo, facts: Facts, today: string): Values {
  const out: Values = {};
  for (const f of t.fields) if (f.fact) out[f.key] = factValue(f.fact, facts);
  if (t.kind === "w9") {
    out.llc_class = TAX_CLASS[facts.values.entity_type as EntityType]?.[1] ?? "";
    out.tin_kind = facts.einLast4 ? "ein" : "";
  }
  if (t.kind === "nda") {
    out.purpose = NDA_DEFAULT_PURPOSE;
    out.effective_date = today;
  }
  return out;
}

/**
 * A template's values from its posted form. Browsers send a text box's line breaks as CRLF (Security
 * R2-6); validation and the PDF fonts take "\n", so CRLF and a lone CR become "\n".
 */
export function formValues(t: TemplateInfo, data: FormData): Values {
  const out: Values = {};
  for (const f of t.fields) {
    const v = data.get(f.key);
    out[f.key] = typeof v === "string" ? v.replace(/\r\n?/g, "\n") : "";
  }
  return out;
}

/** What to do about an empty required field, by the kind of field it is. */
const MISSING: Record<FieldDef["kind"], string> = {
  text: "Fill this in.",
  textarea: "Fill this in.",
  date: "Pick a date.",
  number: "Enter a whole number from 1 to 99.",
  radio: "Choose one of the options.",
  checkbox: "Tick this box.",
  secret: "Enter the number.",
};
const SSN_FORMAT = "Enter the SSN as 9 digits, like 123-45-6789.";
export const EIN_FORMAT = "Enter your EIN as 9 digits, like 12-3456789.";

/** Nine digits of a typed tax id, or null when it isn't one (dashes and spaces allowed). */
export function taxIdDigits(value: string): string | null {
  const d = value.replace(/[\s-]/g, "");
  return /^[0-9]{9}$/.test(d) ? d : null;
}

/** The EIN that goes on the form: the saved one, else what was typed for this document. */
export function einFor(v: Values, facts: Facts): string {
  if (facts.ein) return facts.ein;
  const d = taxIdDigits(v.ein ?? "");
  return d ? `${d.slice(0, 2)}-${d.slice(2)}` : "";
}

/**
 * The fonts a form's text is measured in: Helvetica as the flattened form's fields are set in it,
 * Times-Italic as ShipShape draws a typed signature. What pdf-lib lays out with these is what the page shows.
 */
const fonts = new Map<StandardFonts, Promise<PDFFont>>();
function measuringFont(name: StandardFonts): Promise<PDFFont> {
  let font = fonts.get(name);
  if (!font) {
    font = PDFDocument.create().then((d) => d.embedStandardFont(name));
    fonts.set(name, font);
  }
  return font;
}

/**
 * Whether `value` stays inside the box `fits` describes. One line: its width at that size (a single
 * line is never wrapped, so anything wider is clipped or runs into the next box, W11-5). More lines:
 * how many pdf-lib lays it out on (the same function and bounds the field's appearance uses).
 */
async function fitsBox(value: string, fits: NonNullable<FieldDef["fits"]>): Promise<boolean> {
  const font = await measuringFont(fits.italic ? StandardFonts.TimesRomanItalic : StandardFonts.Helvetica);
  if (fits.lines === 1) return font.widthOfTextAtSize(value, fits.size) <= fits.width;
  return layoutMultilineText(value, { alignment: TextAlignment.Left, fontSize: fits.size, font, bounds: { x: 1, y: 1, width: fits.width, height: fits.size * fits.lines * 1.2 } }).lines.length <= fits.lines;
}

/** What to say when a value won't fit its box. About how many characters a line holds: mixed text averages half the size per character. */
function tooWide(fits: NonNullable<FieldDef["fits"]>): string {
  const chars = Math.floor(fits.width / (fits.size / 2));
  return fits.lines === 1
    ? `This won't fit on the form's line, which holds about ${chars} characters. Shorten it so nothing is cut off the PDF.`
    : `This won't fit in the form's box, which holds ${fits.lines} lines of about ${chars} characters. Shorten it so nothing is cut off the PDF.`;
}

export async function validate(t: TemplateInfo, v: Values, facts: Facts): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const f of t.fields) {
    if (!visible(f, v)) continue;
    const value = (v[f.key] ?? "").trim();
    if (f.kind === "secret" && f.fact === "ein") {
      // Saved in Business facts: nothing to check. Otherwise the number typed here goes on the form.
      if (!facts.ein && !taxIdDigits(value)) errors[f.key] = value ? EIN_FORMAT : "Enter your EIN, add it in Business facts first, or choose SSN.";
      continue;
    }
    if (f.required && !value) errors[f.key] = f.key === "ssn" ? SSN_FORMAT : MISSING[f.kind];
    else if (f.max && f.kind !== "number" && value.length > f.max) errors[f.key] = `Shorten this to ${f.max} characters or fewer.`;
    else if (!(f.kind === "textarea" ? isPrintableText(value) : isPrintable(value))) errors[f.key] = "Use letters, numbers and common punctuation.";
    else if (f.fits && value && !(await fitsBox(value, f.fits))) errors[f.key] = tooWide(f.fits);
    else if (f.options && value && !f.options.some((o) => o.value === value)) errors[f.key] = "Choose one of the options.";
    else if (f.kind === "date" && value && !realDate(value)) errors[f.key] = "Enter a date between 1900 and 2200.";
    else if (f.kind === "number" && value && !/^[1-9][0-9]?$/.test(value)) errors[f.key] = "Enter a whole number from 1 to 99.";
    else if (f.key === "ssn" && value && !/^[0-9]{9}$/.test(value.replace(/[\s-]/g, ""))) errors[f.key] = SSN_FORMAT;
  }
  return errors;
}

/**
 * A real calendar date in 1900-2200: the database refuses 2026-02-30, and "+N years" past 9999
 * can't be written as YYYY-MM-DD. 2200 leaves room for the longest term (99 years).
 */
const realDate = (s: string) => z.iso.date().safeParse(s).success && s >= "1900-01-01" && s <= "2200-12-31";

/** Where each field's value came from. Never the values themselves (they may be tax ids). */
export function fillRecord(t: TemplateInfo, v: Values, start: Values): Record<string, FieldSource> {
  const out: Record<string, FieldSource> = {};
  for (const f of t.fields) {
    if (!visible(f, v)) continue;
    if (f.key === "ssn") out[f.key] = "typed_not_saved";
    else if (f.fact === "ein") out[f.key] = start[f.key] ? "facts" : v.save_ein === "on" ? "typed_saved" : "typed_not_saved";
    else if (f.fact && start[f.key]) out[f.key] = (v[f.key] ?? "") === start[f.key] ? "facts" : "facts_edited";
    else if ((v[f.key] ?? "") !== "") out[f.key] = "typed";
  }
  return out;
}

const W9_FIELD = (n: string) => `topmostSubform[0].Page1[0].${n}`;
const W9_CLASS_BOX: Record<string, number> = { individual: 0, c_corp: 1, s_corp: 2, partnership: 3, trust: 4, llc: 5, other: 6 };

/** Loads the pinned official IRS PDF. */
export async function loadW9(): Promise<PDFDocument> {
  const source = await readFile(path.join(ROOT, "templates/fw9.pdf"));
  if (sha256Hex(source) !== W9_SHA256) throw new Error("The stored IRS form doesn't match the pinned official file");
  return PDFDocument.load(source);
}

/** Sets the W-9's form fields (before the form is flattened into the page). */
export function fillW9Form(doc: PDFDocument, v: Values, facts: Facts) {
  const form = doc.getForm();
  const text = (name: string, value: string) => form.getTextField(W9_FIELD(name)).setText(value);

  text("f1_01[0]", v.name);
  text("f1_02[0]", v.business_name ?? "");
  const box = W9_CLASS_BOX[v.tax_class];
  form.getCheckBox(W9_FIELD(`Boxes3a-b_ReadOrder[0].c1_1[${box}]`)).check();
  if (v.tax_class === "llc") text("Boxes3a-b_ReadOrder[0].f1_03[0]", v.llc_class);
  if (v.tax_class === "other") text("Boxes3a-b_ReadOrder[0].f1_04[0]", v.other_class);
  if (v.foreign_partners === "on") form.getCheckBox(W9_FIELD("Boxes3a-b_ReadOrder[0].c1_2[0]")).check();
  text("f1_05[0]", v.exempt_payee ?? "");
  text("f1_06[0]", v.fatca ?? "");
  text("Address_ReadOrder[0].f1_07[0]", v.address);
  text("Address_ReadOrder[0].f1_08[0]", v.city_state_zip);
  text("f1_09[0]", v.requester ?? "");
  text("f1_10[0]", v.accounts ?? "");
  if (v.tin_kind === "ssn") {
    const d = v.ssn.replace(/[\s-]/g, "");
    text("f1_11[0]", d.slice(0, 3));
    text("f1_12[0]", d.slice(3, 5));
    text("f1_13[0]", d.slice(5));
  } else {
    const d = einFor(v, facts).replace(/-/g, "");
    text("f1_14[0]", d.slice(0, 2));
    text("f1_15[0]", d.slice(2));
  }
}

async function renderW9(v: Values, facts: Facts, today: string): Promise<Rendered> {
  const doc = await loadW9();
  fillW9Form(doc, v, facts);
  const form = doc.getForm();
  const page = doc.getPage(0);
  const signed = v.sign === "on";
  if (signed) {
    const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
    const plain = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(v.signature, { x: 125, y: 196, size: 13, font: italic, color: rgb(0.05, 0.1, 0.35) });
    page.drawText(today, { x: 410, y: 197, size: 10, font: plain, color: rgb(0.05, 0.1, 0.35) });
  }
  form.flatten();
  // The IRS file carries document-level JavaScript (its own field scripts) and a usage-rights
  // signature (/Perms) that filling breaks, so Reader would warn the form was changed. Like every PDF
  // ShipShape serves, the W-9 runs nothing (W11-11).
  makeInert(doc);
  doc.catalog.delete(PDFName.of("Perms"));
  doc.setProducer("ShipShape");
  return {
    bytes: await doc.save(),
    title: `W-9 ${v.business_name || v.name}${signed ? "" : " (unsigned)"}`.slice(0, 200),
    counterparty: v.requester ? v.requester.split("\n")[0].slice(0, 200) : null,
    issuedOn: today,
    expiresOn: null,
  };
}

const plusYears = (iso: string, years: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};

async function renderNda(v: Values): Promise<Rendered> {
  const standard = await readFile(path.join(ROOT, "templates/common-paper-mnda-1.0/Mutual-NDA.md"), "utf8");
  const clauses = standard
    .split("\n")
    .filter((l) => /^\d+\.\s/.test(l))
    .map((l) => {
      const [, n, rest] = l.match(/^(\d+)\.\s+(.*)$/)!;
      return { type: "clause" as const, number: `${n}.`, runs: inlineRuns(rest) };
    });
  if (clauses.length !== 11) throw new Error("The Common Paper Standard Terms didn't parse as 11 clauses");
  const years = (n: string) => `${n} year${n === "1" ? "" : "s"}`;
  const mndaTerm = v.mnda_term === "years" ? `Expires ${years(v.mnda_years)} from Effective Date.` : "Continues until terminated in accordance with the terms of the MNDA.";
  const confTerm =
    v.conf_term === "years"
      ? `${years(v.conf_years)} from Effective Date, but in the case of trade secrets until Confidential Information is no longer considered a trade secret under applicable laws.`
      : "In perpetuity.";

  const blocks: Block[] = [
    { type: "title", text: "Mutual Non-Disclosure Agreement" },
    {
      type: "para",
      runs: inlineRuns(
        "This Mutual Non-Disclosure Agreement (the “MNDA”) consists of: (1) this Cover Page (“**Cover Page**”) and (2) the Common Paper Mutual NDA Standard Terms Version 1.0 (“**Standard Terms**”) identical to those posted at commonpaper.com/standards/mutual-nda/1.0. Any modifications of the Standard Terms should be made on the Cover Page, which will control over conflicts with the Standard Terms.",
      ),
    },
    {
      type: "rows",
      rows: [
        ["Purpose", v.purpose],
        ["Effective Date", v.effective_date],
        ["MNDA Term", mndaTerm],
        ["Term of Confidentiality", confTerm],
        ["Governing Law", v.governing_law],
        ["Jurisdiction", v.jurisdiction],
        ["MNDA Modifications", "None."],
      ],
    },
    { type: "para", runs: [{ text: "By signing this Cover Page, each party agrees to enter into this MNDA as of the Effective Date." }] },
    {
      type: "table",
      head: ["", "PARTY 1", "PARTY 2"],
      rows: [
        ["Signature", "", ""],
        ["Print Name", v.p1_name, v.p2_name],
        ["Title", v.p1_title ?? "", v.p2_title ?? ""],
        ["Company", v.p1_company, v.p2_company],
        ["Notice Address", v.p1_notice, v.p2_notice],
        ["Date", "", ""],
      ],
    },
    { type: "para", muted: true, size: 9, runs: [{ text: "Common Paper Mutual Non-Disclosure Agreement (Version 1.0) free to use under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)." }] },
    { type: "space", height: 10 },
    { type: "heading", text: "Standard Terms" },
    ...clauses,
    { type: "para", muted: true, size: 9, runs: [{ text: "Common Paper Mutual Non-Disclosure Agreement Version 1.0 (https://commonpaper.com/standards/mutual-nda/1.0/) free to use under CC BY 4.0." }] },
  ];
  const bytes = await composePdf(blocks, {
    title: `Mutual NDA: ${v.p1_company} and ${v.p2_company}`,
    subject: "Common Paper Mutual NDA Version 1.0",
    footer: "Cover Page filled with ShipShape; Standard Terms unchanged from Common Paper (CC BY 4.0). ShipShape is not a law firm.",
  });
  return {
    bytes,
    title: `Mutual NDA with ${v.p2_company}`.slice(0, 200),
    counterparty: v.p2_company,
    issuedOn: v.effective_date,
    expiresOn: v.mnda_term === "years" ? plusYears(v.effective_date, Number(v.mnda_years)) : null,
  };
}

/** `today` is the viewer's date: the W-9's certification date and issue date where the signer is. */
export function render(t: TemplateInfo, v: Values, facts: Facts, today: string): Promise<Rendered> {
  return t.kind === "w9" ? renderW9(v, facts, today) : renderNda(v);
}
