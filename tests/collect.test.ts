import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { deleteAccount } from "@/lib/server/account";
import {
  addVendor,
  cleanFilename,
  createVendorLink,
  deleteVendorFile,
  getVendor,
  listArchivedVendors,
  listVendors,
  openCollect,
  receiveFile,
  revokeVendorLink,
  setVendorArchived,
  vendorFileUrl,
} from "@/lib/server/collect";
import { sha256Hex } from "@/lib/server/crypto";
import { asAnon, asService, asUser } from "@/lib/server/db";
import { listDocuments } from "@/lib/server/documents";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limit";
import { collectOpen, GateClosed } from "@/lib/server/flags";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { blobStore, localBlobStore, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";

/** Collect: vendors send documents through upload links (secret in the fragment, hashed, expiring, revocable). */

let db: TestDb;
let blobDir: string;
let sample: Ctx;

const now = () => Math.floor(Date.now() / 1000);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function realWorkspace(email: string): Promise<Ctx> {
  const userId = await db.user(email);
  const [org] = await asUser(userId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Harbor Test Co') as id"));
  return { userId, demo: false, authAt: now(), orgId: org.id, name: "Harbor Test Co", role: "owner", today: isoToday() };
}

async function sampleWorkspace(): Promise<Ctx> {
  const userId = await db.user(null);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: now(), orgId: org.id, name: "Harbor Plumbing (sample)", role: "owner", today: isoToday() };
}

const storedFiles = async () => (await readdir(blobDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-collect-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  sample = await sampleWorkspace();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

const withRealDocs = () => vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");

describe("the sample workspace", () => {
  it("starts with three made-up vendors: one lapsed, one missing a file, one current", async () => {
    const vendors = await listVendors(sample);
    expect(vendors.map((v) => [v.name, v.state])).toEqual([
      ["Bayside Drywall (sample)", "expired"],
      ["Rivera Electric (sample)", "missing"],
      ["Summit Supply Co. (sample)", "ok"],
    ]);
    const rivera = vendors[1];
    expect(rivera.items.map((i) => [i.kind, i.state])).toEqual([
      ["w9", "ok"],
      ["coi", "expiring"],
      ["license", "missing"],
    ]);
    const detail = await getVendor(sample, rivera.id);
    expect(detail?.files.every((f) => f.sample && f.filename.endsWith("(sample).pdf"))).toBe(true);
  });

  it("its upload links never keep an uploaded file: they store a generated SAMPLE PDF instead", async () => {
    const [vendor] = await listVendors(sample);
    const { id, token } = await createVendorLink(sample, { vendorId: vendor.id, days: 7 });
    expect((await openCollect(id, token))?.sample).toBe(true);
    const real = new Uint8Array([...PDF, ...new TextEncoder().encode("real document 900-12-3456")]);
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "my real w9.pdf", bytes: real } })).toBe("sent");
    const [latest] = (await getVendor(sample, vendor.id))!.files;
    expect(latest.sample).toBe(true);
    expect(latest.filename).toBe("W-9 (sample).pdf");
    const [row] = await asUser(sample.userId, (tx) => tx.query<{ sha256: string; storage_path: string }>("select sha256, storage_path from app.vendor_files where id = $1", [latest.id]));
    expect(row.sha256).not.toBe(sha256Hex(real));
    const stored = await readFile(path.join(blobDir, row.storage_path));
    expect(new TextDecoder().decode(stored.subarray(0, 5))).toBe("%PDF-");
    expect(Buffer.from(stored).includes("real document")).toBe(false);
  });
});

