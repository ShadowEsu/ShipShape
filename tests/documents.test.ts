import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFPage } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { sha256Hex } from "@/lib/server/crypto";
import { asService, asUser } from "@/lib/server/db";
import { canSaveFacts, checkFill, DOCUMENT_GONE, documentsById, downloadUrl, fillTemplate, firstDocument, getDocument, listDocuments, setArchived, updateDocument, uploadDocument, uploadVersion } from "@/lib/server/documents";
import { UserError } from "@/lib/server/errors";
import { planLimit } from "@/lib/server/plans";
import { checkUpload, UploadRefused } from "@/lib/server/files";
import { fillW9Form, formValues, loadW9, prefill } from "@/lib/server/fill";
import { assertLaunchConfig, GateClosed } from "@/lib/server/flags";
import { createPassport, openPassport } from "@/lib/server/passport";
import { factsForFill, NeedsRecentSignIn, renameWorkspace, revealEin, saveEin, saveProfile, type Ctx } from "@/lib/server/profile";
import { SAMPLE_EIN, seedSampleWorkspace } from "@/lib/server/sample";
import { blobStore, localBlobStore, ObjectExists, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { templateById } from "@/lib/templates/catalog";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";

let db: TestDb;
let blobDir: string;
let sample: Ctx; // a sample workspace
let real: Ctx; // a real workspace (local development / after G3)
let other: Ctx; // someone else's real workspace

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");
const now = () => Math.floor(Date.now() / 1000);

/** The field and message of the form error a call fails with (the first zod issue, as the forms show it). */
async function refusal(call: Promise<unknown>): Promise<{ field: unknown; message: string }> {
  try {
    await call;
  } catch (e) {
    if (e instanceof z.ZodError) return { field: e.issues[0].path[0], message: e.issues[0].message };
    throw e;
  }
  throw new Error("The call was not refused.");
}

async function workspace(email: string, kind: "sample" | "real"): Promise<Ctx> {
  const userId = await db.user(email);
  if (kind === "sample") {
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    return { userId, demo: true, authAt: now(), orgId: org.id, name: "Sample", role: "owner", today: isoToday() };
  }
  const [org] = await asUser(userId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Real') as id"));
  return { userId, demo: false, authAt: now(), orgId: org.id, name: "Real", role: "owner", today: isoToday() };
}

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-blobs-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  sample = await workspace("sample@example.com", "sample");
  real = await workspace("real@example.com", "real");
  other = await workspace("other@example.com", "real");
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

describe("sample workspace", () => {
  it("has five sample documents with expired, expiring and valid dates", async () => {
    // A workspace of its own: other tests here add documents to the shared one.
    const docs = await listDocuments(await workspace("five-docs@example.com", "sample"));
    expect(docs).toHaveLength(5);
    const byKind = Object.fromEntries(docs.map((d) => [d.kind, d.validity]));
    expect(byKind).toMatchObject({ permit: "expired", coi: "expiring", license: "ok", w9: "none" });
    expect(docs.every((d) => d.latest_origin === "sample" && d.title.endsWith("(sample)"))).toBe(true);
  });

  it("can't take real data: no uploads, no business facts, no EIN", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    await expect(uploadDocument(sample, { title: "x", kind: "other" }, PDF)).rejects.toThrow(GateClosed);
    await expect(saveEin(sample, "12-3456789")).rejects.toThrow(GateClosed);
    await expect(saveProfile(sample, { ...(await factsForFill(sample)).values, legal_name: "Real Co" })).rejects.toThrow(GateClosed);
    vi.unstubAllEnvs();
  });
});

describe("real documents gate (Security G3)", () => {
  it("production refuses uploads and fills for a real workspace while SHIPSHAPE_REAL_DOCS is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    await expect(uploadDocument(real, { title: "COI", kind: "coi" }, PDF)).rejects.toThrow(GateClosed);
    await expect(fillTemplate(real, "common-paper-mnda", {}, true)).rejects.toThrow(GateClosed);
    await expect(saveEin(real, "12-3456789")).rejects.toThrow(GateClosed);
    vi.unstubAllEnvs();
  });

  it("works for a real workspace when the gate is open", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const id = await uploadDocument(real, { title: "Insurance certificate", kind: "coi", expires_on: "2027-01-31" }, PDF);
    expect(await uploadVersion(real, id, PDF)).toBe(2);
    const got = await getDocument(real, id);
    expect(got?.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(got?.audit.map((a) => a.action)).toEqual(["document.version_added", "document.version_added", "document.created"]);
    vi.unstubAllEnvs();
  });

  it("judges expiry by the person's own date: current through the last day where they are, not UTC's", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const id = await uploadDocument(real, { title: "Liability certificate", kind: "coi", expires_on: "2027-01-31" }, PDF);
    const validityOn = async (today: string) => (await getDocument({ ...real, today }, id))?.doc.validity;
    expect(await validityOn("2026-12-31")).toBe("ok");
    expect(await validityOn("2027-01-01")).toBe("expiring");
    expect(await validityOn("2027-01-31")).toBe("expiring");
    expect(await validityOn("2027-02-01")).toBe("expired");
    expect((await listDocuments({ ...real, today: "2027-02-01" })).find((d) => d.id === id)?.validity).toBe("expired");
    vi.unstubAllEnvs();
  });

  it("a stored file left behind by a lost transaction doesn't block that version number (review #7)", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const id = await uploadDocument(real, { title: "Bond", kind: "other" }, PDF);
    // As if an earlier attempt at version 2 stored its file and then failed to commit: no row, file present.
    const orphan = path.join(blobDir, real.orgId, id, "v2.pdf");
    await writeFile(orphan, "stale bytes from a lost transaction");
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await uploadVersion(real, id, PDF)).toBe(2);
    expect(warned).toHaveBeenCalledTimes(1);
    warned.mockRestore();
    expect(Buffer.from(await blobStore().get(`${real.orgId}/${id}/v2.pdf`))).toEqual(Buffer.from(PDF));
    // Untouched afterwards: a third attempt at the same path is still refused.
    await expect(blobStore().put(`${real.orgId}/${id}/v2.pdf`, PDF, "application/pdf")).rejects.toThrow(ObjectExists);
    vi.unstubAllEnvs();
  });

  // Real Postgres only: PGlite has one connection, so two uploads never overlap there.
  it.skipIf(!process.env.SHIPSHAPE_PG_TEST_URL)("people adding a version at the same moment get consecutive numbers, not an error (schema sweep row 35)", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const id = await uploadDocument(real, { title: "Permit", kind: "permit" }, PDF);
    // Opens the pool's three connections first, so the uploads below really run side by side.
    await Promise.all([1, 2, 3].map(() => asService((tx) => tx.query("select pg_sleep(0.1)"))));
    const versions: number[] = [];
    for (let round = 0; round < 3; round++) versions.push(...(await Promise.all([1, 2, 3].map(() => uploadVersion(real, id, PDF)))));
    expect(versions.sort((x, y) => x - y)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await getDocument(real, id))?.versions.map((v) => v.version)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    vi.unstubAllEnvs();
  });

  it("production with the gate open won't start without a contact address (RN-2: /privacy and Report this page need one)", () => {
    const prod = { NODE_ENV: "production", SHIPSHAPE_REAL_DOCS: "1" };
    expect(() => assertLaunchConfig(prod)).toThrow(/CONTACT_EMAIL/);
    expect(() => assertLaunchConfig({ ...prod, CONTACT_EMAIL: "not an address" })).toThrow(/CONTACT_EMAIL/);
    expect(() => assertLaunchConfig({ ...prod, CONTACT_EMAIL: "support@shipshape.example" })).not.toThrow();
    expect(() => assertLaunchConfig({ NODE_ENV: "production" })).not.toThrow(); // sample workspaces only
    expect(() => assertLaunchConfig({ NODE_ENV: "development", SHIPSHAPE_REAL_DOCS: "1" })).not.toThrow();
  });
});

