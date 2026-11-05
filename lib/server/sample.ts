import "server-only";
import { z } from "zod";
import { SAMPLE_DRAWING, samplePaper, samplePaperMarks, samplePaperPdf, type SampleBusiness, type SamplePaper } from "@/lib/pdf/sample-papers";
import type { PaperMark } from "@/lib/pdf/surface";
import type { ProfileKey } from "@/lib/profile-fields";
import { templateById } from "@/lib/templates/catalog";
import type { Facts, TemplateInfo } from "@/lib/templates/types";
import { isoToday, plusDays } from "@/lib/today";
import { seedSampleVendors } from "./collect";
import { encryptField } from "./crypto";
import { asUser, type Tx } from "./db";
import { listOutbox } from "./deadlines";
import { insertDocument, type VersionRow } from "./documents";
import { completeSigning, createSignatureRequest, sendSigningCode, type SignatureRequestRow } from "./esign";
import { fillRecord, prefill, render, sampleNdaCover } from "./fill";
import { createPassport, openPassport, passportFileUrl } from "./passport";
import { seedSamplePeople } from "./people";
import type { Ctx } from "./profile";
import { saveInTx } from "./saved";

/**
 * The sample workspace: a fictional plumbing business with made-up documents. Its EIN starts with
 * 00, a prefix the IRS never assigns, so it can't belong to anyone. Every sample PDF says SAMPLE.
 */
export const SAMPLE_EIN = "00-1234567";

const SAMPLE_FACTS: Record<ProfileKey, string> = {
  legal_name: "Harbor Plumbing LLC",
  dba: "Harbor Plumbing",
  entity_type: "llc_partnership",
  address_line1: "100 Example Street",
  address_line2: "",
  city: "Springfield",
  state: "CA",
  postal_code: "90000",
  phone: "(555) 010-0100",
  email: "office@harbor-plumbing.example",
  website: "",
  state_of_formation: "California",
  signer_name: "Alex Rivera",
  signer_title: "Managing member",
};

const FACTS: Facts = { values: SAMPLE_FACTS, ein: SAMPLE_EIN, einLast4: SAMPLE_EIN.slice(-4) };

function template(id: string): TemplateInfo {
  const t = templateById(id);
  if (!t) throw new Error(`no template ${id}`);
  return t;
}

/** The request the sample's W-9 answers, signed. */
const W9_REQUEST = { requester: "Northwind Builders (sample)", sign: "on" };

/** The sample's W-9 file: signed on `today`, or with the date left blank (""), as its preview images show it. */
export async function sampleW9Pdf(today: string): Promise<Uint8Array> {
  const t = template("irs-w9");
  return (await render(t, { ...prefill(t, FACTS, today), ...W9_REQUEST }, FACTS, today, true)).bytes;
}

/**
 * The sample W-9's first page as images in public/sample/ (spot 5b; Design, and Security P3 in 20261104-1327). The IRS
 * form isn't drawn by ShipShape's code, so the browser can't draw it again as it does the other papers. `npm run
 * sample:w9-image` makes them from `sampleW9Pdf("")`, the date left blank, since a fixed date would differ from the
 * file's: the top of the page for the document page's crop, and the whole page for its sheet. `page` is that page's
 * `pageHash`: a test checks it, so a change to the sample's facts, the IRS form or how it's filled fails until the
 * images are made again under the next `number`.
 */
export const SAMPLE_W9_IMAGES = {
  number: 1,
  page: "ec298014bb3859e669b551babe54008fa64f56a11360209c795a62ad2f4becb9",
  crop: { src: "/sample/w9-1-top.webp", width: 600, height: 480 },
  full: { src: "/sample/w9-1.webp", width: 918, height: 1188 },
};

const sampleW9 = z.object({ kind: z.literal("w9"), images: z.literal(SAMPLE_W9_IMAGES.number) });

