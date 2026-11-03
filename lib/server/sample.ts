import "server-only";
import { samplePdf } from "@/lib/pdf/sample-pdf";
import type { ProfileKey } from "@/lib/profile-fields";
import { templateById } from "@/lib/templates/catalog";
import type { Facts, TemplateInfo } from "@/lib/templates/types";
import { isoToday, plusDays } from "@/lib/today";
import { seedSampleVendors } from "./collect";
import { encryptField } from "./crypto";
import { asUser, type Tx } from "./db";
import { listOutbox } from "./deadlines";
import { insertDocument } from "./documents";
import { completeSigning, createSignatureRequest, sendSigningCode } from "./esign";
import { fillRecord, prefill, render } from "./fill";
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
    { template: t.id, templateVersion: t.source.version, fields: fillRecord(t, values, start) },
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

  const facts: Facts = { values: f, ein: SAMPLE_EIN, einLast4: SAMPLE_EIN.slice(-4) };
  const w9 = await filled(tx, ctx, templateById("irs-w9")!, facts, { requester: "Northwind Builders (sample)", sign: "on" });
  await filled(tx, ctx, templateById("common-paper-mnda")!, facts, {
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

  const certificates: { title: string; kind: "coi" | "license" | "permit"; issuer: string; issued: number; expires: number; rows: [string, string][]; note: string }[] = [
    {
      title: "Certificate of liability insurance",
      kind: "coi",
      issuer: "Example Mutual Insurance (sample)",
      issued: -344,
      expires: 21,
      note: "A made-up insurance certificate, the kind contractors send to every new client.",
      rows: [["Insured", "Harbor Plumbing LLC"], ["Insurer", "Example Mutual Insurance (sample)"], ["Policy number", "SAMPLE-GL-0000001"], ["General liability", "$1,000,000 each occurrence"], ["Policy period", `${day(-344)} to ${day(21)}`]],
    },
    {
      title: "Contractor license",
      kind: "license",
      issuer: "State licensing board (sample)",
      issued: -480,
      expires: 250,
      note: "A made-up state contractor license.",
      rows: [["Licensee", "Harbor Plumbing LLC"], ["Classification", "Plumbing (sample)"], ["License number", "SAMPLE-000000"], ["Expires", day(250)]],
    },
    {
      title: "City business license",
      kind: "permit",
      issuer: "City of Springfield (sample)",
      issued: -377,
      expires: -12,
      note: "A made-up city business license that lapsed, to show how ShipShape flags it.",
      rows: [["Business", "Harbor Plumbing"], ["Account", "SAMPLE-BL-0000"], ["Valid through", day(-12)]],
    },
  ];
  let certificate: string | undefined;
  for (const c of certificates) {
    const id = await insertDocument(
      tx,
      ctx,
      { title: `${c.title} (sample)`, kind: c.kind, issuer: c.issuer, issued_on: day(c.issued), expires_on: day(c.expires) },
      { bytes: await samplePdf(c.title, c.rows, c.note), mime: "application/pdf" },
      "sample",
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

/** The sample's people and their networks: names say (sample), emails are .example, networks are documentation addresses (RFC 5737). */
export const SAMPLE_ACTIVITY = {
  link: "Northwind Builders onboarding (sample)",
  visitors: ["198.51.100.7", "198.51.100.23"],
  signed: { name: "Jordan Lee (sample)", email: "jordan.lee@northwind.example", ip: "192.0.2.10" },
  waiting: { name: "Dana Kim (sample)", email: "dana.kim@northwind.example" },
} as const;

/**
 * The sample's activity (calm v2), once its workspace is committed: a passport link two people at Northwind opened (one came back) and
 * downloaded from, the NDA signed by Jordan Lee, and a request Dana Kim hasn't signed yet, so Sent, Signed copies,
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
