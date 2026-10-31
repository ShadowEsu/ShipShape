import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/lib/server/crypto";
import { asService, asUser } from "@/lib/server/db";
import { downloadUrl, getDocument, insertDocument, listDocuments } from "@/lib/server/documents";
import { completeSigning, openSigning, requestSignature, revokeSignatureRequest, sendSigningCode, signingFileUrl } from "@/lib/server/esign";
import { GateClosed } from "@/lib/server/flags";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { blobStore, localBlobStore, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";

/** E-signatures (Security R8): consent stored, email proven by a one-time code, signed copy immutable, every step audited. */

let db: TestDb;
let blobDir: string;
let a: Ctx;
let b: Ctx;
const IP = "198.51.100.4";

async function sampleWorkspace(): Promise<Ctx> {
  const userId = await db.user(null);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Sample", role: "owner" };
}

async function nda(ctx: Ctx) {
  return (await listDocuments(ctx)).find((d) => d.kind === "nda")!;
}

/** The code the signer was "emailed" (read from the outbox, as the sample workspace's demo does). */
async function lastCode(orgId: string): Promise<string> {
  const [m] = await db.root((tx) => tx.query<{ body: string }>("select body from app.outbox where org_id = $1 order by created_at desc limit 1", [orgId]));
  return /\b(\d{6})\b/.exec(m.body)![1];
}

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-esign-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  a = await sampleWorkspace();
  b = await sampleWorkspace();
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

const request = async (ctx: Ctx) => requestSignature(ctx, { documentId: (await nda(ctx)).id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 });

describe("signature requests", () => {
  it("are refused for a real workspace in production while signing codes can only go to the outbox", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(requestSignature({ ...a, demo: false }, {})).rejects.toThrow(GateClosed);
    vi.unstubAllEnvs();
  });

  it("show the signer only a valid request, with their email masked", async () => {
    const { id, token } = await request(a);
    const view = await openSigning(id, token);
    expect(view).toMatchObject({ title: expect.stringContaining("NDA"), signerName: "Jordan Lee", signerEmail: "j•••@northwind.example", status: "pending" });
    expect(await openSigning(id, token.replace(/^./, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    await revokeSignatureRequest(a, id);
    expect(await openSigning(id, token)).toBeNull();
    expect(await sendSigningCode(id, token)).toBe("invalid");
  });

  it("keep tokens and codes out of members' reach, and other workspaces can't revoke them", async () => {
    const { id } = await request(a);
    await expect(asUser(a.userId, (tx) => tx.query("select token_hash from app.signature_requests where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(a.userId, (tx) => tx.query("select otp_hash from app.signature_requests where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(revokeSignatureRequest(b, id)).rejects.toThrow();
    await expect(
      asUser(a.userId, (tx) => tx.query("update app.signature_requests set status = 'signed' where id = $1", [id])),
    ).rejects.toThrow(/row-level security|permission denied/);
  });
});

describe("signing", () => {
  it("needs consent, a name and the right code; five wrong codes lock the code", async () => {
    const { id, token } = await request(a);
    expect(await sendSigningCode(id, token)).toBe("ok");
    const code = await lastCode(a.orgId);
    expect(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: false, ip: IP })).toBe("needs_consent");
    expect(await completeSigning(id, token, { code, typedName: "  ", consented: true, ip: IP })).toBe("needs_name");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await completeSigning(id, token, { code: wrong, typedName: "Jordan Lee", consented: true, ip: IP })).toBe("bad_code");
    expect(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: true, ip: IP })).toBe("locked");
    // A fresh code resets the count; at most five codes per request.
    for (let i = 0; i < 4; i++) expect(await sendSigningCode(id, token)).toBe("ok");
    expect(await sendSigningCode(id, token)).toBe("too_many");
  });

  it("refuses an expired code", async () => {
    const { id, token } = await request(a);
    await sendSigningCode(id, token);
    const code = await lastCode(a.orgId);
    await db.root((tx) => tx.query("update app.signature_requests set otp_expires_at = now() - interval '1 minute' where id = $1", [id]));
    expect(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: true, ip: IP })).toBe("expired_code");
  });

  it("adds the signed copy (original pages + certificate) as a new version, once, and records every step", async () => {
    const doc = await nda(a);
    const before = (await getDocument(a, doc.id))!.versions;
    const original = await PDFDocument.load(await blobStore().get(`${a.orgId}/${doc.id}/v${before[0].version}.pdf`));
    const { id, token } = await request(a);
    expect(await openSigning(id, token)).not.toBeNull();
    await sendSigningCode(id, token);
    const code = await lastCode(a.orgId);
    expect(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: true, ip: IP })).toBe("ok");

    const after = (await getDocument(a, doc.id))!;
    const signed = after.versions[0];
    expect(signed).toMatchObject({ version: before[0].version + 1, origin: "signed", mime: "application/pdf" });
    const bytes = await blobStore().get(`${a.orgId}/${doc.id}/v${signed.version}.pdf`);
    expect(sha256Hex(bytes)).toBe(signed.sha256);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(original.getPageCount() + 1);

    const [req] = await db.root((tx) =>
      tx.query<{ status: string; consent_version: string; signed_name: string; otp_hash: string | null; signer_visitor: string }>(
        "select status, consent_version, signed_name, otp_hash, signer_visitor from app.signature_requests where id = $1",
        [id],
      ),
    );
    expect(req).toMatchObject({ status: "signed", consent_version: "esign-2026-10-31", signed_name: "Jordan Lee", otp_hash: null });
    expect(req.signer_visitor).toMatch(/^[0-9a-f]{16}$/);

    const actions = after.audit.map((x) => x.action).reverse();
    expect(actions.slice(-5)).toEqual(["esign.requested", "esign.opened", "esign.code_sent", "document.signed_version_added", "esign.signed"]);
    const [chain] = await asUser(a.userId, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1) as broken", [a.orgId]));
    expect(chain.broken).toBeNull();
    // The signed copy's fingerprint is in the hash-chained history itself (Security F2).
    const [entry] = await asUser(a.userId, (tx) =>
      tx.query<{ detail_sha256: string }>("select detail_sha256 from app.audit_log where org_id = $1 and action = 'document.signed_version_added' and object_id = $2", [
        a.orgId,
        doc.id,
      ]),
    );
    expect(entry.detail_sha256).toBe(signed.sha256);

    // Done means done: no second signature, and the link now hands out the signed copy.
    expect(await completeSigning(id, token, { code, typedName: "Someone Else", consented: true, ip: IP })).toBe("invalid");
    expect((await openSigning(id, token))?.status).toBe("signed");
    const file = verifyFileParams(new URL((await signingFileUrl(id, token))!, "http://x").searchParams);
    expect(file?.objectPath).toBe(`${a.orgId}/${doc.id}/v${signed.version}.pdf`);
    expect(file?.inline).toBe(false);
  });

  it("can't be pointed at another document's storage path", async () => {
    const { id, token } = await request(a);
    await sendSigningCode(id, token);
    const code = await lastCode(a.orgId);
    const other = await nda(b);
    await expect(
      asUser(a.userId, (tx) =>
        tx.query("select app.esign_complete($1, $2, $3, 'v', $4, 'X', $5, $6, $4, 10)", [
          id,
          sha256Hex(token),
          sha256Hex(code),
          "e".repeat(64),
          "0".repeat(16),
          `${b.orgId}/${other.id}/v9.pdf`,
        ]),
      ),
    ).resolves.toEqual([{ esign_complete: "bad_code" }]); // the hash above isn't the keyed one, so it never reaches the insert
    const [row] = await db.root((tx) => tx.query<{ n: number }>("select count(*)::int as n from app.document_versions where org_id = $1 and origin = 'signed'", [b.orgId]));
    expect(row.n).toBe(0);
  });

  it("signs an upload with scripts and an unprintable title into a copy that runs nothing and always downloads (Security F3, F4)", async () => {
    // An upload that runs JavaScript on open, on page view and from a link, and chains a script after a web link.
    const hostile = await PDFDocument.create();
    const page = hostile.addPage([612, 792]);
    const ctx = hostile.context;
    const js = ctx.register(ctx.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert('hi')") }));
    hostile.catalog.set(PDFName.of("OpenAction"), js);
    hostile.catalog.set(PDFName.of("Names"), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of("x"), js] }) }));
    page.node.set(PDFName.of("AA"), ctx.obj({ O: js }));
    const jsLink = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10], A: js }));
    const webLink = ctx.register(
      ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [20, 0, 30, 10], A: ctx.obj({ S: "URI", URI: PDFString.of("https://example.com/terms"), Next: js }) }),
    );
    page.node.set(PDFName.of("Annots"), ctx.obj([jsLink, webLink]));
    const bytes = await hostile.save();
    const documentId = await asUser(a.userId, (tx) =>
      insertDocument(tx, a, { title: "Lease → 2027 🏠", kind: "agreement" }, { bytes, mime: "application/pdf" }, "upload"),
    );

    const { id, token } = await requestSignature(a, { documentId, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 });
    await sendSigningCode(id, token);
    expect(await completeSigning(id, token, { code: await lastCode(a.orgId), typedName: "Jordan Lee", consented: true, ip: IP })).toBe("ok");

    const [signed] = (await getDocument(a, documentId))!.versions;
    const copy = await PDFDocument.load(await blobStore().get(`${a.orgId}/${documentId}/v${signed.version}.pdf`));
    expect(copy.catalog.get(PDFName.of("OpenAction"))).toBeUndefined();
    expect(copy.catalog.get(PDFName.of("Names"))).toBeUndefined();
    const kinds: string[] = [];
    for (const [, obj] of copy.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      expect(obj.get(PDFName.of("JS"))).toBeUndefined();
      expect(obj.get(PDFName.of("AA"))).toBeUndefined();
      const action = obj.lookupMaybe(PDFName.of("A"), PDFDict);
      if (action) {
        kinds.push(action.lookup(PDFName.of("S"), PDFName).asString());
        expect(action.get(PDFName.of("Next"))).toBeUndefined();
      }
    }
    expect(kinds).toEqual(["/URI"]); // the web link stays, the script link lost its action
    const annots = copy.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(2);

    const file = verifyFileParams(new URL(await downloadUrl(a, documentId, signed.version, "view"), "http://x").searchParams);
    expect(file?.inline).toBe(false);
  });
});
