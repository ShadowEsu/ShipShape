import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteAccount, deletionPreview, EXPORT_MAX_BYTES, exportWorkspace, finishDeletions, purgeSampleAccounts, retryStorageCleanup } from "@/lib/server/account";
import { TERMS_VERSION } from "@/lib/legal";
import { sha256Hex } from "@/lib/server/crypto";
import { asAnon, asService, asUser } from "@/lib/server/db";
import { UserError } from "@/lib/server/errors";
import { completeSigning, requestSignature, sendSigningCode } from "@/lib/server/esign";
import { createPassport, openPassport, passportFileUrl } from "@/lib/server/passport";
import { NeedsRecentSignIn, type Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, newSessionId } from "@/lib/server/session";
import { blobStore, localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";

/** Export and account deletion (Security R10). */

let db: TestDb;
let blobDir: string;

async function sampleWorkspace(): Promise<Ctx> {
  // As "Try the sample" signs in: an anonymous user, then the workspace.
  const userId = await createLocalUser(null, true);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Plumbing (sample)", role: "owner", today: isoToday() };
}

const count = async (table: string, orgId: string) =>
  (await db.root((tx) => tx.query<{ n: number }>(`select count(*)::int as n from app.${table} where org_id = $1`, [orgId])))[0].n;

/** Stored files queued for removal (0028) under one workspace's prefix. */
const queued = async (orgId: string) =>
  (await db.root((tx) => tx.query<{ path: string }>("select path from app.storage_cleanup where path like $1 order by path", [`${orgId}/%`]))).map((r) => r.path);

/** Files in the local blob store under `dir`; none once the directory is gone. */
const storedFiles = async (dir: string) =>
  existsSync(dir) ? (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length : 0;

/** A session row for `userId` on a browser named `family`, as a sign-in makes one (Design row 34). Returns its id. */
async function signedInOn(userId: string, family: string): Promise<string> {
  const id = newSessionId();
  await asUser(userId, (tx) => tx.query("select app.start_session($1, $2)", [id, family]));
  return id;
}

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
    expect(names.slice(0, 6)).toEqual(["README.txt", "documents.json", "facts.json", "vendors.json", "history.csv", "sessions.json"]);

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
    expect(history[0]).toBe("seq,at,actor,action,object_id,sha256");
    // Every version's fingerprint is in the hash-chained history too (Security F2).
    for (const v of versionFiles) expect(history.some((h) => h.includes("version_added") && h.endsWith(`,${v.sha256}`))).toBe(true);
    expect(history.at(-1)).toContain(",workspace.exported,");
  });

  it("lists the exporting person's own sessions, and no one else's, by browser name and times only (Design row 34)", async () => {
    const ctx = await sampleWorkspace();
    const partner = await db.user("export-sessions-partner@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'admin')", [ctx.orgId, partner]));
    await signedInOn(ctx.userId, "Safari on a Mac");
    const phone = await signedInOn(ctx.userId, "Chrome on an iPhone");
    await asUser(ctx.userId, (tx) => tx.query("select app.end_session($1)", [phone]));
    await signedInOn(partner, "Edge on Android");

    const file = path.join(blobDir, "export-sessions.zip");
    await writeFile(file, (await exportWorkspace(ctx)).bytes);
    const sessions: Record<string, string | null>[] = JSON.parse(execFileSync("unzip", ["-p", file, "sessions.json"]).toString());
    expect(sessions.map((s) => s.ua_family).sort()).toEqual(["Chrome on an iPhone", "Safari on a Mac"]);
    for (const s of sessions) expect(Object.keys(s)).toEqual(["ua_family", "created_at", "last_seen_at", "revoked_at"]);
    expect(sessions.find((s) => s.ua_family === "Chrome on an iPhone")?.revoked_at).not.toBeNull();
    expect(sessions.find((s) => s.ua_family === "Safari on a Mac")?.revoked_at).toBeNull();
  });

  it("holds the passport links with their opens and downloads, the signature requests and the person's own agreements, and never a token or code hash (W9-9)", async () => {
    const ctx = await sampleWorkspace();
    const visitorIp = "198.51.100.9";
    const [doc] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and status = 'active' order by created_at, id limit 1", [ctx.orgId]));
    const link = await createPassport(ctx, { label: "Northwind", days: 7, documentIds: [doc.id] });
    expect(await openPassport(link.id, link.token, visitorIp)).not.toBeNull();
    expect(await passportFileUrl(link.id, link.token, doc.id, visitorIp)).not.toBeNull();

    // One request waiting with a code sent (so it has a code hash), and one signed.
    const [nda] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and kind = 'nda' limit 1", [ctx.orgId]));
    const pending = await requestSignature(ctx, { documentId: nda.id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 });
    expect(await sendSigningCode(pending.id, pending.token)).toBe("ok");
    const signed = await requestSignature(ctx, { documentId: nda.id, signerName: "Sam Rivera", signerEmail: "sam@northwind.example", days: 7 });
    expect(await sendSigningCode(signed.id, signed.token)).toBe("ok");
    const [mail] = await db.root((tx) => tx.query<{ body: string }>("select body from app.outbox where org_id = $1 order by created_at desc limit 1", [ctx.orgId]));
    const code = /\b(\d{6})\b/.exec(mail.body)?.[1] ?? "";
    expect(await completeSigning(signed.id, signed.token, { code, typedName: "Sam Rivera", consented: true, ip: "198.51.100.4" })).toBe("ok");

    // The person's own Terms agreement, and another member's agreement about this same workspace.
    await asUser(ctx.userId, (tx) => tx.query("insert into app.consents (user_id, item, policy_version) values ($1, 'terms_privacy', $2)", [ctx.userId, TERMS_VERSION]));
    const partner = await db.user("export-agreements-partner@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'admin')", [ctx.orgId, partner]));
    await asUser(partner, (tx) => tx.query("insert into app.consents (user_id, item, policy_version, object_id) values ($1, 'billing', $2, $3)", [partner, TERMS_VERSION, ctx.orgId]));

    const { bytes } = await exportWorkspace(ctx);
    const file = path.join(blobDir, "export-passports.zip");
    await writeFile(file, bytes);
    const names = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
    expect(names.slice(6, 9)).toEqual(["passports.json", "signatures.json", "agreements.json"]);
    const readme = execFileSync("unzip", ["-p", file, "README.txt"]).toString();
    for (const name of ["passports.json", "signatures.json", "agreements.json"]) expect(readme).toContain(`\n${name} `);

    const passports: Record<string, unknown>[] = JSON.parse(execFileSync("unzip", ["-p", file, "passports.json"]).toString());
    expect(passports).toEqual([
      {
        id: link.id,
        label: "Northwind",
        created_at: expect.any(String),
        expires_at: expect.any(String),
        revoked_at: null,
        documents: [doc.id],
        access: [
          { at: expect.any(String), action: "opened", document_id: null, visitor: expect.stringMatching(/^[0-9a-f]{16}$/) },
          { at: expect.any(String), action: "downloaded", document_id: doc.id, visitor: expect.stringMatching(/^[0-9a-f]{16}$/) },
        ],
      },
    ]);
    const [access] = await db.root((tx) => tx.query<{ visitor: string }>("select visitor from app.share_access where link_id = $1 limit 1", [link.id]));
    expect(JSON.stringify(passports)).toContain(`"visitor":"${access.visitor}"`);

    const signatures: Record<string, unknown>[] = JSON.parse(execFileSync("unzip", ["-p", file, "signatures.json"]).toString());
    const columns = [
      "id",
      "document_id",
      "version",
      "signed_version",
      "signer_name",
      "signer_email",
      "status",
      "created_at",
      "expires_at",
      "signed_at",
      "consented_at",
      "consent_version",
      "signed_name",
      "to_sign_sha256",
    ];
    const stored = await db.root((tx) =>
      tx.query<Record<string, unknown>>(
        "select id, document_id, version, signed_version, signer_name, signer_email, status, created_at::text as created_at, expires_at::text as expires_at, signed_at::text as signed_at, consented_at::text as consented_at, consent_version, signed_name, to_sign_sha256 from app.signature_requests where org_id = $1 order by created_at, id",
        [ctx.orgId],
      ),
    );
    expect(signatures).toEqual(stored);
    for (const s of signatures) expect(Object.keys(s)).toEqual(columns);
    expect(signatures.map((s) => [s.id, s.status])).toEqual([
      [pending.id, "pending"],
      [signed.id, "signed"],
    ]);
    expect(signatures[1]).toMatchObject({ signed_name: "Sam Rivera", signed_at: expect.any(String), consented_at: expect.any(String), consent_version: expect.any(String) });

    const agreements: Record<string, unknown>[] = JSON.parse(execFileSync("unzip", ["-p", file, "agreements.json"]).toString());
    expect(agreements).toEqual([{ item: "terms_privacy", policy_version: TERMS_VERSION, object_id: null, at: expect.any(String) }]);

    // No token or code hash and no storage path anywhere in the archive, in any file.
    const secrets = await db.root((tx) =>
      tx.query<{ secret: string }>(
        "select token_hash as secret from app.share_links where org_id = $1 union all select unnest(array[token_hash, otp_hash, to_sign_path]) from app.signature_requests where org_id = $1",
        [ctx.orgId],
      ),
    );
    // The link's and both requests' token hashes, the waiting request's code hash and both files to sign.
    expect(secrets.filter((s) => s.secret !== null)).toHaveLength(6);
    const archive = Buffer.from(bytes);
    for (const { secret } of secrets) if (secret !== null) expect(archive.includes(secret)).toBe(false);
  });

  it("is named for the owner's day, not the UTC one (W9-7)", async () => {
    const ctx = await sampleWorkspace();
    // Evening in California: the owner's calendar is still on the day before UTC's.
    const ownersDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { filename } = await exportWorkspace({ ...ctx, today: ownersDay });
    expect(filename).toBe(`ShipShape export ${ownersDay}.zip`);
  });

  it("is for owners and admins only, and needs a recent sign-in in a real workspace", async () => {
    const ctx = await sampleWorkspace();
    await expect(exportWorkspace({ ...ctx, role: "member" })).rejects.toThrow(UserError);
    await expect(exportWorkspace({ ...ctx, demo: false, authAt: Math.floor(Date.now() / 1000) - 3600 })).rejects.toThrow(NeedsRecentSignIn);
  });

  it("in a sample workspace, needs no recent sign-in: its visitors have no password to re-enter", async () => {
    const ctx = await sampleWorkspace();
    const { bytes } = await exportWorkspace({ ...ctx, authAt: Math.floor(Date.now() / 1000) - 3600 });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("still exports when one stored file is gone: that file is named in the README, listed without a file, and the rest are all there (review #17)", async () => {
    const ctx = await sampleWorkspace();
    const [gone] = await db.root((tx) => tx.query<{ storage_path: string }>("select storage_path from app.document_versions where org_id = $1 order by created_at limit 1", [ctx.orgId]));
    await rm(path.join(blobDir, gone.storage_path));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bytes } = await exportWorkspace(ctx);
    quiet.mockRestore();
    const file = path.join(blobDir, "export-missing.zip");
    await writeFile(file, bytes);
    const names = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
    const docs: { versions: { file: string | null; sha256: string }[] }[] = JSON.parse(execFileSync("unzip", ["-p", file, "documents.json"]).toString());
    const versions = docs.flatMap((d) => d.versions);
    expect(versions.filter((v) => v.file === null)).toHaveLength(1);
    expect(names.filter((n) => n.startsWith("documents/"))).toEqual(versions.flatMap((v) => (v.file ? [v.file] : [])));
    expect(execFileSync("unzip", ["-p", file, "README.txt"]).toString()).toContain("NOT INCLUDED");
    const history = execFileSync("unzip", ["-p", file, "history.csv"]).toString().trim().split("\n");
    expect(history.at(-1)).toContain(",workspace.exported,");
  });

  it("records no export when storage itself fails, and reports the failure", async () => {
    const ctx = await sampleWorkspace();
    const local = localBlobStore(blobDir);
    setBlobStoreForTests({ ...local, get: () => Promise.reject(new Error("storage down")) });
    try {
      await expect(exportWorkspace(ctx)).rejects.toThrow("storage down");
    } finally {
      setBlobStoreForTests(local);
    }
    expect(await db.root((tx) => tx.query("select 1 from app.audit_log where org_id = $1 and action = 'workspace.exported'", [ctx.orgId]))).toEqual([]);
  });

  it("takes a workspace whose files add up to exactly 200 MB, and refuses one byte more", async () => {
    const ctx = await sampleWorkspace();
    const [{ n }] = await db.root((tx) =>
      tx.query<{ n: number }>(
        "select ((select coalesce(sum(size_bytes), 0) from app.document_versions where org_id = $1) + (select coalesce(sum(size_bytes), 0) from app.vendor_files where org_id = $1))::int as n",
        [ctx.orgId],
      ),
    );
    const [doc] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 limit 1", [ctx.orgId]));
    // Records whose sizes fill the rest of the limit (each at most the database's 10 MB cap per file), each with a small stored file.
    const addVersion = async (version: number, size: number) => {
      const storagePath = `${ctx.orgId}/${doc.id}/v${version}.pdf`;
      await db.root((tx) =>
        tx.query(
          "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin) values ($1, $2, $3, $4, 'application/pdf', $5, repeat('a', 64), 'upload')",
          [doc.id, version, ctx.orgId, storagePath, size],
        ),
      );
      await blobStore().put(storagePath, new TextEncoder().encode("%PDF-1.7\n%%EOF\n"), "application/pdf");
    };
    let version = 100;
    for (let missing = EXPORT_MAX_BYTES - n; missing > 0; missing -= 10485760) await addVersion(version++, Math.min(missing, 10485760));
    expect((await exportWorkspace(ctx)).bytes.length).toBeGreaterThan(0);
    await addVersion(version, 1);
    await expect(exportWorkspace(ctx)).rejects.toThrow("This workspace is too large to export in one file.");
  });

  it("refuses a workspace whose files add up to more than 200 MB, vendors' files included, and records no export", async () => {
    const ctx = await sampleWorkspace();
    // Records only: the size check comes before any file is read. 19 versions at the database's 10 MB
    // cap per file stay under the limit by themselves; 2 vendor files at 10 MB take the total over it.
    await db.root((tx) =>
      tx.query(
        `insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin)
         select d.id, 100 + g, d.org_id, d.org_id::text || '/big/' || g || '.pdf', 'application/pdf', 10485760, repeat('a', 64), 'upload'
         from (select id, org_id from app.documents where org_id = $1 limit 1) d, generate_series(1, 19) g`,
        [ctx.orgId],
      ),
    );
    await db.root((tx) =>
      tx.query(
        `insert into app.vendor_files (id, org_id, vendor_id, kind, filename, storage_path, mime, size_bytes, sha256)
         select f.id, v.org_id, v.id, 'other', 'big.pdf', v.org_id::text || '/' || f.id::text || '/v1.pdf', 'application/pdf', 10485760, repeat('b', 64)
         from (select id, org_id from app.vendors where org_id = $1 limit 1) v, (select gen_random_uuid() as id from generate_series(1, 2)) f`,
        [ctx.orgId],
      ),
    );
    await expect(exportWorkspace(ctx)).rejects.toThrow("This workspace is too large to export in one file.");
    expect(await db.root((tx) => tx.query("select 1 from app.audit_log where org_id = $1 and action = 'workspace.exported'", [ctx.orgId]))).toEqual([]);
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
    await asUser(me.userId, (tx) => tx.query("update app.profiles set signer_name = 'Pat Doe' where org_id = $1", [shared.id]));
    const sharedHistory = await count("audit_log", shared.id);

    await deleteAccount(me);

    for (const table of ["documents", "document_versions", "audit_log", "share_links", "signature_requests", "outbox", "members"]) {
      expect(await count(table, me.orgId), table).toBe(0);
    }
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [me.orgId]))).toEqual([]);
    expect(paths.some((p) => existsSync(path.join(blobDir, p.storage_path)))).toBe(false);
    expect(await queued(me.orgId)).toEqual([]);
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
    // Clearing my references there isn't a change anyone made (Security F7): no history rows, and
    // the profile isn't stamped with my deleted id.
    expect(await count("audit_log", shared.id)).toBe(sharedHistory);
    const [profile] = await db.root((tx) => tx.query<{ updated_by: string | null }>("select updated_by from app.profiles where org_id = $1", [shared.id]));
    expect(profile.updated_by).toBeNull();
    const [chain] = await asUser(other, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1) as broken", [shared.id]));
    expect(chain.broken).toBeNull();
  });

  it("removes the person's sessions at once, and nobody else's (Design row 34)", async () => {
    const me = await sampleWorkspace();
    const other = await db.user("deletion-sessions-other@example.com");
    await signedInOn(me.userId, "Safari on a Mac");
    await signedInOn(me.userId, "Chrome on an iPhone");
    const theirs = await signedInOn(other, "Firefox on Windows");
    const sessionsOf = (userId: string) => db.root((tx) => tx.query<{ id: string }>("select id from app.sessions where user_id = $1", [userId]));
    expect(await sessionsOf(me.userId)).toHaveLength(2);

    await deleteAccount(me);
    expect(await sessionsOf(me.userId)).toEqual([]);
    expect(await sessionsOf(other)).toEqual([{ id: theirs }]);
  });

  it("names, before anything goes, the workspaces it deletes (you're the only owner) and the ones you leave", async () => {
    const me = await sampleWorkspace();
    const other = await db.user("preview-partner@example.com");
    const join = async (name: string, role: "owner" | "admin") => {
      const [org] = await asUser(other, (tx) => tx.query<{ id: string }>("select app.create_workspace($1) as id", [name]));
      await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, $3)", [org.id, me.userId, role]));
    };
    await join("Co-owned Co", "owner");
    await join("Admin Co", "admin");
    expect(await deletionPreview(me.userId)).toEqual({ deleted: ["Sample"], left: ["Admin Co", "Co-owned Co"] });
  });

  it("needs a recent sign-in in a real workspace, and only ever deletes the caller", async () => {
    const ctx = await sampleWorkspace();
    await expect(deleteAccount({ ...ctx, demo: false, authAt: Math.floor(Date.now() / 1000) - 3600 })).rejects.toThrow(NeedsRecentSignIn);
    await expect(asAnon((tx) => tx.query("select * from app.delete_my_account('{}'::uuid[])"))).rejects.toThrow(/permission denied/);
    expect(await count("documents", ctx.orgId)).toBeGreaterThan(0);
  });

  it("if storage can't remove the files, the deletion still finishes and the next daily run removes them (Security N-091a)", async () => {
    const me = await sampleWorkspace();
    const local = localBlobStore(blobDir);
    setBlobStoreForTests({ ...local, remove: () => Promise.reject(new Error("S3 unavailable")) });
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a.join(" ")));
    try {
      await deleteAccount(me);
    } finally {
      spy.mockRestore();
      setBlobStoreForTests(local);
    }
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [me.orgId]))).toEqual([]);
    expect(await db.root((tx) => tx.query("select 1 from auth.users where id = $1", [me.userId]))).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(me.orgId); // every storage path starts with the workspace id

    // Every file the deletion orphaned is queued (none lost), and still in storage.
    const left = await queued(me.orgId);
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((p) => existsSync(path.join(blobDir, p)))).toBe(true);
    const onDisk = (await readdir(path.join(blobDir, me.orgId), { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;
    expect(left).toHaveLength(onDisk);

    // The daily run, with storage working again, removes them and empties the queue.
    expect(await retryStorageCleanup()).toBeGreaterThanOrEqual(left.length);
    expect(left.some((p) => existsSync(path.join(blobDir, p)))).toBe(false);
    expect(await queued(me.orgId)).toEqual([]);
  });

  it("one daily run clears a queue far over one batch, so even a big account's files go within the two days (Security N-091b)", async () => {
    const org = crypto.randomUUID();
    await db.root((tx) => tx.query("insert into app.storage_cleanup (path) select $1 || '/' || gen_random_uuid() || '/v1.pdf' from generate_series(1, 2500)", [org]));
    expect(await queued(org)).toHaveLength(2500);
    expect(await retryStorageCleanup()).toBeGreaterThanOrEqual(2500);
    expect(await queued(org)).toEqual([]);
  });

  it("a batch storage refuses goes to the back of the queue, so the files behind it are still removed (review #16)", async () => {
    const org = crypto.randomUUID();
    const stuck = `${org}/${crypto.randomUUID()}/v1.pdf`;
    await db.root((tx) => tx.query("insert into app.storage_cleanup (path, queued_at) values ($1, now() - interval '2 hours')", [stuck]));
    await db.root((tx) => tx.query("insert into app.storage_cleanup (path, queued_at) select $1 || '/' || gen_random_uuid() || '/v1.pdf', now() - interval '1 hour' from generate_series(1, 1000)", [org]));
    const local = localBlobStore(blobDir);
    setBlobStoreForTests({ ...local, remove: (paths) => (paths.includes(stuck) ? Promise.reject(new Error("AccessDenied")) : local.remove(paths)) });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(retryStorageCleanup()).rejects.toThrow("AccessDenied");
    } finally {
      quiet.mockRestore();
      setBlobStoreForTests(local);
    }
    // The stuck one's batch (it and the 999 queued with it) is still queued, now behind the rest; the one path behind it is gone.
    const left = await queued(org);
    expect(left).toHaveLength(1000);
    expect(left).toContain(stuck);
    const [age] = await db.root((tx) => tx.query<{ recent: boolean }>("select queued_at > now() - interval '1 minute' as recent from app.storage_cleanup where path = $1", [stuck]));
    expect(age.recent).toBe(true);
    await db.root((tx) => tx.query("delete from app.storage_cleanup where path like $1", [`${org}/%`]));
  });

  it("stops at the daily run's deadline: one batch of files, no further deletions, and nothing is lost (review #15)", async () => {
    await retryStorageCleanup(); // whatever earlier tests left behind, so the batch below is this test's own
    const org = crypto.randomUUID();
    await db.root((tx) => tx.query("insert into app.storage_cleanup (path) select $1 || '/' || gen_random_uuid() || '/v1.pdf' from generate_series(1, 1500)", [org]));
    const past = Date.now() - 1;
    expect(await retryStorageCleanup(past)).toBe(1000);
    expect(await queued(org)).toHaveLength(500);
    const old = await sampleWorkspace();
    await db.root((tx) => tx.query("update auth.users set created_at = now() - interval '3 days' where id = $1", [old.userId]));
    expect(await purgeSampleAccounts(past)).toEqual({ purged: 0, failed: 0 });
    expect(await finishDeletions(past)).toEqual({ finished: 0, failed: 0 });
    expect(await count("documents", old.orgId)).toBeGreaterThan(0);
    expect(await retryStorageCleanup()).toBeGreaterThanOrEqual(500);
    expect(await purgeSampleAccounts()).toEqual({ purged: 1, failed: 0 }); // the deferred one goes on the next run
  });
});

