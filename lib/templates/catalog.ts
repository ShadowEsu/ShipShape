import type { FieldDef, TemplateInfo } from "./types";

export const NDA_DEFAULT_PURPOSE = "Evaluating whether to enter into a business relationship with the other party.";

const W9: TemplateInfo = {
  id: "irs-w9",
  title: "Form W-9",
  short: "W-9",
  kind: "w9",
  summary: "The IRS form clients and payers ask for before they pay you. ShipShape fills the official PDF from your business facts.",
  source: {
    name: "Internal Revenue Service",
    url: "https://www.irs.gov/pub/irs-pdf/fw9.pdf",
    license: "U.S. federal government work (public domain)",
    version: "Rev. March 2024",
    instructions: "https://www.irs.gov/forms-pubs/about-form-w-9",
  },
  finishNote:
    "Signing a W-9 certifies, under penalties of perjury, that the taxpayer identification number and the statements in Part II are correct. Read the certification on the form before you sign.",
  fields: [
    { section: "Who is filling it in", key: "name", label: "Line 1: Name", hint: "As shown on your income tax return.", kind: "text", required: true, max: 120, autoComplete: "organization", fact: "legal_name" },
    { section: "Who is filling it in", key: "business_name", label: "Line 2: Business name or disregarded entity name", hint: "If different from line 1.", kind: "text", max: 120, autoComplete: "organization", fact: "dba" },
    {
      section: "Federal tax classification (line 3a)",
      key: "tax_class",
      label: "Line 3a: Tax classification (check one)",
      hint: "A one-owner LLC that never chose a tax type ticks its owner's box (Individual or sole proprietor), not LLC. Your accountant can confirm.",
      kind: "radio",
      required: true,
      fact: "entity_type",
      options: [
        { value: "individual", label: "Individual/sole proprietor" },
        { value: "c_corp", label: "C corporation" },
        { value: "s_corp", label: "S corporation" },
        { value: "partnership", label: "Partnership" },
        { value: "trust", label: "Trust/estate" },
        { value: "llc", label: "LLC" },
        { value: "other", label: "Other" },
      ],
    },
    {
      section: "Federal tax classification (line 3a)",
      key: "llc_class",
      label: "LLC tax classification",
      kind: "radio",
      required: true,
      when: { key: "tax_class", equals: "llc" },
      options: [
        { value: "C", label: "C (C corporation)" },
        { value: "S", label: "S (S corporation)" },
        { value: "P", label: "P (Partnership)" },
      ],
    },
    { section: "Federal tax classification (line 3a)", key: "other_class", label: "Other (describe)", kind: "text", required: true, max: 60, when: { key: "tax_class", equals: "other" } },
    { section: "Federal tax classification (line 3a)", key: "foreign_partners", label: "Line 3b: I have foreign partners, owners or beneficiaries", hint: "Only for partnerships, trusts and estates that check it per the instructions.", kind: "checkbox" },
    { section: "Exemptions (line 4)", key: "exempt_payee", label: "Exempt payee code", hint: "Most businesses leave this blank.", kind: "text", max: 2 },
    { section: "Exemptions (line 4)", key: "fatca", label: "FATCA exemption code", hint: "Most businesses leave this blank.", kind: "text", max: 4 },
    { section: "Address", key: "address", label: "Line 5: Address", kind: "text", required: true, max: 120, autoComplete: "street-address", fact: "address" },
    { section: "Address", key: "city_state_zip", label: "Line 6: City, state and ZIP code", hint: "Like Portland, OR 97201.", kind: "text", required: true, max: 120, fact: "city_state_zip" },
    { section: "Address", key: "requester", label: "Requester's name and address", hint: "Optional. Who asked you for this W-9.", kind: "textarea", max: 160 },
    { section: "Address", key: "accounts", label: "Line 7: Account numbers", hint: "Optional.", kind: "text", max: 80 },
    {
      section: "Taxpayer identification number (Part I)",
      key: "tin_kind",
      label: "Which number goes on this form",
      kind: "radio",
      required: true,
      options: [
        { value: "ein", label: "EIN (employer identification number)" },
        { value: "ssn", label: "SSN (social security number)" },
      ],
    },
    { section: "Taxpayer identification number (Part I)", key: "ein", label: "EIN", hint: "9 digits, like 12-3456789. It's on the IRS letter that confirmed your EIN (CP 575). The full number goes only into the PDF.", kind: "secret", fact: "ein", when: { key: "tin_kind", equals: "ein" } },
    {
      section: "Taxpayer identification number (Part I)",
      key: "save_ein",
      label: "Also save it to my business facts, stored encrypted",
      hint: "Every W-9 you make after this one carries it in full. In Business facts it shows as the last 4 digits; seeing all of it needs a recent sign-in, and each look is recorded.",
      kind: "checkbox",
      when: { key: "tin_kind", equals: "ein" },
    },
    {
      section: "Taxpayer identification number (Part I)",
      key: "ssn",
      label: "SSN",
      hint: "9 digits, like 123-45-6789. Used once for this PDF and never saved in your business facts.",
      kind: "secret",
      required: true,
      max: 11,
      when: { key: "tin_kind", equals: "ssn" },
    },
    { section: "Sign (Part II)", key: "sign", label: "Sign the certification with my typed name and today's date", kind: "checkbox" },
    { section: "Sign (Part II)", key: "signature", label: "Signature (type your full name)", kind: "text", max: 80, required: true, autoComplete: "name", fact: "signer_name", when: { key: "sign", equals: "on" } },
  ],
  steps: [
    { title: "Who's filling it in", sections: ["Who is filling it in"] },
    { title: "Tax type and number", sections: ["Federal tax classification (line 3a)", "Exemptions (line 4)", "Taxpayer identification number (Part I)"] },
    { title: "Address", sections: ["Address"] },
    { title: "Sign", sections: ["Sign (Part II)"] },
  ],
};

