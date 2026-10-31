import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser } from "@/lib/server/db";
import { listDocuments, setArchived, UserError } from "@/lib/server/documents";
import type { Ctx } from "@/lib/server/profile";
import { createPassport, getPassport, listPassports, openPassport, passportFileUrl, revokePassport } from "@/lib/server/passport";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests, verifyFileParams } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";

/** Passport links (Security R6): secret in the fragment, hashed at rest, expiring, revocable, logged. */

let db: TestDb;
let blobDir: string;
let a: Ctx;
let b: Ctx;
const IP = "203.0.113.7";

async function sampleWorkspace(email: string): Promise<Ctx> {
  const userId = await db.user(email);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Sample", role: "owner" };
}

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-passport-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  a = await sampleWorkspace("a@example.com");
  b = await sampleWorkspace("b@example.com");
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

const docIds = async (ctx: Ctx) => (await listDocuments(ctx)).map((d) => d.id);

describe("passport links", () => {
  it("shows exactly the chosen documents to someone with the full link", async () => {
    const [w9, coi] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "For Northwind", days: 30, documentIds: [w9, coi] });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const open = await openPassport(id, token, IP);
    expect(open?.documents.map((d) => d.id).sort()).toEqual([w9, coi].sort());
    expect(open?.label).toBe("For Northwind");
  });

  it("stores only the token's hash, which members can't even read", async () => {
    const [w9] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "Hash check", days: 7, documentIds: [w9] });
    const [row] = await db.root((tx) => tx.query<{ token_hash: string }>("select token_hash from app.share_links where id = $1", [id]));
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    await expect(asUser(a.userId, (tx) => tx.query("select token_hash from app.share_links where id = $1", [id]))).rejects.toThrow(/permission denied/);
  });

  it("gives the same nothing for a wrong token, a revoked link and an expired link", async () => {
    const [w9] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "Lifecycle", days: 7, documentIds: [w9] });
    expect(await openPassport(id, token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), IP)).toBeNull();
    expect(await openPassport(id, "short", IP)).toBeNull();
    expect(await openPassport("not-a-uuid", token, IP)).toBeNull();

    await revokePassport(a, id);
    expect(await openPassport(id, token, IP)).toBeNull();
    expect(await passportFileUrl(id, token, w9, IP)).toBeNull();
    await expect(revokePassport(a, id)).rejects.toThrow(UserError);

    const other = await createPassport(a, { label: "Expiring", days: 7, documentIds: [w9] });
    await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [other.id]));
    expect(await openPassport(other.id, other.token, IP)).toBeNull();
  });

  it("never lasts more than 90 days, even when the app is bypassed", async () => {
    const [w9] = await docIds(a);
    await expect(createPassport(a, { label: "Too long", days: 365, documentIds: [w9] })).rejects.toThrow();
    await expect(
      asUser(a.userId, (tx) =>
        tx.query("insert into app.share_links (org_id, label, token_hash, expires_at, created_by) values ($1, 'x', $2, now() + interval '91 days', $3)", [
          a.orgId,
          "d".repeat(64),
          a.userId,
        ]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it("can't include another workspace's documents, and others can't see or revoke the link", async () => {
    const [mine] = await docIds(a);
    const [theirs] = await docIds(b);
    await expect(createPassport(a, { label: "Sneaky", days: 7, documentIds: [mine, theirs] })).rejects.toThrow(UserError);
    const { id } = await createPassport(a, { label: "Private", days: 7, documentIds: [mine] });
    expect(await listPassports(b)).toEqual([]);
    expect(await getPassport(b, id)).toBeNull();
    await expect(revokePassport(b, id)).rejects.toThrow(UserError);
    const rows = await asUser(b.userId, (tx) => tx.query("update app.share_links set revoked_at = now() where id = $1 returning 1", [id]));
    expect(rows).toEqual([]);
  });

  it("logs each open and download for the owner, with a visitor hash instead of the IP", async () => {
    const [w9] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "Logged", days: 7, documentIds: [w9] });
    await openPassport(id, token, IP);
    const url = await passportFileUrl(id, token, w9, IP);
    const file = verifyFileParams(new URL(url!, "http://x").searchParams);
    expect(file?.inline).toBe(false);
    expect(file?.objectPath.startsWith(`${a.orgId}/${w9}/`)).toBe(true);

    const detail = await getPassport(a, id);
    expect(detail?.link.opens).toBe(1);
    expect(detail?.access.map((x) => x.action)).toEqual(["downloaded", "opened"]);
    expect(detail?.access.every((x) => /^[0-9a-f]{16}$/.test(x.visitor))).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(IP);
  });

  it("stops showing a document once it is archived, and won't hand out a document that isn't on the link", async () => {
    const [w9, coi, third] = await docIds(a);
    const { id, token } = await createPassport(a, { label: "Archive", days: 7, documentIds: [w9, coi] });
    expect(await passportFileUrl(id, token, third, IP)).toBeNull();
    await setArchived(a, coi, true);
    expect((await openPassport(id, token, IP))?.documents.map((d) => d.id)).toEqual([w9]);
    expect(await passportFileUrl(id, token, coi, IP)).toBeNull();
    await setArchived(a, coi, false);
  });

  it("records creating and revoking in the workspace history", async () => {
    const [w9] = await docIds(a);
    const { id } = await createPassport(a, { label: "Audited", days: 7, documentIds: [w9] });
    await revokePassport(a, id);
    const rows = await db.root((tx) =>
      tx.query<{ action: string; actor: string }>("select action, actor from app.audit_log where org_id = $1 and object_id = $2 order by seq", [a.orgId, id]),
    );
    expect(rows).toEqual([
      { action: "passport.created", actor: a.userId },
      { action: "passport.revoked", actor: a.userId },
    ]);
  });
});
