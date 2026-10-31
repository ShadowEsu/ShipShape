import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFPage } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/server/crypto";
import { asService, asUser } from "@/lib/server/db";
import { downloadUrl, fillTemplate, getDocument, listDocuments, uploadDocument, uploadVersion } from "@/lib/server/documents";
import { UserError } from "@/lib/server/errors";
import { checkUpload } from "@/lib/server/files";
import { fillW9Form, formValues, loadW9, prefill } from "@/lib/server/fill";
import { assertLaunchConfig, GateClosed } from "@/lib/server/flags";
import { createPassport, openPassport } from "@/lib/server/passport";
import { factsForFill, NeedsRecentSignIn, renameWorkspace, revealEin, saveEin, saveProfile, type Ctx } from "@/lib/server/profile";
import { SAMPLE_EIN, seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { templateById } from "@/lib/templates/catalog";
import { freshDb, type TestDb } from "./support/db";

let db: TestDb;
let blobDir: string;
let sample: Ctx; // a sample workspace
let real: Ctx; // a real workspace (local development / after G3)
let other: Ctx; // someone else's real workspace

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");
const now = () => Math.floor(Date.now() / 1000);

async function workspace(email: string, kind: "sample" | "real"): Promise<Ctx> {
  const userId = await db.user(email);
  if (kind === "sample") {
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    return { userId, demo: true, authAt: now(), orgId: org.id, name: "Sample", role: "owner" };
  }
  const [org] = await asUser(userId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Real') as id"));
  return { userId, demo: false, authAt: now(), orgId: org.id, name: "Real", role: "owner" };
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
    // A mangled link (/app/documents/<id>/file) is "not found" (the route's 404), not a database error.
    await expect(downloadUrl(sample, "not-a-document", 1, "download")).rejects.toThrow(UserError);
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
    const values = { ...prefill(t, facts), sign: "", signature: "" };
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
    const values = { ...prefill(t, facts), tin_kind: "ssn", ssn: "900-12-3456", sign: "on", signature: "Alex Rivera" };
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

  it("reports missing and invalid fields instead of making a document", async () => {
    const res = await fillTemplate(sample, "irs-w9", { name: "", tax_class: "nope", tin_kind: "ssn", ssn: "12" }, true);
    expect(res.ok).toBe(false);
    expect(res.ok ? {} : res.errors).toMatchObject({ name: "Required.", tax_class: "Choose one of the options.", ssn: "An SSN has 9 digits." });
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
      ...prefill(t, await factsForFill(sample)),
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

  it("takes a text box's line breaks as browsers post them (CRLF) and draws each line on its own (Security R2-6)", async () => {
    const t = templateById("common-paper-mnda")!;
    const data = new FormData();
    const posted = { ...prefill(t, await factsForFill(sample)), ...typed, purpose: "Firstline of it.\r\nSecondline of it.\rThirdline of it." };
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