describe("uploads (Security R3)", () => {
  it("accepts PDF, PNG and JPEG by their first bytes only", () => {
    expect(checkUpload(PDF)).toEqual({ ok: true, mime: "application/pdf" });
    expect(checkUpload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ ok: true, mime: "image/png" });
    expect(checkUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toEqual({ ok: true, mime: "image/jpeg" });
  });

  it("refuses everything else, empty and oversized files, and PDFs that launch programs or embed files", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(checkUpload(enc("<svg onload=alert(1)>")).ok).toBe(false);
    expect(checkUpload(enc("<html><script>x</script>")).ok).toBe(false);
    expect(checkUpload(new Uint8Array([0x50, 0x4b, 0x03, 0x04])).ok).toBe(false); // .docx / zip
    expect(checkUpload(new Uint8Array()).ok).toBe(false);
    expect(checkUpload(new Uint8Array(10 * 1024 * 1024 + 1).fill(0x25)).ok).toBe(false);
    expect(checkUpload(enc("%PDF-1.7 /OpenAction << /S /Launch /F (calc.exe) >>")).ok).toBe(false);
    expect(checkUpload(enc("%PDF-1.7 /Names << /EmbeddedFiles 5 0 R >>")).ok).toBe(false);
  });
});

describe("downloads (Security R2)", () => {
  it("mints a short signed link only for someone in the workspace", async () => {
    const [doc] = await listDocuments(sample);
    const url = await downloadUrl(sample, doc.id, 1, "download");
    const q = new URL(url, "http://x").searchParams;
    const ok = verifyFileParams(q);
    expect(ok?.objectPath.startsWith(`${sample.orgId}/${doc.id}/`)).toBe(true);
    expect(Number(q.get("e")) - now()).toBeLessThanOrEqual(300);
    await expect(downloadUrl(other, doc.id, 1, "download")).rejects.toThrow(UserError);
    // A mangled link (/app/documents/<id>/file?v=) is "not found" (the route's 404), not a database error.
    await expect(downloadUrl(sample, "not-a-document", 1, "download")).rejects.toThrow(UserError);
    for (const v of [2 ** 31, 1e20, Number.MAX_SAFE_INTEGER]) await expect(downloadUrl(sample, doc.id, v, "download")).rejects.toThrow(UserError);
    const audit = (await getDocument(sample, doc.id))!.audit.map((a) => a.action);
    expect(audit[0]).toBe("document.downloaded");
  });

  it("rejects a changed path, a changed signature and an expired link", async () => {
    const [doc] = await listDocuments(sample);
    const q = new URL(await downloadUrl(sample, doc.id, 1, "view"), "http://x").searchParams;
    const swapped = new URLSearchParams(q);
    swapped.set("p", `${other.orgId}/${doc.id}/v1.pdf`);
    expect(verifyFileParams(swapped)).toBeNull();
    const badSig = new URLSearchParams(q);
    badSig.set("s", "A".repeat(43));
    expect(verifyFileParams(badSig)).toBeNull();
    expect(verifyFileParams(q, Date.now() + 301_000)).toBeNull();
    const traversal = new URLSearchParams(q);
    traversal.set("p", "../../etc/passwd");
    expect(verifyFileParams(traversal)).toBeNull();
  });

  it("files the person uploaded never open inline", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const id = await uploadDocument(real, { title: "Upload", kind: "other" }, PDF);
    const q = new URL(await downloadUrl(real, id, 1, "view"), "http://x").searchParams;
    expect(q.get("i")).toBe("0");
    vi.unstubAllEnvs();
  });
});