describe("a vendor sending files", () => {
  it("lands in the vendor's files, never the workspace's own documents, and shows on the dashboard", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner1@example.com");
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9", "coi", "coi"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 30 });

    const open = await openCollect(id, token);
    expect(open).toMatchObject({ orgName: "Harbor Test Co", vendorName: "Rivera Electric", sample: false });
    expect(open?.items.map((i) => [i.kind, i.receivedAt])).toEqual([
      ["w9", null],
      ["coi", null],
    ]);

    const expires = inDays(200);
    expect(await receiveFile(id, token, { kind: "coi", expiresOn: expires, file: { name: "../../etc/COI 2026.pdf", bytes: PDF } })).toBe("sent");
    const [vendor] = await listVendors(ctx);
    expect(vendor.items.map((i) => [i.kind, i.state, i.expiresOn])).toEqual([
      ["w9", "missing", null],
      ["coi", "ok", expires],
    ]);
    const detail = await getVendor(ctx, vendorId);
    expect(detail?.files.map((f) => [f.filename, f.sample, f.size_bytes])).toEqual([["COI 2026.pdf", false, PDF.length]]);
    expect(await listDocuments(ctx)).toEqual([]);

    const [audit] = await asUser(ctx.userId, (tx) =>
      tx.query<{ actor: string | null }>("select actor from app.audit_log where org_id = $1 and action = 'collect.received'", [ctx.orgId]),
    );
    expect(audit.actor).toBeNull();
  });

  it("downloads to the workspace that asked for it, as an attachment under the file's name, and to nobody else", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner-dl@example.com");
    const other = await realWorkspace("other-dl@example.com");
    const vendorId = await addVendor(ctx, { name: "Lopez Roofing", email: "", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 30 });
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "W9 Lopez.pdf", bytes: PDF } })).toBe("sent");
    const [file] = (await getVendor(ctx, vendorId))!.files;

    const got = verifyFileParams(new URL((await vendorFileUrl(ctx, file.id))!, "http://x").searchParams);
    expect(got).toMatchObject({ inline: false, filename: "W9 Lopez.pdf" });
    expect(sha256Hex(await blobStore().get(got!.objectPath))).toBe(sha256Hex(PDF));

    expect(await vendorFileUrl(other, file.id)).toBeNull();
    // A member of both workspaces, working in the other one, gets nothing there either.
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [other.orgId, ctx.userId]));
    expect(await vendorFileUrl({ ...ctx, orgId: other.orgId, role: "member" }, file.id)).toBeNull();
    expect(await vendorFileUrl(ctx, "not-a-file-id")).toBeNull();
  });

  it("downloads a vendor's file whatever its name: accents, apostrophes, ampersands and commas", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner-names@example.com");
    const vendorId = await addVendor(ctx, { name: "Müller & O'Brien", email: "", requested: ["coi"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 30 });
    expect(await receiveFile(id, token, { kind: "coi", expiresOn: inDays(100), file: { name: "Müller & O'Brien, COI 2026+.pdf", bytes: PDF } })).toBe("sent");
    const [file] = (await getVendor(ctx, vendorId))!.files;
    expect(file.filename).toBe("Müller & O'Brien, COI 2026+.pdf");
    const got = verifyFileParams(new URL((await vendorFileUrl(ctx, file.id))!, "http://x").searchParams);
    expect(got).toMatchObject({ inline: false, filename: "Muller OBrien COI 2026.pdf" });
    expect(sha256Hex(await blobStore().get(got!.objectPath))).toBe(sha256Hex(PDF));
  });

  it("refuses an unrequested kind, a bad date, a non-PDF/image, an oversized file or no file, and stores nothing", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner2@example.com");
    const vendorId = await addVendor(ctx, { name: "Bayside Drywall", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    const before = await storedFiles();
    const send = (kind: string, expiresOn: string, bytes: Uint8Array | null) =>
      receiveFile(id, token, { kind, expiresOn, file: bytes ? { name: "x.pdf", bytes } : null });

    expect(await send("coi", "", PDF)).toBe("kind");
    expect(await send("w9", "2026-13-45", PDF)).toBe("date");
    expect(await send("w9", "0000-01-01", PDF)).toBe("date"); // ISO-shaped, but Postgres has no year 0
    expect(await send("w9", "", new TextEncoder().encode("<html><script>alert(1)</script>"))).toBe("type");
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PDF);
    expect(await send("w9", "", big)).toBe("too_big");
    expect(await send("w9", "", null)).toBe("empty");
    // A PDF that launches programs or carries embedded files is refused here as it is on the owner's upload (W11-1).
    const active = (name: string) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Type /Action /S /${name} >> endobj\n%%EOF`);
    expect(await send("w9", "", active("Launch"))).toBe("active");
    expect(await send("w9", "", new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Filespec /EF << /F 2 0 R >> /EmbeddedFile >> endobj\n%%EOF"))).toBe("active");

    expect((await getVendor(ctx, vendorId))?.files).toEqual([]);
    expect(await storedFiles()).toBe(before);
  });

  it("takes a file of exactly the 4 MiB maximum; one byte more is too big", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner-max@example.com");
    const vendorId = await addVendor(ctx, { name: "Max Size Co", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    const exact = new Uint8Array(MAX_UPLOAD_BYTES);
    exact.set(PDF);
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9.pdf", bytes: exact } })).toBe("sent");
    const over = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    over.set(PDF);
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9.pdf", bytes: over } })).toBe("too_big");
  });

  it("gets the same nothing from a wrong token, a turned-off link, an expired link and an archived vendor", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner3@example.com");
    const vendorId = await addVendor(ctx, { name: "Summit Supply", requested: ["w9"] });
    const send = (id: string, token: string) => receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9.pdf", bytes: PDF } });

    const wrong = await createVendorLink(ctx, { vendorId, days: 7 });
    const flipped = wrong.token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(await openCollect(wrong.id, flipped)).toBeNull();
    expect(await send(wrong.id, flipped)).toBe("closed");
    expect(await openCollect("not-a-uuid", wrong.token)).toBeNull();

    const revoked = await createVendorLink(ctx, { vendorId, days: 7 });
    await revokeVendorLink(ctx, revoked.id);
    expect(await openCollect(revoked.id, revoked.token)).toBeNull();
    expect(await send(revoked.id, revoked.token)).toBe("closed");

    const expired = await createVendorLink(ctx, { vendorId, days: 7 });
    await db.root((tx) => tx.query("update app.vendor_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [expired.id]));
    expect(await send(expired.id, expired.token)).toBe("closed");

    const live = await createVendorLink(ctx, { vendorId, days: 7 });
    await setVendorArchived(ctx, vendorId, true);
    expect(await openCollect(live.id, live.token)).toBeNull();
    expect(await send(live.id, live.token)).toBe("closed");
    await expect(createVendorLink(ctx, { vendorId, days: 7 })).rejects.toThrow("This vendor is archived, so it can't get an upload link. Restore it first.");
    // Archived vendors leave the main list for the archived one, and come back when restored.
    expect((await listVendors(ctx)).map((v) => v.id)).not.toContain(vendorId);
    expect((await listArchivedVendors(ctx)).map((v) => v.id)).toContain(vendorId);
    await setVendorArchived(ctx, vendorId, false);
    expect((await listVendors(ctx)).map((v) => v.id)).toContain(vendorId);
    expect((await listArchivedVendors(ctx)).map((v) => v.id)).not.toContain(vendorId);
  });

  it("links never last more than 90 days", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner4@example.com");
    const vendorId = await addVendor(ctx, { name: "Long Link Co", requested: ["w9"] });
    await expect(createVendorLink(ctx, { vendorId, days: 365 })).rejects.toThrow();
    await expect(
      asUser(ctx.userId, (tx) =>
        tx.query("insert into app.vendor_links (org_id, vendor_id, token_hash, expires_at, created_by) values ($1, $2, $3, now() + interval '120 days', $4)", [
          ctx.orgId,
          vendorId,
          "e".repeat(64),
          ctx.userId,
        ]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("links last 7, 30 or 90 days: 90 is taken, 91 is a form error", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner-days@example.com");
    const vendorId = await addVendor(ctx, { name: "Ninety Co", requested: ["w9"] });
    await createVendorLink(ctx, { vendorId, days: 90 });
    await expect(createVendorLink(ctx, { vendorId, days: 91 })).rejects.toThrow(ZodError);
  });

  it("turning off a link that's already off says so", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner-off@example.com");
    const vendorId = await addVendor(ctx, { name: "Twice Off Co", requested: ["w9"] });
    const link = await createVendorLink(ctx, { vendorId, days: 7 });
    await revokeVendorLink(ctx, link.id);
    await expect(revokeVendorLink(ctx, link.id)).rejects.toThrow(/already off/);
  });

  it("if the database can't record a received file, the stored copy is removed again", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner-orphan@example.com");
    const vendorId = await addVendor(ctx, { name: "Orphan Co", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    const before = await storedFiles();
    await db.root((tx) => tx.query("alter function app.collect_receive rename to collect_receive_unavailable"));
    try {
      await expect(receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9.pdf", bytes: PDF } })).rejects.toThrow();
    } finally {
      await db.root((tx) => tx.query("alter function app.collect_receive_unavailable rename to collect_receive"));
    }
    expect(await storedFiles()).toBe(before);
    expect((await getVendor(ctx, vendorId))?.files).toEqual([]);
  });
});

describe("adding a vendor", () => {
  it("needs a name: a blank one is a form error", async () => {
    withRealDocs();
    const ctx = await realWorkspace("vendor-blank@example.com");
    await expect(addVendor(ctx, { name: "   ", requested: ["w9"] })).rejects.toThrow(ZodError);
    expect(await listVendors(ctx)).toEqual([]);
  });

  it("takes a name of up to 120 characters; 121 is a form error", async () => {
    withRealDocs();
    const ctx = await realWorkspace("vendor-long@example.com");
    await addVendor(ctx, { name: "V".repeat(120), requested: ["w9"] });
    await expect(addVendor(ctx, { name: "V".repeat(121), requested: ["w9"] })).rejects.toThrow(ZodError);
  });

  it("takes an email address of up to 254 characters; 255 is a form error", async () => {
    withRealDocs();
    const ctx = await realWorkspace("vendor-email@example.com");
    const email = (length: number) => `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(length - 197)}.com`;
    expect(email(254)).toHaveLength(254);
    await addVendor(ctx, { name: "Long Mail Co", email: email(254), requested: ["w9"] });
    await expect(addVendor(ctx, { name: "Longer Mail Co", email: email(255), requested: ["w9"] })).rejects.toThrow(ZodError);
  });

  it("says what to fix in an email address that isn't one", async () => {
    withRealDocs();
    const ctx = await realWorkspace("vendor-bad-email@example.com");
    const refused = await addVendor(ctx, { name: "Typo Co", email: "ap at typo.example", requested: ["w9"] }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ZodError);
    expect(refused instanceof ZodError && refused.issues.map((i) => [i.path[0], i.message])).toEqual([
      ["email", "That email address doesn't look right. Check it, or leave the field empty."],
    ]);
  });

  it("takes a pasted email address with a space or line break around it (review #18)", async () => {
    withRealDocs();
    const ctx = await realWorkspace("vendor-trim@example.com");
    await addVendor(ctx, { name: "Pasted Co", email: " ap@pasted.example\n", requested: ["w9"] });
    expect((await listVendors(ctx)).find((v) => v.name === "Pasted Co")?.email).toBe("ap@pasted.example");
    await addVendor(ctx, { name: "Blank Co", email: "  ", requested: ["w9"] });
    expect((await listVendors(ctx)).find((v) => v.name === "Blank Co")?.email).toBeNull();
  });

  it("needs at least one document to ask for", async () => {
    withRealDocs();
    const ctx = await realWorkspace("vendor-none@example.com");
    await expect(addVendor(ctx, { name: "Nothing Co", requested: [] })).rejects.toThrow(ZodError);
    expect(await listVendors(ctx)).toEqual([]);
  });

  it("can't archive another workspace's vendor: it's 'not found'", async () => {
    withRealDocs();
    const ctx = await realWorkspace("vendor-mine@example.com");
    const other = await realWorkspace("vendor-theirs@example.com");
    const vendorId = await addVendor(other, { name: "Not Yours Co", requested: ["w9"] });
    await expect(setVendorArchived(ctx, vendorId, true)).rejects.toThrow(/Vendor not found/);
    expect((await listVendors(other)).map((v) => v.id)).toEqual([vendorId]);
  });
});

describe("who may use Collect", () => {
  it("real workspaces only with the G3 gate open, and never in production yet", async () => {
    const ctx = await realWorkspace("owner5@example.com");
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    expect(collectOpen(ctx)).toBe(false);
    await expect(addVendor(ctx, { name: "Too Early", requested: ["w9"] })).rejects.toThrow(GateClosed);

    withRealDocs();
    const vendorId = await addVendor(ctx, { name: "Gate Test", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9.pdf", bytes: PDF } })).toBe("gate");

    withRealDocs();
    vi.stubEnv("NODE_ENV", "production");
    expect(collectOpen(ctx)).toBe(false);
    expect(collectOpen({ demo: true })).toBe(true);
  });
});

describe("the database enforces Collect on its own", () => {
  it("checks link, kind, workspace path and sample flag, and members can't write vendor files or read link hashes", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner6@example.com");
    const other = await realWorkspace("owner7@example.com");
    const vendorId = await addVendor(ctx, { name: "Direct Co", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    const receive = (fileId: string, kind: string, storagePath: string, sampleFlag: boolean) =>
      asAnon((tx) =>
        tx.query<{ answer: string }>("select app.collect_receive($1, $2, $3, $4, 'f.pdf', $5, 'application/pdf', 10, $6, null, $7) as answer", [
          id,
          sha256Hex(token),
          fileId,
          kind,
          storagePath,
          "a".repeat(64),
          sampleFlag,
        ]),
      );
    const f1 = "00000000-0000-4000-8000-0000000000a1";
    expect((await receive(f1, "coi", `${ctx.orgId}/${f1}/v1.pdf`, false))[0].answer).toBe("closed");
    expect((await receive(f1, "w9", `${ctx.orgId}/${f1}/v1.pdf`, true))[0].answer).toBe("closed");
    await expect(receive(f1, "w9", `${other.orgId}/${f1}/v1.pdf`, false)).rejects.toThrow(/check constraint/);
    expect((await receive(f1, "w9", `${ctx.orgId}/${f1}/v1.pdf`, false))[0].answer).toBe("ok");

    await expect(
      asUser(ctx.userId, (tx) =>
        tx.query(
          "insert into app.vendor_files (id, org_id, vendor_id, kind, filename, storage_path, mime, size_bytes, sha256) values (gen_random_uuid(), $1, $2, 'w9', 'x.pdf', 'x', 'application/pdf', 1, $3)",
          [ctx.orgId, vendorId, "a".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(ctx.userId, (tx) => tx.query("select token_hash from app.vendor_links where id = $1", [id]))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(other.userId, (tx) => tx.query("insert into app.vendor_links (org_id, vendor_id, token_hash, expires_at, created_by) values ($1, $2, $3, now() + interval '1 day', $4)", [
        other.orgId,
        vendorId,
        "f".repeat(64),
        other.userId,
      ])),
    ).rejects.toThrow(/vendor not in this workspace/);
  });
});

describe("deleting a file a vendor sent (Security C-1)", () => {
  it("owners and admins remove the row and the stored file, and the history keeps its fingerprint; members can't", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner8@example.com");
    const vendorId = await addVendor(ctx, { name: "Delete Co", requested: ["w9", "coi"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9.pdf", bytes: PDF } })).toBe("sent");
    expect(await receiveFile(id, token, { kind: "coi", expiresOn: "", file: { name: "coi.pdf", bytes: PDF } })).toBe("sent");
    const [w9, coi] = (await getVendor(ctx, vendorId))?.files.sort((a, b) => a.kind.localeCompare(b.kind)).reverse() ?? [];
    const before = await storedFiles();

    // A member: refused by the app, and by the database if asked directly.
    const memberId = await db.user("member8@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [ctx.orgId, memberId]));
    const member: Ctx = { ...ctx, userId: memberId, role: "member" };
    await expect(deleteVendorFile(member, w9.id)).rejects.toThrow(/owner or admin/);
    expect(await asUser(memberId, (tx) => tx.query("delete from app.vendor_files where id = $1 returning 1", [w9.id]))).toEqual([]);

    expect(await deleteVendorFile(ctx, w9.id)).toBe(vendorId);
    expect(await storedFiles()).toBe(before - 1);
    expect((await getVendor(ctx, vendorId))?.files.map((f) => f.id)).toEqual([coi.id]);
    expect((await listVendors(ctx))[0].items.find((i) => i.kind === "w9")?.state).toBe("missing");
    await expect(deleteVendorFile(ctx, w9.id)).rejects.toThrow(/already gone/);

    const [entry] = await asUser(ctx.userId, (tx) =>
      tx.query<{ actor: string; detail_sha256: string }>("select actor, detail_sha256 from app.audit_log where org_id = $1 and action = 'collect.file_deleted'", [ctx.orgId]),
    );
    expect(entry).toEqual({ actor: ctx.userId, detail_sha256: sha256Hex(PDF) });
    const [chain] = await asUser(ctx.userId, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1) as broken", [ctx.orgId]));
    expect(chain.broken).toBeNull();

    // An admin may too.
    const adminId = await db.user("admin8@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'admin')", [ctx.orgId, adminId]));
    await deleteVendorFile({ ...ctx, userId: adminId, role: "admin" }, coi.id);
    expect(await storedFiles()).toBe(before - 2);
  });
});

describe("upload caps, enforced by the database (Security C-2)", () => {
  it("a link takes 25 files, then refuses and keeps nothing", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner9@example.com");
    const vendorId = await addVendor(ctx, { name: "Busy Co", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    for (let i = 0; i < 25; i++) expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: `w9-${i}.pdf`, bytes: PDF } })).toBe("sent");
    const before = await storedFiles();
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9-26.pdf", bytes: PDF } })).toBe("link_full");
    expect(await storedFiles()).toBe(before);
    // A new link for the same vendor works.
    const fresh = await createVendorLink(ctx, { vendorId, days: 7 });
    expect(await receiveFile(fresh.id, fresh.token, { kind: "w9", expiresOn: "", file: { name: "w9-new.pdf", bytes: PDF } })).toBe("sent");
  });

  it("a workspace holds 250 MiB of vendor files, then refuses and keeps nothing", async () => {
    withRealDocs();
    const ctx = await realWorkspace("owner10@example.com");
    const vendorId = await addVendor(ctx, { name: "Big Co", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    // 25 rows of 10 MiB fill it exactly (rows only; the cap counts recorded sizes).
    await db.root((tx) =>
      tx.query(
        `insert into app.vendor_files (id, org_id, vendor_id, kind, filename, storage_path, mime, size_bytes, sha256)
         select g, $1::uuid, $2::uuid, 'w9', 'big.pdf', $1::uuid::text || '/' || g::text || '/v1.pdf', 'application/pdf', 10485760, $3
         from (select gen_random_uuid() as g from generate_series(1, 25)) s`,
        [ctx.orgId, vendorId, "b".repeat(64)],
      ),
    );
    const before = await storedFiles();
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "one-more.pdf", bytes: PDF } })).toBe("workspace_full");
    expect(await storedFiles()).toBe(before);
  });
});

describe("account deletion", () => {
  it("removes the files vendors sent along with the workspace", async () => {
    withRealDocs();
    const ctx = await realWorkspace("leaving@example.com");
    const vendorId = await addVendor(ctx, { name: "Gone Co", requested: ["w9"] });
    const { id, token } = await createVendorLink(ctx, { vendorId, days: 7 });
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "w9.pdf", bytes: PDF } })).toBe("sent");
    const [row] = await db.root((tx) => tx.query<{ storage_path: string }>("select storage_path from app.vendor_files where org_id = $1", [ctx.orgId]));
    await readFile(path.join(blobDir, row.storage_path));

    await deleteAccount(ctx);
    await expect(readFile(path.join(blobDir, row.storage_path))).rejects.toThrow(/ENOENT/);
    expect(await db.root((tx) => tx.query("select 1 from app.vendor_files where org_id = $1", [ctx.orgId]))).toEqual([]);
  });
});

describe("file names from vendors", () => {
  it("keep a readable name with the extension that matches the content, never a path", () => {
    expect(cleanFilename("../../etc/COI 2026.pdf", "application/pdf")).toBe("COI 2026.pdf");
    expect(cleanFilename("C:\\Users\\x\\<script>alert(1)</script>.png", "image/png")).toBe("script.png");
    expect(cleanFilename("license.exe", "image/jpeg")).toBe("license.jpg");
    expect(cleanFilename("", "application/pdf")).toBe("document.pdf");
  });
});