describe("sample account purge", () => {
  it("deletes sample accounts after two days with their workspace and stored files, and leaves newer ones alone", async () => {
    const old = await sampleWorkspace();
    const fresh = await sampleWorkspace();
    await db.root((tx) => tx.query("update auth.users set created_at = now() - interval '3 days' where id = $1", [old.userId]));
    const tables = ["documents", "document_versions", "audit_log", "vendors", "vendor_files", "outbox", "members"];
    const freshRows = await Promise.all(tables.map((t) => count(t, fresh.orgId)));
    const oldFiles = await storedFiles(path.join(blobDir, old.orgId));
    const freshFiles = await storedFiles(path.join(blobDir, fresh.orgId));
    const allFiles = await storedFiles(blobDir);
    expect(await count("documents", old.orgId)).toBeGreaterThan(0);
    expect(oldFiles).toBeGreaterThan(0);

    expect(await purgeSampleAccounts()).toEqual({ purged: 1, failed: 0 });

    expect(await db.root((tx) => tx.query("select 1 from auth.users where id = $1", [old.userId]))).toEqual([]);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [old.orgId]))).toEqual([]);
    for (const table of tables) expect(await count(table, old.orgId), table).toBe(0);
    expect(await storedFiles(path.join(blobDir, old.orgId))).toBe(0);
    expect(await storedFiles(blobDir)).toBe(allFiles - oldFiles);
    expect(await queued(old.orgId)).toEqual([]);

    expect(await db.root((tx) => tx.query("select 1 from auth.users where id = $1", [fresh.userId]))).toHaveLength(1);
    expect(await Promise.all(tables.map((t) => count(t, fresh.orgId)))).toEqual(freshRows);
    expect(await storedFiles(path.join(blobDir, fresh.orgId))).toBe(freshFiles);

    expect(await purgeSampleAccounts()).toEqual({ purged: 0, failed: 0 });
  });
});