const NDA: TemplateInfo = {
  id: "common-paper-mnda",
  title: "Mutual NDA",
  short: "NDA",
  kind: "nda",
  summary: "A mutual non-disclosure agreement written by a committee of attorneys. You fill in the Cover Page; the Standard Terms are attached word for word.",
  source: {
    name: "Common Paper Mutual NDA Standard Terms",
    url: "https://commonpaper.com/standards/mutual-nda/1.0",
    license: "CC BY 4.0",
    version: "1.0",
  },
  finishNote:
    "This creates the agreement unsigned. Both parties choose the Cover Page terms; ShipShape doesn't recommend any. You can send it for signature from the document page.",
  fields: [
    { section: "Cover Page", key: "purpose", label: "Purpose", hint: "How Confidential Information may be used.", kind: "textarea", required: true, max: 400 },
    { section: "Cover Page", key: "effective_date", label: "Effective Date", kind: "date", required: true },
    {
      section: "Cover Page",
      key: "mnda_term",
      label: "MNDA Term (the length of this MNDA)",
      kind: "radio",
      required: true,
      options: [
        { value: "years", label: "Expires a set number of years from the Effective Date" },
        { value: "until_terminated", label: "Continues until terminated under the MNDA" },
      ],
    },
    { section: "Cover Page", key: "mnda_years", label: "Years", kind: "number", required: true, max: 2, when: { key: "mnda_term", equals: "years" } },
    {
      section: "Cover Page",
      key: "conf_term",
      label: "Term of Confidentiality (how long information is protected)",
      kind: "radio",
      required: true,
      options: [
        { value: "years", label: "A set number of years from the Effective Date (trade secrets stay protected while they remain trade secrets)" },
        { value: "perpetual", label: "In perpetuity" },
      ],
    },
    { section: "Cover Page", key: "conf_years", label: "Years", kind: "number", required: true, max: 2, when: { key: "conf_term", equals: "years" } },
    { section: "Cover Page", key: "governing_law", label: "Governing Law (state)", hint: "Both parties agree on this.", kind: "text", required: true, max: 40 },
    { section: "Cover Page", key: "jurisdiction", label: "Jurisdiction", hint: "City or county and state, e.g. \"courts located in New Castle, DE\".", kind: "text", required: true, max: 80 },
    { section: "Party 1 (you)", key: "p1_company", label: "Company", kind: "text", required: true, max: 120, autoComplete: "organization", fact: "legal_name" },
    { section: "Party 1 (you)", key: "p1_name", label: "Print name", kind: "text", required: true, max: 80, autoComplete: "name", fact: "signer_name" },
    { section: "Party 1 (you)", key: "p1_title", label: "Title", kind: "text", max: 80, autoComplete: "organization-title", fact: "signer_title" },
    { section: "Party 1 (you)", key: "p1_notice", label: "Notice address (email or postal)", kind: "text", required: true, max: 160, autoComplete: "email", fact: "email" },
    { section: "Party 2", key: "p2_company", label: "Company", kind: "text", required: true, max: 120 },
    { section: "Party 2", key: "p2_name", label: "Print name", kind: "text", required: true, max: 80 },
    { section: "Party 2", key: "p2_title", label: "Title", kind: "text", max: 80 },
    { section: "Party 2", key: "p2_notice", label: "Notice address (email or postal)", kind: "text", required: true, max: 160 },
  ],
};

export const TEMPLATES: TemplateInfo[] = [W9, NDA];

export const LINK_OUTS = [
  {
    id: "yc-safe",
    title: "SAFE (Y Combinator)",
    summary: "Y Combinator publishes the SAFE and a free tool to send it. We link to the original; upload the signed copy to your documents.",
    url: "https://www.ycombinator.com/documents",
    license: "No redistribution license, so we link out",
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

/** A field is shown (and validated) only when its `when` condition holds. */
export const isVisible = (f: FieldDef, values: Record<string, string>) => !f.when || values[f.when.key] === f.when.equals;

/** The form's steps: the template's own, or one step holding every section. */
export function stepsOf(t: TemplateInfo): { title: string; sections: string[] }[] {
  return t.steps ?? [{ title: t.title, sections: [...new Set(t.fields.map((f) => f.section))] }];
}

/** The step (0-based) a field is on; the first step for anything unknown, such as the approval box. */
export function stepOf(t: TemplateInfo, key: string): number {
  const section = t.fields.find((f) => f.key === key)?.section;
  const at = stepsOf(t).findIndex((s) => section !== undefined && s.sections.includes(section));
  return at < 0 ? 0 : at;
}
