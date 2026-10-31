import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteAccount, exportWorkspace } from "@/lib/server/account";
import { sha256Hex } from "@/lib/server/crypto";
import { asAnon, asService, asUser } from "@/lib/server/db";
import { UserError } from "@/lib/server/errors";
import { requestSignature } from "@/lib/server/esign";
import { createPassport, openPassport } from "@/lib/server/passport";
import { NeedsRecentSignIn, type Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";

/** Export and account deletion (Security R10). */

let db: TestDb;
let blobDir: string;

async function sampleWorkspace(): Promise<Ctx> {
  const userId = await db.user(null);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Plumbing (sample)", role: "owner" };
}

const count = async (table: string, orgId: string) =>
  (await db.root((tx) => tx.query<{ n: number }>(`select count(*)::int as n from app.${table} where org_id = $1`, [orgId])))[0].n;

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-account-"));
  setBlobStoreForTests(localBlobStore(blobDir));
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

describe("export", () => {
  it("is a valid ZIP with every version, matching fingerprints, facts without the full tax ID, and the history", async () => {
    const ctx = await sampleWorkspace();
    const { filename, bytes } = await exportWorkspace(ctx);
    expect(filename).toMatch(/^ShipShape export \d{4}-\d{2}-\d{2}\.zip$/);
    const file = path.join(blobDir, "export.zip");
    await writeFile(file, bytes);
    expect(execFileSync("unzip", ["-tq", file]).toString()).toMatch(/No errors detected/);
    const names = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
    expect(names.slice(0, 5)).toEqual(["README.txt", "documents.json", "facts.json", "vendors.json", "history.csv"]);

    const docs: { title: string; versions: { file: string; sha256: string }[] }[] = JSON.parse(execFileSync("unzip", ["-p", file, "documents.json"]).toString());
    const versionFiles = docs.flatMap((d) => d.versions);
    expect(names.filter((n) => n.startsWith("documents/"))).toEqual(versionFiles.map((v) => v.file));
    for (const v of versionFiles) expect(sha256Hex(execFileSync("unzip", ["-p", file, v.file]))).toBe(v.sha256);

    // Files vendors sent through Collect, with their own fingerprints.
    const vendors: { name: string; files: { file: string; sha256: string }[] }[] = JSON.parse(execFileSync("unzip", ["-p", file, "vendors.json"]).toString());
    const vendorFiles = vendors.flatMap((v) => v.files);
    expect(vendorFiles.length).toBeGreaterThan(0);
    expect(names.filter((n) => n.startsWith("vendor-files/")).sort()).toEqual(vendorFiles.map((f) => f.file).sort());
    for (const f of vendorFiles) expect(sha256Hex(execFileSync("unzip", ["-p", file, f.file]))).toBe(f.sha256);

    const facts = execFileSync("unzip", ["-p", file, "facts.json"]).toString();
    expect(facts).toContain("ending 4567");
    expect(facts).not.toContain("1234567");
    const history = execFileSync("unzip", ["-p", file, "history.csv"]).toString().trim().split("\n");
    expect(history[0]).toBe("seq,at,actor,action,object_id");
    expect(history.at(-1)).toContain(",workspace.exported,");
  });

  it("is for owners and admins only, and needs a recent sign-in in a real workspace", async () => {
    const ctx = await sampleWorkspace();
    await expect(exportWorkspace({ ...ctx, role: "member" })).rejects.toThrow(UserError);
    await expect(exportWorkspace({ ...ctx, demo: false, authAt: Math.floor(Date.now() / 1000) - 3600 })).rejects.toThrow(NeedsRecentSignIn);
  });
});

describe("account deletion", () => {
  it("removes a workspace you own alone with its files, voids its links, and removes you elsewhere", async () => {
    const me = await sampleWorkspace();
    const docs = await asUser(me.userId, (tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1", [me.orgId]));
    const passport = await createPassport(me, { label: "Northwind", days: 7, documentIds: [docs[0].id] });
    await requestSignature(me, { documentId: docs[0].id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 });
    expect(await openPassport(passport.id, passport.token, "198.51.100.9")).not.toBeNull();
    const paths = await db.root((tx) => tx.query<{ storage_path: string }>("select storage_path from app.document_versions where org_id = $1", [me.orgId]));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => existsSync(path.join(blobDir, p.storage_path)))).toBe(true);

    // A second workspace with another owner survives; only my membership goes.
    const other = await db.user("partner@example.com");
    const [shared] = await asUser(other, (tx) => tx.query<{ id: string }>("select app.create_workspace('Shared Co') as id"));
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'owner')", [shared.id, me.userId]));
    // A link I made there and turned off: deleting me must not trip its one-way revocation (Security F1).
    const [sharedLink] = await asUser(me.userId, (tx) =>
      tx.query<{ id: string }>(
        "insert into app.share_links (org_id, label, token_hash, expires_at, created_by) values ($1, 'Old link', $2, now() + interval '7 days', $3) returning id",
        [shared.id, "9".repeat(64), me.userId],
      ),
    );
    await asUser(me.userId, (tx) => tx.query("update app.share_links set revoked_at = now() where id = $1", [sharedLink.id]));

    await deleteAccount(me);

    for (const table of ["documents", "document_versions", "audit_log", "share_links", "signature_requests", "outbox", "members"]) {
      expect(await count(table, me.orgId), table).toBe(0);
    }
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [me.orgId]))).toEqual([]);
    expect(paths.some((p) => existsSync(path.join(blobDir, p.storage_path)))).toBe(false);
    expect(await openPassport(passport.id, passport.token, "198.51.100.9")).toBeNull();
    expect(await db.root((tx) => tx.query("select 1 from auth.users where id = $1", [me.userId]))).toEqual([]);
    expect(await db.root((tx) => tx.query("select 1 from app.consents where user_id = $1", [me.userId]))).toEqual([]);

    const left = await db.root((tx) => tx.query<{ user_id: string }>("select user_id from app.members where org_id = $1", [shared.id]));
    expect(left.map((m) => m.user_id)).toEqual([other]);
    const [kept] = await db.root((tx) =>
      tx.query<{ created_by: string | null; revoked: boolean }>("select created_by, revoked_at is not null as revoked from app.share_links where id = $1", [sharedLink.id]),
    );
    expect(kept).toEqual({ created_by: null, revoked: true });
    // Any other change to a revoked link is still refused, even below the app.
    await expect(db.root((tx) => tx.query("update app.share_links set label = 'changed' where id = $1", [sharedLink.id]))).rejects.toThrow(/already revoked/);
    await expect(db.root((tx) => tx.query("update app.share_links set revoked_at = now() where id = $1", [sharedLink.id]))).rejects.toThrow(/already revoked/);
  });

  it("needs a recent sign-in in a real workspace, and only ever deletes the caller", async () => {
    const ctx = await sampleWorkspace();
    await expect(deleteAccount({ ...ctx, demo: false, authAt: Math.floor(Date.now() / 1000) - 3600 })).rejects.toThrow(NeedsRecentSignIn);
    await expect(asAnon((tx) => tx.query("select * from app.delete_my_account()"))).rejects.toThrow(/permission denied/);
    expect(await count("documents", ctx.orgId)).toBeGreaterThan(0);
  });
});