async function filled(tx: Tx, ctx: Ctx, t: TemplateInfo, facts: Facts, overrides: Record<string, string>): Promise<string> {
  const start = prefill(t, facts, ctx.today);
  const values = { ...start, ...overrides };
  const out = await render(t, values, facts, ctx.today, true);
  // Titles built from a sample party's name already end in "(sample)".
  const title = out.title.endsWith("(sample)") ? out.title : `${out.title} (sample)`;
  return insertDocument(
    tx,
    ctx,
    { title, kind: t.kind, counterparty: out.counterparty, issued_on: out.issuedOn, expires_on: out.expiresOn, template_id: t.id },
    { bytes: out.bytes, mime: "application/pdf" },
    "sample",
    // The NDA keeps the values it was filled with, and which drawing drew it, so its preview draws its cover page from
    // them; the W-9 keeps which images show its page (spot 5b).
    {
      template: t.id,
      templateVersion: t.source.version,
      fields: fillRecord(t, values, start),
      ...(t.kind === "nda" && { paper: { kind: "nda", values }, drawn: SAMPLE_DRAWING }),
      ...(t.kind === "w9" && { paper: { kind: "w9", images: SAMPLE_W9_IMAGES.number } }),
    },
  );
}

/** Runs as the new sample workspace's owner, inside their transaction. */
export async function seedSampleWorkspace(tx: Tx, orgId: string, userId: string, today = isoToday()) {
  const ctx: Ctx = { userId, demo: true, authAt: 0, orgId, name: "Harbor Plumbing (sample)", role: "owner", today };
  // Every sample date is an offset from the visitor's own day, so Deadlines ("in 21 days") and the first
  // reminders (run on the same day) agree wherever the visitor is (W10-2).
  const day = (offset: number) => plusDays(today, offset);
  const f = SAMPLE_FACTS;
  await tx.query(
    "update app.profiles set legal_name = $2, dba = $3, entity_type = $4, address_line1 = $5, city = $6, state = $7, postal_code = $8, phone = $9, email = $10, state_of_formation = $11, signer_name = $12, signer_title = $13 where org_id = $1",
    [orgId, f.legal_name, f.dba, f.entity_type, f.address_line1, f.city, f.state, f.postal_code, f.phone, f.email, f.state_of_formation, f.signer_name, f.signer_title],
  );
  await tx.query("select app.set_tax_id($1, 'ein', $2, $3)", [orgId, encryptField(SAMPLE_EIN, orgId, "ein"), SAMPLE_EIN.slice(-4)]);
  await tx.query("select app.confirm_facts($1, $2)", [orgId, [...Object.keys(f).filter((k) => f[k as ProfileKey]), "ein"]]);

  const w9 = await filled(tx, ctx, template("irs-w9"), FACTS, W9_REQUEST);
  await filled(tx, ctx, template("common-paper-mnda"), FACTS, {
    effective_date: day(-40),
    mnda_term: "years",
    mnda_years: "1",
    conf_term: "years",
    conf_years: "2",
    governing_law: "California",
    jurisdiction: "courts located in Springfield, CA",
    p2_company: "Northwind Builders (sample)",
    p2_name: "Jordan Lee",
    p2_title: "Project manager",
    p2_notice: "contracts@northwind.example",
  });

  // Full-page papers drawn for the sample (lib/pdf/sample-papers.ts), each with the dates the documents carry. The
  // values a paper was drawn from stay with its version, so its preview is drawn from them too, never from details a
  // visitor can edit afterwards (spot 5b).
  const business: SampleBusiness = { legalName: f.legal_name, dba: f.dba, address: [f.address_line1, `${f.city}, ${f.state} ${f.postal_code}`], signer: f.signer_name };
  const papers: { title: string; kind: "coi" | "license" | "permit"; issuer: string; issued: number; expires: number; paper: SamplePaper }[] = [
    {
      title: "Certificate of liability insurance",
      kind: "coi",
      issuer: "Example Mutual Insurance (sample)",
      issued: -344,
      expires: 21,
      paper: { kind: "coi", business, dates: { issued: day(-344), from: day(-344), to: day(21) } },
    },
    {
      title: "Contractor license",
      kind: "license",
      issuer: "State licensing board (sample)",
      issued: -480,
      expires: 250,
      paper: { kind: "contractor-license", business, license: { issued: day(-480), expires: day(250), number: "SAMPLE-000000" } },
    },
    {
      title: "City business license",
      kind: "permit",
      issuer: "City of Springfield (sample)",
      issued: -377,
      expires: -12,
      paper: { kind: "city-license", business, license: { from: day(-377), to: day(-12), account: "SAMPLE-BL-0000" } },
    },
  ];
  let certificate: string | undefined;
  for (const c of papers) {
    const id = await insertDocument(
      tx,
      ctx,
      { title: `${c.title} (sample)`, kind: c.kind, issuer: c.issuer, issued_on: day(c.issued), expires_on: day(c.expires) },
      { bytes: await samplePaperPdf(c.paper), mime: "application/pdf" },
      "sample",
      { paper: c.paper, drawn: SAMPLE_DRAWING },
    );
    if (c.kind === "coi") certificate = id;
  }
  // Saved (0045): the sample owner starts with the W-9 and the insurance certificate saved, so Saved has something in it.
  await saveInTx(tx, ctx, "document", w9);
  if (certificate) await saveInTx(tx, ctx, "document", certificate);
  await seedSampleVendors(tx, ctx, day);
  // People (0046): three made-up contacts, so People has someone in it.
  await seedSamplePeople(tx, ctx);
}

