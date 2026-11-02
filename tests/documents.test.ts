import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPage, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { sha256Hex } from "@/lib/server/crypto";
import { asService, asUser } from "@/lib/server/db";
import { canSaveFacts, checkFill, DOCUMENT_GONE, documentsById, downloadUrl, fillTemplate, firstDocument, getDocument, listDocuments, sampleIsFull, setArchived, updateDocument, uploadDocument, uploadVersion } from "@/lib/server/documents";
import { PlanLimit, UserError } from "@/lib/server/errors";
import { FILES_FULL, FILL_BUSY, SAMPLE_DOCUMENTS, SAMPLE_FULL, UPLOAD_BUSY } from "@/lib/server/limits";
import { planLimit } from "@/lib/server/plans";
import { checkUpload, UploadRefused } from "@/lib/server/files";
import { fillW9Form, formValues, loadW9, prefill, render } from "@/lib/server/fill";
import { GateClosed } from "@/lib/server/flags";
import { assertLaunchConfig, launchProblems } from "@/lib/server/launch-check";
import { createPassport, openPassport } from "@/lib/server/passport";
import { factsForFill, NeedsRecentSignIn, renameWorkspace, revealEin, saveEin, saveProfile, type Ctx } from "@/lib/server/profile";
import { SAMPLE_EIN, seedSampleWorkspace } from "@/lib/server/sample";
import { blobStore, localBlobStore, ObjectExists, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { templateById } from "@/lib/templates/catalog";
import { isoToday } from "@/lib/today";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limit";
import { freshDb, type TestDb } from "./support/db";
import { fillBucket } from "./support/rate";

/** The baselines (Tm y) of the W-9 requester box's text, from its appearance XObject (186.2 × 38 pt) in a flattened document. */
function requesterBaselines(doc: PDFDocument): number[] {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    const bbox = obj.dict.get(PDFName.of("BBox"))?.toString() ?? "";
    if (!/186\.2 37\.99/.test(bbox)) continue;
    const raw = obj instanceof PDFRawStream ? obj.contents : obj.getContents();
    const flate = obj.dict.get(PDFName.of("Filter"))?.toString().includes("FlateDecode");
    const text = (flate ? inflateSync(raw) : Buffer.from(raw)).toString("latin1");
    const ys = [...text.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    if (ys.length) return ys;
  }
  return [];
}

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
    await expect(fillTemplate(real, "common-paper-mnda", {}, true, "192.0.2.10")).rejects.toThrow(GateClosed);
    await expect(saveEin(real, "12-3456789")).rejects.toThrow(GateClosed);
    vi.unstubAllEnvs();
  });

  it("works for a real workspace when the gate is open", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const id = await uploadDocument(real, { title: "Insurance certificate", kind: "coi", expires_on: "2027-01-31" }, PDF);
    expect(await uploadVersion(real, id, PDF)).toEqual({ version: 2, withdrawn: [] });
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
    expect((await uploadVersion(real, id, PDF)).version).toBe(2);
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
    for (let round = 0; round < 3; round++) versions.push(...(await Promise.all([1, 2, 3].map(async () => (await uploadVersion(real, id, PDF)).version))));
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

  it("a production deployment won't serve with a secret or setting missing, and names what, never the value (W12-2)", () => {
    const full = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      SHIPSHAPE_SESSION_SECRET: "s".repeat(32),
      SHIPSHAPE_HASH_KEY: "h".repeat(32),
      SHIPSHAPE_FIELD_KEY: Buffer.alloc(32, 7).toString("base64"),
      CRON_SECRET: "c".repeat(32),
      DATABASE_URL: "postgres://shipshape_app@db.example:5432/shipshape",
      DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----",
      SHIPSHAPE_APP_URL: "https://shipshape.example",
      SHIPSHAPE_S3_BUCKET: "shipshape-files",
      AWS_REGION: "us-east-1",
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/shipshape-prod-app",
      CONTACT_EMAIL: "support@shipshape.example",
    };
    expect(launchProblems(full)).toEqual([]);
    // Previews run production builds without AWS by design; only Vercel's production is held to all of it.
    expect(launchProblems({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toEqual([]);
    const secret = "a-secret-value-too-short";
    const broken = launchProblems({
      ...full,
      SHIPSHAPE_HASH_KEY: secret,
      SHIPSHAPE_FIELD_KEY: "AAAA",
      CRON_SECRET: undefined,
      DATABASE_URL: "",
      DATABASE_CA_CERT: undefined,
      SHIPSHAPE_APP_URL: "http://shipshape.example",
      SHIPSHAPE_S3_BUCKET: undefined,
    });
    expect(broken).toEqual([
      "SHIPSHAPE_HASH_KEY must be at least 32 characters",
      "SHIPSHAPE_FIELD_KEY must be 32 bytes, base64",
      "CRON_SECRET must be at least 32 characters",
      "DATABASE_URL is not set",
      "DATABASE_CA_CERT is not set",
      "SHIPSHAPE_APP_URL must be an https:// URL",
      "Production storage needs SHIPSHAPE_S3_BUCKET (not configured)",
    ]);
    expect(broken.join(" ")).not.toContain(secret);
    expect(launchProblems({ ...full, AWS_ROLE_ARN: undefined })).toEqual(["Production S3 storage needs AWS_ROLE_ARN"]);
    // The waitlist is open and /privacy tells people to write to come off it, so production needs the address before real documents too (W13-9), named once.
    expect(launchProblems({ ...full, CONTACT_EMAIL: undefined })).toEqual(["CONTACT_EMAIL is not set: /privacy tells people to write to it"]);
    expect(launchProblems({ ...full, CONTACT_EMAIL: "not an address", SHIPSHAPE_REAL_DOCS: "1" })).toEqual([
      "Production with real documents needs CONTACT_EMAIL (not configured)",
      "Real documents need account sign-in (COGNITO_*)",
    ]);
    // Account sign-in: half set up is refused; real documents need it set up.
    expect(launchProblems({ ...full, COGNITO_DOMAIN: "https://auth.shipshape.example" })).toEqual([
      "Account sign-in needs COGNITO_DOMAIN, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET and SHIPSHAPE_APP_URL",
    ]);
    expect(launchProblems({ ...full, SHIPSHAPE_REAL_DOCS: "1", CONTACT_EMAIL: "support@shipshape.example" })).toEqual(["Real documents need account sign-in (COGNITO_*)"]);
    expect(() => assertLaunchConfig({ ...full, SHIPSHAPE_SESSION_SECRET: undefined })).toThrow(
      "ShipShape isn't configured for this deployment: SHIPSHAPE_SESSION_SECRET must be at least 32 characters",
    );
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
    const over = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    over.set(enc("%PDF-1.7"));
    expect(checkUpload(over)).toEqual({ ok: false, error: "That file is over 4 MB. Choose a smaller file, or save it as a smaller PDF." });
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

  it("refuses a requester that falls out of the form's box (3 lines at 9 pt); what it accepts lands inside the box on the flattened page (wave 8 #1)", async () => {
    const t = templateById("irs-w9")!;
    const facts = await factsForFill(sample);
    const base = { ...prefill(t, facts, sample.today), sign: "", signature: "" };
    const tooMany = "Northwind Traders\nAttn: Accounts Payable\n4500 SE Hawthorne Blvd\nPortland, OR 97215";
    // Three typed lines, the first long enough to wrap: four on the form.
    const wraps = "Northwind Traders Accounts Payable Department\n4500 Southeast Hawthorne Blvd\nPortland, OR 97215";
    const fits = "Northwind Traders, Accounts Payable\n4500 SE Hawthorne Blvd, Suite 210\nPortland, OR 97215";
    for (const requester of [tooMany, wraps]) {
      const refused = await fillTemplate(sample, t.id, { ...base, requester }, true, "192.0.2.10");
      expect(refused).toEqual({ ok: false, errors: { requester: "This won't fit in the form's box, which holds 3 lines of about 40 characters. Shorten it so nothing is cut off the PDF." } });
    }
    expect(await checkFill(sample, t.id, { ...base, requester: fits })).toEqual({});
    // The flattened page draws the box's text as an XObject clipped at y = 1: every baseline must sit above that.
    const { bytes } = await render(t, { ...base, requester: fits }, facts, sample.today, sample.demo);
    const baselines = requesterBaselines(await PDFDocument.load(bytes));
    expect(baselines).toHaveLength(3);
    for (const y of baselines) expect(y).toBeGreaterThan(1);
    const doc = await loadW9();
    fillW9Form(doc, { ...base, requester: tooMany }, facts);
    doc.getForm().flatten();
    expect(requesterBaselines(doc).some((y) => y < 1)).toBe(true); // the fourth line would be below the box: why it's refused
  });

  it("refuses a one-line field wider than its line on the form, and a typed signature that would run into the Date label (W11-5)", async () => {
    const t = templateById("irs-w9");
    if (!t) throw new Error("the W-9 template is missing");
    const base = { ...prefill(t, await factsForFill(sample), sample.today), tin_kind: "ein", sign: "on", signature: "Alex Rivera" };
    // Helvetica's W is 0.944 em: 60 at 9 pt are 509.8 pt of the 515.4 the name line holds, 61 are 518.3.
    expect(await checkFill(sample, t.id, { ...base, name: "W".repeat(60) })).toEqual({});
    expect(await checkFill(sample, t.id, { ...base, name: "W".repeat(61) })).toEqual({
      name: "This won't fit on the form's line, which holds about 114 characters. Shorten it so nothing is cut off the PDF.",
    });
    // Times-Italic's A is 0.611 em: 32 at 13 pt are 254.2 pt, 33 are 262.1, past the 255 before the Date label.
    expect(await checkFill(sample, t.id, { ...base, signature: "A".repeat(32) })).toEqual({});
    expect(await checkFill(sample, t.id, { ...base, signature: "A".repeat(33) })).toEqual({
      signature: "This signature won't fit on the form's line, which holds about 39 characters. Shorten it so it doesn't run into the date.",
    });
  });

  it("needs the acknowledgment, records where each value came from, and never stores tax ids", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const t = templateById("irs-w9")!;
    const facts = await factsForFill(real);
    const values = { ...prefill(t, facts, real.today), name: "Typed SSN Co", tax_class: "individual", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ssn", ssn: "900-12-3456", sign: "on", signature: "Alex Rivera" };
    const refused = await fillTemplate(real, t.id, values, false, "192.0.2.10");
    expect(refused).toEqual({ ok: false, errors: { _ack: expect.any(String) } });

    const made = await fillTemplate(real, t.id, values, true, "192.0.2.10");
    expect(made.ok).toBe(true);
    const id = made.ok ? made.id : "";
    const got = await getDocument(real, id);
    const record = got!.versions[0].fill_record!;
    expect(record.fields).toMatchObject({ name: "typed", ssn: "typed_not_saved", tax_class: "typed" });
    expect(record.fields).not.toHaveProperty("ein");
    const everything = JSON.stringify(await db.root((tx) => tx.query("select * from app.document_versions v join app.documents d on d.id = v.document_id join app.profiles p on p.org_id = d.org_id")));
    for (const secret of ["900123456", "900-12-3456", "12-3456", "1234567"]) expect(everything).not.toContain(secret);
    expect(got!.audit.map((a) => a.action)).toContain("document.acknowledged");
    vi.unstubAllEnvs();
  });

  it("a sample never takes a real SSN, and every PDF made in a sample says SAMPLE on every page (W14-2)", async () => {
    const stamped = async (bytes: Uint8Array) => {
      const doc = await PDFDocument.load(bytes);
      return doc.getPages().map((page) => {
        const contents = page.node.Contents();
        const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
        return refs.some((ref) => {
          const s = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
          if (!(s instanceof PDFStream)) return false;
          const raw = s instanceof PDFRawStream ? s.contents : s.getContents();
          const flate = s.dict.get(PDFName.of("Filter"))?.toString().includes("FlateDecode");
          return (flate ? inflateSync(raw) : Buffer.from(raw)).toString("latin1").includes("<53414D504C45> Tj");
        });
      });
    };
    const ctx = await workspace("sample-ssn@example.com", "sample");
    const t = templateById("irs-w9")!;
    const base = { ...prefill(t, await factsForFill(ctx), ctx.today), sign: "on", signature: "Alex Rivera" };
    const before = (await listDocuments(ctx)).length;
    const sampleSsn = "This sample uses its made-up EIN, so choose EIN. Your own SSN can go in once real accounts open.";
    expect(await checkFill(ctx, t.id, { ...base, tin_kind: "ssn", ssn: "900-12-3456" })).toEqual({ ssn: sampleSsn });
    expect(await fillTemplate(ctx, t.id, { ...base, tin_kind: "ssn", ssn: "900-12-3456" }, true, "192.0.2.10")).toEqual({ ok: false, errors: { ssn: sampleSsn } });
    expect(await listDocuments(ctx)).toHaveLength(before);

    const w9 = await fillTemplate(ctx, t.id, { ...base, tin_kind: "ein" }, true, "192.0.2.10");
    const w9Bytes = await blobStore().get(`${ctx.orgId}/${w9.ok ? w9.id : ""}/v1.pdf`);
    expect(await stamped(w9Bytes)).toEqual(Array(6).fill(true));
    const nda = templateById("common-paper-mnda");
    if (!nda) throw new Error("the NDA template is missing");
    const ndaValues = { mnda_term: "until_terminated", conf_term: "perpetual", governing_law: "California", jurisdiction: "San Francisco, CA", p2_company: "Northwind", p2_name: "Jordan Lee", p2_notice: "legal@northwind.example" };
    const ndaMade = await fillTemplate(ctx, nda.id, { ...prefill(nda, await factsForFill(ctx), ctx.today), ...ndaValues }, true, "192.0.2.10");
    expect(ndaMade.ok ? [] : ndaMade.errors).toEqual([]);
    const pages = await stamped(await blobStore().get(`${ctx.orgId}/${ndaMade.ok ? ndaMade.id : ""}/v1.pdf`));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(Boolean)).toBe(true);
    // The W-9 the sample starts with is stamped too.
    const seeded = (await listDocuments(ctx)).find((d) => d.template_id === "irs-w9" && d.id !== (w9.ok ? w9.id : ""));
    expect(await stamped(await blobStore().get(`${ctx.orgId}/${seeded?.id}/v1.pdf`))).toEqual(Array(6).fill(true));

    // A real workspace's W-9 isn't.
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const own = await fillTemplate(real, t.id, { name: "Unstamped Co", tax_class: "c_corp", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ein", ein: "98-7654321", sign: "", signature: "" }, true, "192.0.2.10");
    expect((await stamped(await blobStore().get(`${real.orgId}/${own.ok ? own.id : ""}/v1.pdf`))).some(Boolean)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("makes a filled W-9 that runs nothing: the IRS file's scripts, triggers and usage-rights signature are gone, the form is drawn in (W11-11)", async () => {
    const t = templateById("irs-w9");
    if (!t) throw new Error("the W-9 template is missing");
    const values = { ...prefill(t, await factsForFill(sample), sample.today), tin_kind: "ein", sign: "on", signature: "Alex Rivera" };
    const made = await fillTemplate(sample, t.id, values, true, "192.0.2.10");
    const id = made.ok ? made.id : "";
    const w9 = await PDFDocument.load(await blobStore().get(`${sample.orgId}/${id}/v1.pdf`));
    const found: string[] = [];
    for (const [, obj] of w9.context.enumerateIndirectObjects()) {
      const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
      if (!dict) continue;
      for (const key of ["JS", "AA", "OpenAction"]) if (dict.has(PDFName.of(key))) found.push(key);
      if (dict.get(PDFName.of("S")) === PDFName.of("JavaScript")) found.push("JavaScript action");
    }
    expect(found).toEqual([]);
    expect(w9.catalog.has(PDFName.of("Perms"))).toBe(false);
    expect(w9.getForm().getFields()).toEqual([]);
    expect(w9.getPageCount()).toBeGreaterThan(0);
  });

  it("dates a signed W-9 and a new NDA on the signer's own day, not UTC's", async () => {
    const t = templateById("irs-w9")!;
    const facts = await factsForFill(sample);
    const evening = { ...sample, today: "2031-02-03" };
    const values = { ...prefill(t, facts, evening.today), tin_kind: "ein", sign: "on", signature: "Alex Rivera" };
    const made = await fillTemplate(evening, t.id, values, true, "192.0.2.10");
    expect((await getDocument(sample, made.ok ? made.id : ""))?.doc.issued_on).toBe("2031-02-03");
    expect(prefill(templateById("common-paper-mnda")!, facts, "2031-02-03").effective_date).toBe("2031-02-03");
  });

  it("reports missing and invalid fields instead of making a document", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const res = await fillTemplate(real, "irs-w9", { name: "", tax_class: "nope", tin_kind: "ssn", ssn: "12" }, true, "192.0.2.10");
    expect(res.ok).toBe(false);
    expect(res.ok ? {} : res.errors).toMatchObject({ name: "Fill this in.", tax_class: "Choose one of the options.", ssn: "Enter the SSN as 9 digits, like 123-45-6789." });
    vi.unstubAllEnvs();
  });

  it("says what to do about each kind of missing or over-long field", async () => {
    const t = templateById("common-paper-mnda")!;
    const values = { ...prefill(t, await factsForFill(sample), sample.today), effective_date: "", mnda_term: "years", mnda_years: "", conf_term: "", p2_company: "x".repeat(121) };
    const res = await fillTemplate(sample, t.id, values, true, "192.0.2.10");
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
    const good = { ...prefill(t, await factsForFill(ctx), ctx.today), tin_kind: "ein" };
    expect(await checkFill(ctx, t.id, good)).toEqual({});
    expect(await checkFill(ctx, t.id, { ...good, name: "" })).toEqual({ name: "Fill this in." });
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
    const made = await fillTemplate(ctx, t.id, { ...base, ein: "98 7654321" }, true, "192.0.2.10");
    expect(made.ok).toBe(true);
    const got = await getDocument(ctx, made.ok ? made.id : "");
    expect(got?.versions[0].fill_record?.fields).toMatchObject({ ein: "typed_not_saved" });
    expect((await factsForFill(ctx)).ein).toBeNull();

    // Typed with "also save it": Business facts get it (encrypted; last 4 in clear), and the record says saved.
    const saved = await fillTemplate(ctx, t.id, { ...base, ein: "98-7654321", save_ein: "on" }, true, "192.0.2.10");
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
    const refused = await fillTemplate(member, t.id, values, true, "192.0.2.10");
    expect(refused).toEqual({ ok: false, errors: { save_ein: "Only owners and admins can save business facts. Untick this, or ask one of them to add the EIN." } });
    expect(await listDocuments(ctx)).toHaveLength(before);
    expect((await factsForFill(ctx)).ein).toBeNull();
    // Without the box the member makes the W-9 with the typed number, like anyone else.
    expect((await fillTemplate(member, t.id, { ...values, save_ein: "" }, true, "192.0.2.10")).ok).toBe(true);
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
    const refused = await fillTemplate(sample, t.id, { ...values, p2_company: "Acme\nSample Co" }, true, "192.0.2.10");
    expect(refused.ok ? {} : refused.errors).toEqual({ p2_company: "Use letters, numbers and common punctuation." });
    const made = await fillTemplate(sample, t.id, values, true, "192.0.2.10");
    expect(made.ok).toBe(true);
    const doc = (await getDocument(sample, made.ok ? made.id : ""))!.doc;
    expect(doc).toMatchObject({ kind: "nda", counterparty: "Acme Sample Co", issued_on: "2026-11-01", expires_on: "2028-11-01" });
  });

  it("refuses an Effective Date that isn't a real day or is outside 1900-2200, which would have failed in the database (schema sweep row 29-30)", async () => {
    const t = templateById("common-paper-mnda")!;
    const values = { ...prefill(t, await factsForFill(sample), sample.today), ...typed };
    for (const bad of ["2026-02-30", "2026-13-01", "0000-01-01", "1899-12-31", "9999-12-31", "2026-1-1"]) {
      const res = await fillTemplate(sample, t.id, { ...values, effective_date: bad }, true, "192.0.2.10");
      expect(res.ok ? {} : res.errors, bad).toEqual({ effective_date: "Enter a date between 1900 and 2200." });
    }
    for (const ok of ["1900-01-01", "2200-12-31", "2024-02-29"]) {
      const res = await fillTemplate(sample, t.id, { ...values, effective_date: ok }, true, "192.0.2.10");
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
      const made = await fillTemplate(sample, t.id, values, true, "192.0.2.10");
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

describe("hourly limits and a sample's size (W15-2)", () => {
  const found = templateById("irs-w9");
  if (!found) throw new Error("the W-9 template is missing");
  const w9 = found;
  const w9Values = async (ctx: Ctx) => ({ ...prefill(w9, await factsForFill(ctx), ctx.today), sign: "on", signature: "Alex Rivera", tin_kind: "ein" });

  it("W15-2 fill: past 30 approvals in an hour a person is refused before anything is made; checks and other people go on", async () => {
    const busy = await workspace("fill-busy@example.com", "sample");
    await fillBucket(db, "fill", busy.userId, 30, 3600);
    const values = await w9Values(busy);
    const before = (await listDocuments(busy)).length;
    await expect(fillTemplate(busy, w9.id, values, true, "192.0.2.40")).rejects.toThrow(new UserError(FILL_BUSY));
    expect(FILL_BUSY).toBe("That's the hourly limit for new documents. Nothing was made; try again in an hour.");
    expect(await listDocuments(busy)).toHaveLength(before);
    // The review step and a refused approval are never counted or stopped: only a document that would be made.
    expect(await checkFill(busy, w9.id, values)).toEqual({});
    expect(await fillTemplate(busy, w9.id, values, false, "192.0.2.40")).toEqual({ ok: false, errors: { _ack: expect.any(String) } });
    // Someone else on the same network isn't affected.
    const next = await workspace("fill-next@example.com", "sample");
    expect((await fillTemplate(next, w9.id, await w9Values(next), true, "192.0.2.40")).ok).toBe(true);
  });

  it("W15-2 fill-net: past 60 approvals in an hour from one network, a new person there is refused too; another network isn't", async () => {
    await fillBucket(db, "fill-net", "192.0.2.41", 60, 3600);
    const ctx = await workspace("fill-net@example.com", "sample");
    const values = await w9Values(ctx);
    await expect(fillTemplate(ctx, w9.id, values, true, "192.0.2.41")).rejects.toThrow(new UserError(FILL_BUSY));
    expect((await fillTemplate(ctx, w9.id, values, true, "192.0.2.42")).ok).toBe(true);
  });

  it("W15-2 sample cap: a sample holds 30 documents in all, archived ones count, restoring one still works, and the Make page knows", async () => {
    const ctx = await workspace("sample-full@example.com", "sample");
    // Seeding made its five without tripping the cap.
    expect(await listDocuments(ctx)).toHaveLength(5);
    expect(await sampleIsFull(ctx)).toBe(false);
    // 24 more, half of them archived: 29 in all, only 17 active.
    await db.root((tx) =>
      tx.query(
        "insert into app.documents (org_id, title, kind, status, created_by) select $1, 'Filler ' || g, 'other', case when g % 2 = 0 then 'archived' else 'active' end, $2 from generate_series(1, 24) g",
        [ctx.orgId, ctx.userId],
      ),
    );
    const values = await w9Values(ctx);
    expect((await fillTemplate(ctx, w9.id, values, true, "192.0.2.43")).ok).toBe(true);
    expect(await sampleIsFull(ctx)).toBe(true);
    const active = (await listDocuments(ctx)).length;
    expect(active).toBeLessThan(SAMPLE_DOCUMENTS);
    await expect(fillTemplate(ctx, w9.id, values, true, "192.0.2.43")).rejects.toThrow(new PlanLimit(SAMPLE_FULL));
    expect(SAMPLE_FULL).toBe("This sample is full: it holds up to 30 documents, archived ones included. To try more, start a new sample from the sign-in page.");
    expect(await listDocuments(ctx)).toHaveLength(active);
    // Bringing an archived one back adds nothing stored, so it isn't refused.
    const [archived] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and status = 'archived' limit 1", [ctx.orgId]));
    await setArchived(ctx, archived.id, false);
    expect(await listDocuments(ctx)).toHaveLength(active + 1);
    // A real workspace is never a "full sample".
    expect(await sampleIsFull(real)).toBe(false);
  });
});

describe("Free's file total and the upload limit (W15-3)", () => {
  const QUOTA = 100 * 1024 * 1024;
  const MAX_ROW = 10 * 1024 * 1024; // the largest size_bytes a version row takes

  it("W15-3 quota: Free holds 100 MB of files in all, archived documents included; up to the line passes, past it is refused; Pro has no total", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("free-files@example.com", "real");
    const id = await uploadDocument(ctx, { title: "Lease", kind: "agreement" }, PDF);
    // Earlier versions bring the total to one PDF short of the line: nine at the row maximum, and the rest.
    await db.root((tx) =>
      tx.query(
        "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin) select $1, g, $2, $5 || g || '.pdf', 'application/pdf', case when g < 11 then $3::int else $4::int end, repeat('a', 64), 'upload' from generate_series(2, 11) g",
        [id, ctx.orgId, MAX_ROW, QUOTA - 9 * MAX_ROW - 2 * PDF.length, `${ctx.orgId}/${id}/v`],
      ),
    );
    // One byte past the line: refused (Security INFO-A1, the boundary to the byte).
    const v11 = (delta: number) =>
      db.root((tx) => tx.query("update app.document_versions set size_bytes = size_bytes + $3 where document_id = $1 and org_id = $2 and version = 11", [id, ctx.orgId, delta]));
    await v11(1);
    await expect(uploadVersion(ctx, id, PDF)).rejects.toThrow(new PlanLimit(FILES_FULL));
    await v11(-1);
    // Exactly at the line: stored.
    expect((await uploadVersion(ctx, id, PDF)).version).toBe(12);
    // One more PDF goes past it: refused, nothing stored.
    await expect(uploadVersion(ctx, id, PDF)).rejects.toThrow(new PlanLimit(FILES_FULL));
    expect(FILES_FULL).toBe("The Free plan holds 100 MB of files, and this would go past it. Archived files still count.");
    expect((await getDocument(ctx, id))?.versions).toHaveLength(12);
    // Archiving makes no room: its versions still count.
    await setArchived(ctx, id, true);
    await expect(uploadDocument(ctx, { title: "COI", kind: "coi" }, PDF)).rejects.toThrow(new PlanLimit(FILES_FULL));
    // Pro: no total.
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_W15files', 'active', 'pro')", [ctx.orgId]));
    await uploadDocument(ctx, { title: "COI", kind: "coi" }, PDF);
    vi.unstubAllEnvs();
  });

  it("W15-3 upload limit: past 60 uploads in an hour, a new document and a new version are refused; someone else goes on", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("upload-busy@example.com", "real");
    const id = await uploadDocument(ctx, { title: "Lease", kind: "agreement" }, PDF);
    await fillBucket(db, "upload", ctx.userId, 60, 3600);
    await expect(uploadDocument(ctx, { title: "COI", kind: "coi" }, PDF)).rejects.toThrow(new UserError(UPLOAD_BUSY));
    await expect(uploadVersion(ctx, id, PDF)).rejects.toThrow(new UserError(UPLOAD_BUSY));
    expect(UPLOAD_BUSY).toBe("That's the hourly limit for uploads. Nothing was added; try again in an hour.");
    expect(await listDocuments(ctx)).toHaveLength(1);
    expect((await getDocument(ctx, id))?.versions).toHaveLength(1);
    const next = await workspace("upload-next@example.com", "real");
    await uploadDocument(next, { title: "COI", kind: "coi" }, PDF);
    vi.unstubAllEnvs();
  });
});

describe("plan-limit messages", () => {
  const on = () => {
    vi.stubEnv("BILLING_ENABLED", "1");
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
    // Free can't delete, so its file total offers Pro or nothing (Design, W15-3).
    expect(planLimit(owner, "files").message).toBe(`${FILES_FULL} Pro has no total file limit.`);
    expect(planLimit({ role: "admin", demo: false }, "files").message).toBe(FILES_FULL);
    expect(planLimit(owner, "files").fix).toBeNull();
    vi.unstubAllEnvs();
    expect(planLimit(owner, "files").message).toBe(FILES_FULL);
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

  it("W15-11: a member's post to save facts or the EIN gets a message, not a database error, and changes nothing", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await workspace("facts-owner@example.com", "real");
    const memberId = await db.user("facts-member@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [ctx.orgId, memberId]));
    const member: Ctx = { ...ctx, userId: memberId, role: "member" };
    const owners = new GateClosed("Only owners and admins can change this workspace's business facts. Nothing was saved.");
    const facts = (await factsForFill(ctx)).values;
    await expect(saveProfile(member, { ...facts, legal_name: "Member Co" })).rejects.toThrow(owners);
    await expect(saveProfile(member, { ...facts, legal_name: "Member Co" })).rejects.toBeInstanceOf(GateClosed);
    await expect(saveEin(member, "12-3456789")).rejects.toThrow(owners);
    await expect(saveEin(member, "12-3456789")).rejects.toBeInstanceOf(GateClosed);
    expect((await factsForFill(ctx)).values.legal_name).toBe(facts.legal_name);
    expect((await factsForFill(ctx)).ein).toBeNull();
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

  it("shows a document's latest 50 history entries, newest first, and says so only when there are older ones (W15-5)", async () => {
    const mine = await workspace("long-history@example.com", "sample");
    const [doc] = await listDocuments(mine);
    const view = () => asUser(mine.userId, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $2)", [mine.orgId, doc.id]));
    const history = async () => {
      const got = await getDocument(mine, doc.id);
      return { count: got?.audit.length, more: got?.moreAudit, newest: got?.audit[0]?.seq };
    };
    const start = (await getDocument(mine, doc.id))?.audit.length ?? 0;
    for (let i = start; i < 50; i++) await view();
    expect(await history()).toMatchObject({ count: 50, more: false });
    await view();
    const [last] = await asUser(mine.userId, (tx) => tx.query<{ seq: string }>("select max(seq)::text as seq from app.audit_log where object_id = $1", [doc.id]));
    expect(await history()).toEqual({ count: 50, more: true, newest: last.seq });
  });
});