describe("W-9 fill", () => {
  it("puts the business facts and the full EIN into the official form's fields", async () => {
    const t = templateById("irs-w9")!;
    const facts = await factsForFill(sample);
    expect(facts.ein).toBe(SAMPLE_EIN);
    const values = { ...prefill(t, facts, sample.today), sign: "", signature: "" };
    expect(values).toMatchObject({ name: "Harbor Plumbing LLC", tax_class: "llc", llc_class: "P", tin_kind: "ein", ein: "••-•••4567" });
    const doc = await loadW9();
    fillW9Form(doc, values, facts);
    const field = (n: string) => doc.getForm().getTextField(`topmostSubform[0].Page1[0].${n}`).getText();
    expect(field("f1_01[0]")).toBe("Harbor Plumbing LLC");
    expect(field("Boxes3a-b_ReadOrder[0].f1_03[0]")).toBe("P");
    expect(field("Address_ReadOrder[0].f1_08[0]")).toBe("Springfield, CA 90000");
    expect(`${field("f1_14[0]")}-${field("f1_15[0]")}`).toBe(SAMPLE_EIN);
    expect(field("f1_11[0]") ?? "").toBe("");
  });

  it("needs the acknowledgment, records where each value came from, and never stores tax ids", async () => {
    const t = templateById("irs-w9")!;
    const facts = await factsForFill(sample);
    const values = { ...prefill(t, facts, sample.today), tin_kind: "ssn", ssn: "900-12-3456", sign: "on", signature: "Alex Rivera" };
    const refused = await fillTemplate(sample, t.id, values, false);
    expect(refused).toEqual({ ok: false, errors: { _ack: expect.any(String) } });

    const made = await fillTemplate(sample, t.id, values, true);
    expect(made.ok).toBe(true);
    const id = made.ok ? made.id : "";
    const got = await getDocument(sample, id);
    const record = got!.versions[0].fill_record!;
    expect(record.fields).toMatchObject({ name: "facts", ssn: "typed_not_saved", tax_class: "facts" });
    expect(record.fields).not.toHaveProperty("ein");
    const everything = JSON.stringify(await db.root((tx) => tx.query("select * from app.document_versions v join app.documents d on d.id = v.document_id join app.profiles p on p.org_id = d.org_id")));
    for (const secret of ["900123456", "900-12-3456", "12-3456", "1234567"]) expect(everything).not.toContain(secret);
    expect(got!.audit.map((a) => a.action)).toContain("document.acknowledged");
  });

  it("dates a signed W-9 and a new NDA on the signer's own day, not UTC's", async () => {
    const t = templateById("irs-w9")!;
    const facts = await factsForFill(sample);
    const evening = { ...sample, today: "2031-02-03" };
    const values = { ...prefill(t, facts, evening.today), tin_kind: "ssn", ssn: "900-12-3456", sign: "on", signature: "Alex Rivera" };
    const made = await fillTemplate(evening, t.id, values, true);
    expect((await getDocument(sample, made.ok ? made.id : ""))?.doc.issued_on).toBe("2031-02-03");
    expect(prefill(templateById("common-paper-mnda")!, facts, "2031-02-03").effective_date).toBe("2031-02-03");
  });

  it("reports missing and invalid fields instead of making a document", async () => {
    const res = await fillTemplate(sample, "irs-w9", { name: "", tax_class: "nope", tin_kind: "ssn", ssn: "12" }, true);
    expect(res.ok).toBe(false);
    expect(res.ok ? {} : res.errors).toMatchObject({ name: "Fill this in.", tax_class: "Choose one of the options.", ssn: "Enter the SSN as 9 digits, like 123-45-6789." });
  });

  it("says what to do about each kind of missing or over-long field", async () => {
    const t = templateById("common-paper-mnda")!;
    const values = { ...prefill(t, await factsForFill(sample), sample.today), effective_date: "", mnda_term: "years", mnda_years: "", conf_term: "", p2_company: "x".repeat(121) };
    const res = await fillTemplate(sample, t.id, values, true);
    expect(res.ok ? {} : res.errors).toMatchObject({
      effective_date: "Pick a date.",
      mnda_years: "Enter a whole number from 1 to 99.",
      conf_term: "Choose one of the options.",
      governing_law: "Fill this in.",
      p2_company: "Shorten this to 120 characters or fewer.",
    });
  });

  it("checks a W-9 for the review step without making or saving anything", async () => {
    const t = templateById("irs-w9")!;
    const ctx = await workspace("review-step@example.com", "sample");
    const before = (await listDocuments(ctx)).length;
    const good = { ...prefill(t, await factsForFill(ctx), ctx.today), tin_kind: "ssn", ssn: "900-12-3456" };
    expect(await checkFill(ctx, t.id, good)).toEqual({});
    expect(await checkFill(ctx, t.id, { ...good, ssn: "12" })).toEqual({ ssn: "Enter the SSN as 9 digits, like 123-45-6789." });
    expect(await listDocuments(ctx)).toHaveLength(before);
  });

  it("with no EIN saved, the one typed into the form goes on the W-9; 'also save it' puts it in Business facts first", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const t = templateById("irs-w9")!;
    const ctx = await workspace("typed-ein@example.com", "real");
    const base = { name: "Typed EIN Co", tax_class: "c_corp", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ein" };
    // Nothing typed and nothing saved: the field says what to do. A short number: the format line.
    expect(await checkFill(ctx, t.id, { ...base, ein: "" })).toEqual({ ein: "Enter your EIN, add it in Business facts first, or choose SSN." });
    expect(await checkFill(ctx, t.id, { ...base, ein: "12" })).toEqual({ ein: "Enter your EIN as 9 digits, like 12-3456789." });

    // Typed, not saved: the form fields carry it, the record says so, and Business facts still have none.
    const facts = await factsForFill(ctx);
    const doc = await loadW9();
    fillW9Form(doc, { ...base, ein: "98 7654321" }, facts);
    const field = (n: string) => doc.getForm().getTextField(`topmostSubform[0].Page1[0].${n}`).getText();
    expect([field("f1_14[0]"), field("f1_15[0]")]).toEqual(["98", "7654321"]);
    const made = await fillTemplate(ctx, t.id, { ...base, ein: "98 7654321" }, true);
    expect(made.ok).toBe(true);
    const got = await getDocument(ctx, made.ok ? made.id : "");
    expect(got?.versions[0].fill_record?.fields).toMatchObject({ ein: "typed_not_saved" });
    expect((await factsForFill(ctx)).ein).toBeNull();

    // Typed with "also save it": Business facts get it (encrypted; last 4 in clear), and the record says saved.
    const saved = await fillTemplate(ctx, t.id, { ...base, ein: "98-7654321", save_ein: "on" }, true);
    expect(saved.ok).toBe(true);
    expect((await getDocument(ctx, saved.ok ? saved.id : ""))?.versions[0].fill_record?.fields).toMatchObject({ ein: "typed_saved" });
    expect(await factsForFill(ctx)).toMatchObject({ ein: "98-7654321", einLast4: "4321" });
    // From now on the saved one wins, whatever the form posts for `ein`.
    expect(await checkFill(ctx, t.id, { ...base, ein: "" })).toEqual({});
    vi.unstubAllEnvs();
  });

  it("'also save it' is refused as a field error, not a database error, for a member, a sample workspace or a closed gate", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const t = templateById("irs-w9")!;
    const ctx = await workspace("save-ein-owner@example.com", "real");
    const memberId = await db.user("save-ein-member@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [ctx.orgId, memberId]));
    const member: Ctx = { ...ctx, userId: memberId, role: "member" };
    const values = { name: "Member Co", tax_class: "c_corp", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ein", ein: "98-7654321", save_ein: "on" };

    const before = (await listDocuments(ctx)).length;
    const refused = await fillTemplate(member, t.id, values, true);
    expect(refused).toEqual({ ok: false, errors: { save_ein: "Only owners and admins can save business facts. Untick this, or ask one of them to add the EIN." } });
    expect(await listDocuments(ctx)).toHaveLength(before);
    expect((await factsForFill(ctx)).ein).toBeNull();
    // Without the box the member makes the W-9 with the typed number, like anyone else.
    expect((await fillTemplate(member, t.id, { ...values, save_ein: "" }, true)).ok).toBe(true);
    expect((await factsForFill(ctx)).ein).toBeNull();

    // The sample workspace already holds an EIN, so the box never applies there; canSaveFacts still says no.
    expect(await checkFill(sample, t.id, { ...values, name: "Harbor Plumbing LLC" })).toEqual({});
    expect(canSaveFacts(ctx)).toBe(true);
    expect(canSaveFacts(member)).toBe(false);
    expect(canSaveFacts(sample)).toBe(false);
    // With real documents closed, an owner can still fill (local development) but not save facts.
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    expect(canSaveFacts(ctx)).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("Mutual NDA fill", () => {
  const typed = {
    effective_date: "2026-11-01",
    mnda_term: "years",
    mnda_years: "2",
    conf_term: "perpetual",
    governing_law: "California",
    jurisdiction: "courts located in Springfield, CA",
    p2_company: "Acme Sample Co",
    p2_name: "Sam Example",
    p2_notice: "legal@acme.example",
  };

  it("makes an NDA whose MNDA Term sets the expiry date", async () => {
    const t = templateById("common-paper-mnda")!;
    const values = {
      ...prefill(t, await factsForFill(sample), sample.today),
      ...typed,
      purpose: "Evaluating a partnership.\nNothing else.", // a text box may hold line breaks
    };
    // A one-line field may not (Security F4-1).
    const refused = await fillTemplate(sample, t.id, { ...values, p2_company: "Acme\nSample Co" }, true);
    expect(refused.ok ? {} : refused.errors).toEqual({ p2_company: "Use letters, numbers and common punctuation." });
    const made = await fillTemplate(sample, t.id, values, true);
    expect(made.ok).toBe(true);
    const doc = (await getDocument(sample, made.ok ? made.id : ""))!.doc;
    expect(doc).toMatchObject({ kind: "nda", counterparty: "Acme Sample Co", issued_on: "2026-11-01", expires_on: "2028-11-01" });
  });

  it("refuses an Effective Date that isn't a real day or is outside 1900-2200, which would have failed in the database (schema sweep row 29-30)", async () => {
    const t = templateById("common-paper-mnda")!;
    const values = { ...prefill(t, await factsForFill(sample), sample.today), ...typed };
    for (const bad of ["2026-02-30", "2026-13-01", "0000-01-01", "1899-12-31", "9999-12-31", "2026-1-1"]) {
      const res = await fillTemplate(sample, t.id, { ...values, effective_date: bad }, true);
      expect(res.ok ? {} : res.errors, bad).toEqual({ effective_date: "Enter a date between 1900 and 2200." });
    }
    for (const ok of ["1900-01-01", "2200-12-31", "2024-02-29"]) {
      const res = await fillTemplate(sample, t.id, { ...values, effective_date: ok }, true);
      expect(res.ok, ok).toBe(true);
    }
  });

  it("takes a text box's line breaks as browsers post them (CRLF) and draws each line on its own (Security R2-6)", async () => {
    const t = templateById("common-paper-mnda")!;
    const data = new FormData();
    const posted = { ...prefill(t, await factsForFill(sample), sample.today), ...typed, purpose: "Firstline of it.\r\nSecondline of it.\rThirdline of it." };
    for (const [k, v] of Object.entries(posted)) data.set(k, v);
    const values = formValues(t, data);
    expect(values.purpose).toBe("Firstline of it.\nSecondline of it.\nThirdline of it.");
    const drawn = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const made = await fillTemplate(sample, t.id, values, true);
      expect(made.ok ? {} : made.errors).toEqual({});
      const at = (word: string) => drawn.mock.calls.find(([text]) => text === word)?.[1];
      const [first, second, third] = ["Firstline", "Secondline", "Thirdline"].map(at);
      expect(first?.x).toBeDefined();
      expect([second?.x, third?.x]).toEqual([first?.x, first?.x]);
      expect(first?.y).toBeGreaterThan(second?.y ?? Infinity);
      expect(second?.y).toBeGreaterThan(third?.y ?? Infinity);
      expect(drawn.mock.calls.some(([text]) => text.includes("\r"))).toBe(false);
    } finally {
      drawn.mockRestore();
    }
  });
});

describe("plan-limit messages", () => {
  const on = () => {
    vi.stubEnv("STRIPE_SECRET_KEY", `sk_test_${"a".repeat(24)}`);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_testsecret123");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_Pro1");
    vi.stubEnv("SHIPSHAPE_APP_URL", "http://127.0.0.1:3917");
  };
  const owner = { role: "owner", demo: false } as const;

  it("offer 'move to Pro' only to someone who can take that path: payments on, the workspace's owner, not the sample", () => {
    // Payments off: the fix alone.
    expect(planLimit(owner, "documents")).toMatchObject({ message: "The Free plan holds 10 active documents.", fix: { href: "/app/documents", label: "Choose one to archive" } });
    expect(planLimit(owner, "passports").message).toBe("The Free plan has 1 passport link open at a time. Turn one off to make room.");
    on();
    expect(planLimit(owner, "documents").message).toBe("The Free plan holds 10 active documents. Or move to Pro for no limit.");
    expect(planLimit(owner, "passports").message).toBe("The Free plan has 1 passport link open at a time. Turn one off, or move to Pro for more.");
    // An admin or member can't change the plan (canPay), so they aren't offered it; nor is the sample workspace.
    expect(planLimit({ role: "admin", demo: false }, "documents").message).toBe("The Free plan holds 10 active documents.");
    expect(planLimit({ role: "member", demo: false }, "passports").message).toBe("The Free plan has 1 passport link open at a time. Turn one off to make room.");
    expect(planLimit({ role: "owner", demo: true }, "documents").message).toBe("The Free plan holds 10 active documents.");
    // Signing is a fact about the plan, not an offer: the same words either way.
    expect(planLimit(owner, "esign").message).toBe("Asking for signatures is part of Pro.");
    expect(planLimit(owner, "esign").fix).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("business facts", () => {
  it("saves facts and the EIN for a real workspace, masks it, and reveals it only after a recent sign-in", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const facts = await factsForFill(real);
    await saveProfile(real, { ...facts.values, legal_name: "Real Co LLC", entity_type: "c_corp" });
    await saveEin(real, "00 7654321");
    const [p] = await db.root((tx) => tx.query<{ ein_cipher: string; ein_last4: string }>("select ein_cipher, ein_last4 from app.profiles where org_id = $1", [real.orgId]));
    expect(p.ein_last4).toBe("4321");
    expect(p.ein_cipher).not.toContain("7654321");
    await expect(revealEin({ ...real, authAt: now() - 3600 })).rejects.toThrow(NeedsRecentSignIn);
    // The sample's made-up EIN shows an hour into the sample too: its visitor has no password to re-enter (review #19).
    expect(await revealEin({ ...sample, authAt: now() - 3600 })).toBe(SAMPLE_EIN);
    expect(await revealEin(real)).toBe("00-7654321");
    const [a] = await db.root((tx) => tx.query<{ n: number }>("select count(*)::int as n from app.audit_log where org_id = $1 and action = 'profile.tax_id_revealed'", [real.orgId]));
    expect(a.n).toBe(1);
    await expect(saveEin(real, "12-345")).rejects.toThrow();
    vi.unstubAllEnvs();
  });

  it("someone else can't read another workspace's facts", async () => {
    const theirs = await factsForFill({ ...other, orgId: real.orgId });
    expect(theirs.values.legal_name).toBe("");
    expect(theirs.ein).toBeNull();
  });

  it("says how to enter a refused fact or EIN, and which field it is", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const facts = (await factsForFill(real)).values;
    await expect(saveEin(real, "12-345")).rejects.toThrow("Enter the EIN as 9 digits, like 12-3456789.");
    expect(await refusal(saveProfile(real, { ...facts, legal_name: "x".repeat(121) }))).toEqual({ field: "legal_name", message: "Shorten this to 120 characters or fewer." });
    expect(await refusal(saveProfile(real, { ...facts, entity_type: "spaceship" }))).toEqual({ field: "entity_type", message: "Choose a business type from the list." });
    vi.unstubAllEnvs();
  });
});

describe("single reads for pages that don't need the whole list (review #24)", () => {
  it("documentsById returns the asked-for active documents of this workspace only: not others', not archived, not unknown ids", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("byid@example.com", "real");
    const other = await workspace("byid-other@example.com", "real");
    const a = await uploadDocument(ctx, { title: "A", kind: "coi" }, PDF);
    const b = await uploadDocument(ctx, { title: "B", kind: "coi" }, PDF);
    const c = await uploadDocument(ctx, { title: "C", kind: "coi" }, PDF);
    await setArchived(ctx, c, true);
    const theirs = await uploadDocument(other, { title: "Theirs", kind: "coi" }, PDF);
    const got = await documentsById(ctx, [a, c, theirs, "00000000-0000-0000-0000-000000000000"]);
    expect(got.map((d) => d.title).sort()).toEqual(["A"]);
    expect((await documentsById(ctx, [a, b])).map((d) => d.title).sort()).toEqual(["A", "B"]);
    expect(await documentsById(ctx, [])).toEqual([]);
  });

  it("firstDocument is the first in the list's order (soonest to run out, then newest), or null", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("first@example.com", "real");
    expect(await firstDocument(ctx)).toBeNull();
    // The soonest is uploaded first, so the newest document alone would be the wrong answer.
    const soon = await uploadDocument(ctx, { title: "Soonest", kind: "coi", expires_on: "2030-01-01" }, PDF);
    await uploadDocument(ctx, { title: "Undated", kind: "coi" }, PDF);
    expect(await firstDocument(ctx)).toEqual({ id: soon, title: "Soonest" });
  });
});

describe("workspace name", () => {
  const renames = async (orgId: string) =>
    db.root((tx) =>
      tx.query<{ actor: string; detail_sha256: string | null }>(
        "select actor, detail_sha256 from app.audit_log where org_id = $1 and action = 'workspace.renamed' order by seq",
        [orgId],
      ),
    );
  // The history detail is SHA-256 of [old, new] as Postgres writes a JSON array (Security, 0026).
  const renamed = (from: string, to: string) => sha256Hex(`[${JSON.stringify(from)}, ${JSON.stringify(to)}]`);

  it("is what people opening a passport link see; an owner renames it and the rename is in the history", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("rename@example.com", "real");
    const docId = await uploadDocument(ctx, { title: "W-9", kind: "w9" }, PDF);
    const { id, token } = await createPassport(ctx, { label: "For Northwind", days: 7, documentIds: [docId] });
    await renameWorkspace(ctx, "  Harbor Supply Co  ");
    expect((await openPassport(id, token, "203.0.113.9"))?.orgName).toBe("Harbor Supply Co");
    expect(await renames(ctx.orgId)).toEqual([{ actor: ctx.userId, detail_sha256: renamed("Real", "Harbor Supply Co") }]);
    await renameWorkspace(ctx, "Harbor Supply Co"); // the same name again isn't a change
    expect(await renames(ctx.orgId)).toHaveLength(1);
    await renameWorkspace(ctx, 'Harbor "HSC" Co'); // quotes are escaped, so the pair stays unambiguous
    expect((await renames(ctx.orgId))[1].detail_sha256).toBe(renamed("Harbor Supply Co", 'Harbor "HSC" Co'));
    const [chain] = await asUser(ctx.userId, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1) as broken", [ctx.orgId]));
    expect(chain.broken).toBeNull();
    vi.unstubAllEnvs();
  });

  it("can't be changed by a member, in a sample workspace, or to an empty, multi-line, overlong, ShipShape or address name (RN-2, RN-3)", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("rename-owner@example.com", "real");
    const memberId = await db.user("rename-member@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [ctx.orgId, memberId]));
    await expect(renameWorkspace({ ...ctx, userId: memberId, role: "member" }, "Taken Over")).rejects.toBeInstanceOf(UserError);
    await expect(renameWorkspace(sample, "Real Co")).rejects.toBeInstanceOf(GateClosed);
    const lookalikes = ["ShipShape Support", "Ship-Shape Co", "Ship.Shape", "ShipShapeSupport", "MyShipShape", "ShipShapes", "Acme https://acme.example", "help@acme.example"];
    for (const bad of ["   ", "Harbor\nSupply", "x".repeat(121), 42, ...lookalikes]) {
      await expect(renameWorkspace(ctx, bad)).rejects.toBeInstanceOf(UserError);
    }
    const names = await db.root((tx) => tx.query<{ name: string }>("select name from app.organizations where id = any($1)", [[ctx.orgId, sample.orgId]]));
    expect(names.map((n) => n.name).sort()).toEqual(["Real", "Sample"]);
    expect(await renames(ctx.orgId)).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("may contain 'ship' and 'shape' inside other words", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("relationship@example.com", "real");
    expect(await renameWorkspace(ctx, "Relationship Shaper Co")).toBe("Relationship Shaper Co");
    expect(await renameWorkspace(ctx, "Friendship Shapes")).toBe("Friendship Shapes");
    vi.unstubAllEnvs();
  });
});

describe("document details", () => {
  it("saves real calendar dates and refuses ISO-shaped ones the database can't store, as a form error", async () => {
    const [doc] = await listDocuments(sample);
    await updateDocument(sample, doc.id, { title: "Lease", kind: "agreement", issued_on: "2024-02-29", expires_on: "9999-12-31" });
    expect((await getDocument(sample, doc.id))?.doc).toMatchObject({ title: "Lease", issued_on: "2024-02-29", expires_on: "9999-12-31" });
    for (const bad of ["0000-01-01", "2026-02-29"]) {
      await expect(updateDocument(sample, doc.id, { title: "Lease", kind: "agreement", expires_on: bad })).rejects.toThrow(z.ZodError);
    }
    expect((await getDocument(sample, doc.id))?.doc.expires_on).toBe("9999-12-31");
  });

  it("keeps a title to one line of text in any language; a line break, control or reordering character is a form error", async () => {
    const [doc] = await listDocuments(sample);
    await updateDocument(sample, doc.id, { title: "Bail commercial – Société Générale 東京", kind: "agreement" });
    // Line breaks and controls, the Unicode line/paragraph separators, and bidi overrides/isolates (Security N-88a).
    for (const bad of ["Lease\nAddendum", "Lease\u0000", "Lease\tA", "Lease\u0085", "Lease\u2028A", "Lease\u2029A", "Invoice\u202Efdp.exe", "A\u2066B\u2069"]) {
      await expect(updateDocument(sample, doc.id, { title: bad, kind: "agreement" })).rejects.toThrow(z.ZodError);
    }
    expect((await getDocument(sample, doc.id))?.doc.title).toBe("Bail commercial – Société Générale 東京");
  });

  it("search ignores control characters instead of failing", async () => {
    const [doc] = await listDocuments(sample);
    await updateDocument(sample, doc.id, { title: "Umbrella liability policy", kind: "other" });
    expect((await listDocuments(sample, { q: "umbrella" })).map((d) => d.id)).toEqual([doc.id]);
    expect((await listDocuments(sample, { q: "umbrella\u0000" })).map((d) => d.id)).toEqual([doc.id]);
  });

  it("only changes documents in the workspace you're working in, even one you also belong to", async () => {
    const mine = await workspace("two-workspaces@example.com", "sample");
    const [second] = await asUser(mine.userId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Second') as id"));
    const inSecond: Ctx = { ...mine, demo: false, orgId: second.id, name: "Second" };
    const [doc] = await listDocuments(mine);
    await expect(updateDocument(inSecond, doc.id, { title: "Moved?", kind: "other" })).rejects.toThrow(
      new UserError("This document isn't in this workspace any more. Go to Documents to see what's there."),
    );
    await expect(setArchived(inSecond, doc.id, true)).rejects.toThrow(new UserError(DOCUMENT_GONE));
    const after = (await getDocument(mine, doc.id))?.doc;
    expect(after).toMatchObject({ title: doc.title, kind: doc.kind, status: "active" });
  });

  it("names the field and the fix for each detail a form refuses", async () => {
    const [doc] = await listDocuments(sample);
    const lease = { title: "Lease", kind: "agreement" };
    expect(await refusal(updateDocument(sample, doc.id, { ...lease, title: "  " }))).toEqual({ field: "title", message: "Give the document a title, like “General liability certificate 2026”." });
    expect(await refusal(updateDocument(sample, doc.id, { ...lease, expires_on: "2026-02-30" }))).toEqual({ field: "expires_on", message: "Enter a real date." });
    expect(await refusal(updateDocument(sample, doc.id, { ...lease, kind: "spaceship" }))).toEqual({ field: "kind", message: "Choose a kind from the list." });
    expect(await refusal(updateDocument(sample, doc.id, { ...lease, issuer: "x".repeat(201) }))).toEqual({ field: "issuer", message: "Shorten this to 200 characters or fewer." });
  });

  it("refuses a file that isn't a PDF, PNG or JPEG with what to do instead", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const gif = new TextEncoder().encode("GIF89a");
    const refused = uploadDocument(real, { title: "Scan", kind: "other" }, gif);
    await expect(refused).rejects.toBeInstanceOf(UploadRefused);
    await expect(refused).rejects.toThrow("That file isn't a PDF, PNG or JPEG. Save it as a PDF and choose it again.");
    vi.unstubAllEnvs();
  });
});