const MNDA = templateById("common-paper-mnda");
/**
 * A sample NDA's kept values: the cover page is drawn from them by the template's own code, and only when every value
 * the template's form requires is there (a record of nothing would still draw a plausible cover).
 */
const sampleNda = z
  .object({ kind: z.literal("nda"), values: z.record(z.string().max(60), z.string().max(2000)) })
  .refine(
    ({ values }) =>
      MNDA !== undefined && MNDA.fields.every((f) => !f.required || (f.when !== undefined && values[f.when.key] !== f.when.equals) || Boolean(values[f.key])),
  );

/** A sample paper's first page: drawn from marks (the papers ShipShape draws), or the sample W-9's images. */
export type SamplePreview = { marks: PaperMark[] } | { images: typeof SAMPLE_W9_IMAGES };

/**
 * A sample document's first page (spot 5b), or null. Decided here, on the server: only in a sample, and only for a
 * version the sample made. A drawn paper must be drawn with today's drawing (SAMPLE_DRAWING; its values kept with it)
 * and those values must still read as a paper; the W-9 must name today's images (SAMPLE_W9_IMAGES). A signed copy
 * starts with the pages of the version that was sent (lib/pdf/to-sign.ts, then the certificate appended), so its first
 * page is that version's: the request leads back to it. Real documents never get one (their thumbnails wait for 5c);
 * no file is read either way (Security 20261104-1327). Decorative, so a failure to draw it leaves the paper card,
 * never the page broken.
 */
export async function samplePaperPreview(
  ctx: Ctx,
  versions: readonly Pick<VersionRow, "version" | "origin" | "fill_record">[],
  requests: readonly Pick<SignatureRequestRow, "version" | "signed_version">[],
): Promise<SamplePreview | null> {
  if (!ctx.demo) return null;
  const latest = versions[0];
  const sent = latest?.origin === "signed" ? requests.find((r) => r.signed_version === latest.version)?.version : undefined;
  const drawn = sent === undefined ? latest : versions.find((v) => v.version === sent);
  const record = drawn?.origin === "sample" ? drawn.fill_record : null;
  if (!record) return null;
  if (sampleW9.safeParse(record.paper).success) return { images: SAMPLE_W9_IMAGES };
  if (record.drawn !== SAMPLE_DRAWING) return null;
  try {
    const raw = record.paper;
    const paper = samplePaper.safeParse(raw);
    if (paper.success) return { marks: await samplePaperMarks(paper.data) };
    const nda = sampleNda.safeParse(raw);
    return nda.success ? { marks: await sampleNdaCover(nda.data.values) } : null;
  } catch (e) {
    console.error(`sample preview: not drawn (${e instanceof Error ? e.name : "error"})`);
    return null;
  }
}

