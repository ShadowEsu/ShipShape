import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signProblem } from "@/app/s/[id]/messages";
import { sha256Hex } from "@/lib/server/crypto";
import { asService, asUser } from "@/lib/server/db";
import { downloadUrl, getDocument, insertDocument, listDocuments } from "@/lib/server/documents";
import { completeSigning, listSignatureRequests, openSigning, requestSignature, reviewFileUrl, revokeSignatureRequest, sendSigningCode, signingFileUrl } from "@/lib/server/esign";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { blobStore, localBlobStore, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
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
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Sample", role: "owner", today: isoToday() };
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

  it("for a document another workspace holds, say it isn't here and where to look", async () => {
    const own = await sampleWorkspace();
    const other = await nda(b);
    await expect(requestSignature(own, { documentId: other.id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 })).rejects.toThrow(
      "This document isn't in this workspace any more. Go to Documents to see what's there.",
    );
  });

  it("take a pasted signer address with a space or line break around it (review #18)", async () => {
    const { id, token } = await requestSignature(a, { documentId: (await nda(a)).id, signerName: "Jordan Lee", signerEmail: " jordan@northwind.example\n", days: 7 });
    expect((await openSigning(id, token))?.signerEmail).toBe("j•••@northwind.example");
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

  it("are listed on their document, newest first, only in the workspace that sent them", async () => {
    const ctx = await sampleWorkspace();
    const doc = await nda(ctx);
    const first = await request(ctx);
    const second = await request(ctx);
    await revokeSignatureRequest(ctx, first.id);
    const list = await listSignatureRequests(ctx, doc.id);
    expect(list.map((r) => [r.id, r.status, r.signer_name, r.has_review_file])).toEqual([
      [second.id, "pending", "Jordan Lee", true],
      [first.id, "revoked", "Jordan Lee", true],
    ]);
    expect(await listSignatureRequests(b, doc.id)).toEqual([]);
    // A member of both workspaces, working in the other one, doesn't see them there either.
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [b.orgId, ctx.userId]));
    expect(await listSignatureRequests({ ...ctx, orgId: b.orgId, role: "member" }, doc.id)).toEqual([]);
  });

  it("stop if the document changes while its file is being prepared: the request must name the latest version of an active document (Security R10-1)", async () => {
    const ctx = await sampleWorkspace();
    const doc = await nda(ctx);
    const real = blobStore();
    let archived = false;
    // The change lands after the first transaction read the latest version, before the request is stored.
    setBlobStoreForTests({
      ...real,
      get: async (p) => {
        const bytes = await real.get(p);
        if (!archived) {
          archived = true;
          await db.root((tx) => tx.query("update app.documents set status = 'archived' where id = $1", [doc.id]));
        }
        return bytes;
      },
    });
    try {
      await expect(request(ctx)).rejects.toBeInstanceOf(UserError);
    } finally {
      setBlobStoreForTests(real);
    }
    expect(archived).toBe(true);
    expect(await db.root((tx) => tx.query("select 1 from app.signature_requests where org_id = $1", [ctx.orgId]))).toEqual([]);
  });

  it("allow one person 20 sends an hour; the 21st is refused (Security R10-1)", async () => {
    const ctx = await sampleWorkspace();
    for (let i = 0; i < 20; i++) await request(ctx);
    await expect(request(ctx)).rejects.toBeInstanceOf(UserError);
    expect(await db.root((tx) => tx.query("select 1 from app.signature_requests where org_id = $1", [ctx.orgId]))).toHaveLength(20);
  }, 60_000);
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

  it("tells the signer what to fix, next to the field it's about, or whom to ask for a new link (signing page copy)", async () => {
    const { id, token } = await request(a);
    const sender = (await openSigning(id, token))?.orgName ?? "";
    expect(sender).toBe("Sample");
    expect(await sendSigningCode(id, token)).toBe("ok");
    const code = await lastCode(a.orgId);
    const sign = async (input: { code?: string; typedName?: string; consented?: boolean }) =>
      signProblem(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: true, ip: IP, ...input }), sender);
    expect(await sign({ consented: false })).toEqual({ field: "consent", message: "Check the box to agree to sign electronically." });
    expect(await sign({ typedName: " " })).toEqual({ field: "name", message: "Type your full name to sign." });
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await sign({ code: wrong })).toEqual({ field: "code", message: "That code doesn't match. Type the 6 digits from the newest code we sent." });
    for (let i = 0; i < 4; i++) await sign({ code: wrong });
    expect(await sign({})).toEqual({ field: "code", message: "That code had 5 wrong tries, so it stopped working. Send a new code and use that one." });
    for (let i = 0; i < 4; i++) expect(await sendSigningCode(id, token)).toBe("ok");
    expect(signProblem(await sendSigningCode(id, token), sender)).toEqual({ field: null, message: "You've had all 5 codes this signing link allows. Ask Sample for a new link." });
    await revokeSignatureRequest(a, id);
    expect(await sign({})).toEqual({ field: null, message: "This signing link has stopped working. Ask Sample for a new one." });
  });

  it("lets the sender download exactly the file the signer gets, and no other workspace; the download is in the history (Security R3-2, R4-5)", async () => {
    const doc = await nda(a);
    const { id, token } = await request(a);
    const fileAt = async (url: string) => blobStore().get(verifyFileParams(new URL(url, "http://x").searchParams)!.objectPath);
    const previews = async () => (await getDocument(a, doc.id))?.audit.filter((e) => e.action === "esign.review_downloaded").length;
    expect(await previews()).toBe(0);
    const senders = await fileAt(await reviewFileUrl(a, doc.id, id));
    expect(Buffer.from(senders).equals(Buffer.from(await fileAt((await signingFileUrl(id, token))!)))).toBe(true);
    expect(await previews()).toBe(1);
    await expect(reviewFileUrl(b, doc.id, id)).rejects.toThrow(UserError);
    expect(await previews()).toBe(1);
  });

  it("never signs a file changed after it was sent, nor sends an upload changed in storage (Security R3-4, R3-3)", async () => {
    const c = await sampleWorkspace();
    const { id, token } = await request(c);
    const other = await PDFDocument.create();
    other.addPage([612, 792]);
    await writeFile(path.join(blobDir, `${c.orgId}/${id}/v1.pdf`), await other.save());
    await sendSigningCode(id, token);
    expect(await completeSigning(id, token, { code: await lastCode(c.orgId), typedName: "Jordan Lee", consented: true, ip: IP })).toBe("file_changed");
    expect((await openSigning(id, token))?.status).toBe("pending");

    const docId = (await nda(c)).id;
    const [upload] = await db.root((tx) =>
      tx.query<{ storage_path: string }>("select storage_path from app.document_versions where document_id = $1 order by version desc limit 1", [docId]),
    );
    await writeFile(path.join(blobDir, upload.storage_path), await other.save());
    await expect(request(c)).rejects.toThrow(/doesn't match its fingerprint/);
  });

  it("tells the sender why a PDF can't be sent (built in its own process), and keeps nothing", async () => {
    // A hidden layer: what the signer sees can differ by app. Then a file cut off mid-object.
    const hiddenLayer = [
      "%PDF-1.7",
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /OFF [5 0 R] >> >> >>\nendobj",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj",
      "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj",
      "5 0 obj\n<< /Type /OCG /Name (Layer) >>\nendobj",
      "trailer\n<< /Root 1 0 R >>\n%%EOF",
    ].join("\n");
    const cutOff = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages";
    const files = async () => (await readdir(path.join(blobDir, a.orgId), { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;
    const before = await files();
    for (const [pdf, message] of [
      [hiddenLayer, /can look different in different apps/],
      [cutOff, /can't read this file well enough/],
    ] as const) {
      const bytes = new TextEncoder().encode(pdf);
      const documentId = await asUser(a.userId, (tx) => insertDocument(tx, a, { title: "Lease", kind: "agreement" }, { bytes, mime: "application/pdf" }, "upload"));
      await expect(requestSignature(a, { documentId, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 })).rejects.toThrow(message);
      expect(await db.root((tx) => tx.query("select 1 from app.signature_requests where document_id = $1", [documentId]))).toEqual([]);
    }
    expect(await files()).toBe(before + 2); // the two uploads themselves, nothing for a request
  });

  it("still signs when a new version landed between the signer's open and the signing: the copy takes the number after it (schema sweep row 41)", async () => {
    const c = await sampleWorkspace(); // its own: the other tests count this document's history
    const doc = await nda(c);
    const { id, token } = await request(c);
    expect(await openSigning(id, token)).not.toBeNull();
    await sendSigningCode(id, token);
    const code = await lastCode(c.orgId);
    // A member's upload lands after the signing read the next version number and while it fetches
    // the reviewed file (the window in which the number can go stale).
    const store = localBlobStore(blobDir);
    let landed = false;
    setBlobStoreForTests({
      ...store,
      get: async (p) => {
        if (!landed) {
          landed = true;
          await db.root((tx) =>
            tx.query(
              "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin) values ($1, 2, $2, $3, 'application/pdf', 100, repeat('b', 64), 'upload')",
              [doc.id, c.orgId, `${c.orgId}/${doc.id}/v2.pdf`],
            ),
          );
        }
        return store.get(p);
      },
    });
    try {
      expect(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: true, ip: IP })).toBe("ok");
    } finally {
      setBlobStoreForTests(store);
    }
    expect(landed).toBe(true);
    const versions = (await getDocument(c, doc.id))!.versions;
    expect(versions.map((v) => [v.version, v.origin])).toEqual([[3, "signed"], [2, "upload"], [1, "sample"]]);
    expect(await blobStore().get(`${c.orgId}/${doc.id}/v3.pdf`)).toHaveLength(versions[0].size_bytes);
  });

  it("adds the signed copy (the reviewed file + certificate) as a new version, once, and records every step", async () => {
    const doc = await nda(a);
    const before = (await getDocument(a, doc.id))!.versions;
    const original = await PDFDocument.load(await blobStore().get(`${a.orgId}/${doc.id}/v${before[0].version}.pdf`));
    const { id, token } = await request(a);
    expect(await openSigning(id, token)).not.toBeNull();
    // What the signer downloads is the stored review file whose fingerprint the request recorded (Security R2-1).
    const review = verifyFileParams(new URL((await signingFileUrl(id, token))!, "http://x").searchParams);
    expect(review?.objectPath).toBe(`${a.orgId}/${id}/v1.pdf`);
    const reviewed = await blobStore().get(review!.objectPath);
    const [recorded] = await db.root((tx) => tx.query<{ to_sign_sha256: string }>("select to_sign_sha256 from app.signature_requests where id = $1", [id]));
    expect(sha256Hex(reviewed)).toBe(recorded.to_sign_sha256);
    await sendSigningCode(id, token);
    const code = await lastCode(a.orgId);
    expect(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: true, ip: IP })).toBe("ok");

    const after = (await getDocument(a, doc.id))!;
    const signed = after.versions[0];
    expect(signed).toMatchObject({ version: before[0].version + 1, origin: "signed", mime: "application/pdf" });
    const bytes = await blobStore().get(`${a.orgId}/${doc.id}/v${signed.version}.pdf`);
    expect(sha256Hex(bytes)).toBe(signed.sha256);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(original.getPageCount() + 1);
    // The signed copy starts with exactly the bytes the signer reviewed; the certificate only follows them.
    expect(sha256Hex(bytes.subarray(0, reviewed.length))).toBe(recorded.to_sign_sha256);

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

    // Done means done: no second signature (a stale tab is told it's already signed, not that the link died), and the link now hands out the signed copy.
    expect(await completeSigning(id, token, { code, typedName: "Someone Else", consented: true, ip: IP })).toBe("already_signed");
    expect(await sendSigningCode(id, token)).toBe("already_signed");
    expect((await openSigning(id, token))?.status).toBe("signed");
    const file = verifyFileParams(new URL((await signingFileUrl(id, token))!, "http://x").searchParams);
    expect(file?.objectPath).toBe(`${a.orgId}/${doc.id}/v${signed.version}.pdf`);
    expect(file?.inline).toBe(false);
  });

  it("keeps the sender's name as it was when the request was sent: the signing page, the code and the certificate (Security RN-1)", async () => {
    const ctx = await sampleWorkspace();
    const { id, token } = await request(ctx);
    await db.root((tx) => tx.query("update app.organizations set name = 'Renamed Co' where id = $1", [ctx.orgId]));
    expect((await openSigning(id, token))?.orgName).toBe("Sample");
    await sendSigningCode(id, token);
    const [m] = await db.root((tx) => tx.query<{ body: string }>("select body from app.outbox where org_id = $1 order by created_at desc limit 1", [ctx.orgId]));
    expect(m.body).toContain(" for Sample is ");
    expect(await completeSigning(id, token, { code: await lastCode(ctx.orgId), typedName: "Jordan Lee", consented: true, ip: IP })).toBe("ok");
    const docId = (await nda(ctx)).id;
    const { versions } = (await getDocument(ctx, docId))!;
    const signed = await PDFDocument.load(await blobStore().get(`${ctx.orgId}/${docId}/v${versions[0].version}.pdf`));
    // pdf-lib writes the certificate's text a word at a time as hex strings, in compressed streams, over one or two pages.
    const pageText = (i: number) => {
      const contents = signed.getPage(i).node.Contents();
      const streams = contents instanceof PDFArray ? contents.asArray().map((r) => signed.context.lookup(r)) : [contents];
      return streams.map((s) => (s instanceof PDFRawStream ? inflateSync(s.contents).toString("latin1") : "")).join("\n");
    };
    const certificate = signed.getPages().map((_, i) => pageText(i)).join("\n");
    const word = (s: string) => `<${Buffer.from(s, "latin1").toString("hex").toUpperCase()}>`;
    expect(certificate).toContain(word("Sent"));
    expect(certificate).toContain(word("Sample"));
    expect(certificate).not.toContain(word("Renamed"));
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
      // A title saved before one-line titles were enforced, with a line break (Security F4-1).
      insertDocument(tx, a, { title: "Lease\n→ 2027 🏠", kind: "agreement" }, { bytes, mime: "application/pdf" }, "upload"),
    );

    await expect(requestSignature(a, { documentId, signerName: "Jordan\nLee", signerEmail: "jordan@northwind.example", days: 7 })).rejects.toThrow();
    const { id, token } = await requestSignature(a, { documentId, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 });
    await sendSigningCode(id, token);
    expect(await completeSigning(id, token, { code: "000000", typedName: "Jordan\nLee", consented: true, ip: IP })).toBe("name_chars");
    // A real name outside WinAnsi (Ł, Cyrillic, CJK) is refused with its own reason, not "type your full name"; an empty one still is that.
    for (const typedName of ["Łukasz Nowak", "Иван Петров", "李明"]) expect(await completeSigning(id, token, { code: "000000", typedName, consented: true, ip: IP })).toBe("name_chars");
    expect(await completeSigning(id, token, { code: "000000", typedName: " ", consented: true, ip: IP })).toBe("needs_name");
    expect(await completeSigning(id, token, { code: "000000", typedName: "Antonin Dvorak", consented: true, ip: IP })).toBe("bad_code");
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