/**
 * The sample's people and their networks: names say (sample), emails are .example, networks are documentation addresses
 * (RFC 5737). Jordan Lee is one of the sample's People; Sam Ortiz isn't yet, so the request shows "Keep in People".
 */
export const SAMPLE_ACTIVITY = {
  link: "Northwind Builders onboarding (sample)",
  visitors: ["198.51.100.7", "198.51.100.23"],
  signed: { name: "Jordan Lee (sample)", email: "jordan.lee@northwind.example", ip: "192.0.2.10" },
  waiting: { name: "Sam Ortiz (sample)", email: "sam.ortiz@northwind.example" },
} as const;

/**
 * The sample's activity (calm v2), once its workspace is committed: a passport link two people at Northwind opened (one came back) and
 * downloaded from, the NDA signed by Jordan Lee, and a request Sam Ortiz hasn't signed yet, so Sent, Signed copies,
 * History and Waiting have something real in them. Made through the same functions a workspace and its visitors use;
 * only the signing code is read from the outbox, which a sample's owner can read (0039). Each part is on its own:
 * one that fails (the PDF builder busy) is left out and logged, and the sample opens without it.
 */
export async function seedSampleActivity(orgId: string, userId: string, today = isoToday()) {
  const ctx: Ctx = { userId, demo: true, authAt: 0, orgId, name: "Harbor Plumbing (sample)", role: "owner", today };
  const docs = await asUser(userId, (tx) =>
    tx.query<{ id: string; kind: string; template_id: string | null }>("select id, kind, template_id from app.documents where org_id = $1 and status = 'active'", [orgId]),
  );
  const w9 = docs.find((d) => d.template_id === "irs-w9")?.id;
  const nda = docs.find((d) => d.template_id === "common-paper-mnda")?.id;
  const coi = docs.find((d) => d.kind === "coi")?.id;
  const license = docs.find((d) => d.kind === "license")?.id;
  const a = SAMPLE_ACTIVITY;

  const part = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      console.error(`sample activity: ${what} left out (${e instanceof Error ? e.name : "error"})`);
    }
  };

  await part("link", async () => {
    if (!w9 || !coi || !license) return;
    const link = await createPassport(ctx, { label: a.link, days: 30, documentIds: [w9, coi, license] });
    const [first, second] = a.visitors;
    await openPassport(link.id, link.token, first);
    await passportFileUrl(link.id, link.token, w9, first);
    await passportFileUrl(link.id, link.token, coi, first);
    await openPassport(link.id, link.token, second);
    await openPassport(link.id, link.token, first);
  });

  await part("waiting request", async () => {
    if (!nda) return;
    await createSignatureRequest(ctx, { documentId: nda, signerName: a.waiting.name, signerEmail: a.waiting.email, days: 14 });
  });

  await part("signed copy", async () => {
    if (!nda) return;
    const req = await createSignatureRequest(ctx, { documentId: nda, signerName: a.signed.name, signerEmail: a.signed.email, days: 14 });
    if ((await sendSigningCode(req.id, req.token)) !== "ok") throw new Error("no code");
    const message = (await listOutbox(ctx)).find((m) => m.to_email === a.signed.email);
    const code = /\bis (\d{6})\./.exec(message?.body ?? "")?.[1];
    if (!code) throw new Error("code not in the outbox");
    const signed = await completeSigning(req.id, req.token, { code, typedName: a.signed.name, consented: true, ip: a.signed.ip });
    if (signed !== "ok") throw new Error(`signing: ${signed}`);
  });
}
