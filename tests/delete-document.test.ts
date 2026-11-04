import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentPage from "@/app/app/documents/[id]/page";
import { deleteForGood } from "@/app/app/documents/actions";
import { DELETE_PROMISE } from "@/app/app/documents/messages";
import DocumentsPage from "@/app/app/documents/page";
import { landing, returnTo } from "@/lib/return-to";
import { retryStorageCleanup } from "@/lib/server/account";
import { listHistory } from "@/lib/server/activity";
import { asUser } from "@/lib/server/db";
import { runReminders } from "@/lib/server/deadlines";
import { DELETE_REFUSED, deleteDocument, DOCUMENT_GONE, getDocument, setArchived, uploadDocument, uploadVersion } from "@/lib/server/documents";
import { PlanLimit, UserError } from "@/lib/server/errors";
import { createSignatureRequest, sendSigningCode } from "@/lib/server/esign";
import { FILES_FULL } from "@/lib/server/limits";
import { migrate, type MigrationStep } from "@/lib/server/migrations";
import { createPassport } from "@/lib/server/passport";
import { NeedsRecentSignIn, type Ctx } from "@/lib/server/profile";
import { setSaved } from "@/lib/server/saved";
import { createLocalUser, finishSignIn, RECENT_AUTH_SECONDS, requireWorkspace } from "@/lib/server/session";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { actionsOf, renderPage, textOf } from "./support/render";

/** Delete for good (C17; Security 2026-11-04 0715, answer 1: D1-D6). */

// The request's cookies, as Next.js would hold them.
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.41" }),
}));
// Like Next.js, redirect() and notFound() never return.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  RedirectType: { push: "push", replace: "replace" },
  usePathname: () => "/app/documents",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");
let ONE_PAGE: Uint8Array; // a PDF with a page, which a signature request can be built from
let db: TestDb;
let blobDir: string;

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-delete-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  ONE_PAGE = await doc.save();
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

beforeEach(() => vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1"));
afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Signs a new person in to a new (Free) workspace of their own, the way the sign-in page does. */
async function signIn(email: string): Promise<Ctx> {
  await finishSignIn(await createLocalUser(email, false), { demo: false });
  return requireWorkspace();
}

async function teammate(ctx: Ctx, email: string, role: "member" | "admin"): Promise<Ctx> {
  const userId = await db.user(email);
  await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, $3)", [ctx.orgId, userId, role]));
  return { ...ctx, userId, role };
}

const pro = (ctx: Ctx) => db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, $2, 'active', 'pro')", [ctx.orgId, `cus_${ctx.orgId.slice(0, 8)}`]));
const addDoc = (ctx: Ctx, title: string, kind = "other", bytes: Uint8Array = PDF, expires_on?: string) => uploadDocument(ctx, { title, kind, expires_on }, bytes);
const stored = (p: string) => access(path.join(blobDir, p)).then(
  () => true,
  () => false,
);
const versionPaths = async (id: string) =>
  (await db.root((tx) => tx.query<{ storage_path: string }>("select storage_path from app.document_versions where document_id = $1 order by version", [id]))).map((r) => r.storage_path);
const count = async (sql: string, params: unknown[]) => (await db.root((tx) => tx.query<{ n: number }>(sql, params)))[0].n;
const stale = (ctx: Ctx): Ctx => ({ ...ctx, authAt: Math.floor(Date.now() / 1000) - RECENT_AUTH_SECONDS - 1 });
const inDays = (ctx: Ctx, n: number) => new Date(Date.parse(ctx.today) + n * 86_400_000).toISOString().slice(0, 10);

describe("deleting an archived document", () => {
  it("removes its rows, stored files, link membership, saves, reminders and outbox messages; History keeps one row with no title and the earlier ones read 'a deleted document' (D1, D2)", async () => {
    const ctx = await signIn("delete-all@example.com");
    await pro(ctx);
    const title = "W-9 Jordan Lee 123-45-6789";
    const id = await addDoc(ctx, title, "w9", PDF, inDays(ctx, 5));
    const kept = await addDoc(ctx, "Liability certificate", "coi", PDF, inDays(ctx, 5));
    await uploadVersion(ctx, id, PDF);
    await setSaved(ctx, { kind: "document", id, saved: true });
    const link = await createPassport(ctx, { label: "For Northwind", days: 7, documentIds: [id, kept] });
    // A reminder for each, in the outbox with the title in its text.
    await runReminders(ctx.today, ctx.orgId);
    expect(await count("select count(*)::int as n from app.outbox where document_id = $1 and starts_with(body, $2)", [id, title])).toBe(1);
    await setArchived(ctx, id, true);
    // Archiving took it off the link (0041); put it back on, as if archived before then, so the delete's own removal shows.
    await db.root((tx) => tx.query("insert into app.share_link_documents (link_id, document_id, org_id) values ($1, $2, $3)", [link.id, id, ctx.orgId]));
    const paths = await versionPaths(id);
    expect(paths).toHaveLength(2);
    for (const p of paths) expect(await stored(p)).toBe(true);

    await deleteDocument(ctx, id);

    expect(await getDocument(ctx, id)).toBeNull();
    for (const p of paths) expect(await stored(p)).toBe(false);
    expect(await count("select count(*)::int as n from app.storage_cleanup where path = any($1::text[])", [paths])).toBe(0);
    for (const table of ["document_versions", "share_link_documents", "saved_items", "reminders_sent", "outbox"]) {
      expect(await count(`select count(*)::int as n from app.${table} where document_id = $1`, [id])).toBe(0);
    }
    // The other document keeps everything.
    expect(await count("select count(*)::int as n from app.outbox where document_id = $1", [kept])).toBe(1);
    expect(await count("select count(*)::int as n from app.share_link_documents where document_id = $1", [kept])).toBe(1);
    for (const p of await versionPaths(kept)) expect(await stored(p)).toBe(true);

    // History: one document.deleted row about its id; the title is in no row (the chain never held it) and still verifies.
    expect(await count("select count(*)::int as n from app.audit_log where org_id = $1 and object_id = $2 and action = 'document.deleted'", [ctx.orgId, id])).toBe(1);
    expect(await count("select count(*)::int as n from app.audit_log a where a.org_id = $1 and strpos(to_jsonb(a)::text, $2) > 0", [ctx.orgId, "Jordan"])).toBe(0);
    const [verify] = await asUser(ctx.userId, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1) as broken", [ctx.orgId]));
    expect(verify.broken).toBeNull();
    const { rows } = await listHistory(ctx, { tab: "documents", mine: false, days: 30 });
    expect(JSON.stringify(rows)).not.toContain("Jordan");
    expect(rows.filter((r) => r.what === "Deleted · a document")).toHaveLength(1);
    expect(rows.filter((r) => r.what === "Added to documents · a deleted document")).toHaveLength(1);
    expect(rows.filter((r) => r.what === "Version added · a deleted document")).toHaveLength(2);
    expect(rows.filter((r) => r.what === "Archived · a deleted document")).toHaveLength(1);
    expect(rows.filter((r) => r.what.includes("deleted document")).every((r) => r.href === null)).toBe(true);
    expect(rows.some((r) => r.what === "Added to documents · Liability certificate")).toBe(true);
  });

  it("refuses another workspace's id as not found (even one the person owns), a member, a stale sign-in and a document that isn't archived; nothing changes (D3)", async () => {
    const ctx = await signIn("delete-refused@example.com");
    const id = await addDoc(ctx, "Old permit", "permit");
    const active = await addDoc(ctx, "Current permit", "permit");
    await setArchived(ctx, id, true);
    const other = await signIn("delete-refused-other@example.com");
    const theirs = await addDoc(other, "Their permit", "permit");
    await setArchived(other, theirs, true);
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'owner')", [other.orgId, ctx.userId]));

    await expect(deleteDocument(ctx, theirs)).rejects.toThrow(new UserError(DOCUMENT_GONE));
    await expect(deleteDocument(ctx, "not-a-document")).rejects.toThrow(new UserError(DOCUMENT_GONE));
    // The database's own rule: the document must be in the workspace named, whatever else the caller owns.
    await expect(asUser(ctx.userId, (tx) => tx.query("select * from app.delete_document($1, $2)", [ctx.orgId, theirs]))).rejects.toMatchObject({ code: "SS003" });

    const member = await teammate(ctx, "delete-refused-member@example.com", "member");
    await expect(deleteDocument(member, id)).rejects.toThrow(new UserError(DELETE_REFUSED.role));
    // Never "sign in again" for something they can't do.
    await expect(deleteDocument(stale(member), id)).rejects.toThrow(new UserError(DELETE_REFUSED.role));
    await expect(asUser(member.userId, (tx) => tx.query("select * from app.delete_document($1, $2)", [ctx.orgId, id]))).rejects.toMatchObject({ code: "42501" });

    const old = deleteDocument(stale(ctx), id);
    await expect(old).rejects.toThrow(NeedsRecentSignIn);
    await expect(old).rejects.toThrow(DELETE_REFUSED.reauth);

    await expect(deleteDocument(ctx, active)).rejects.toThrow(new UserError(DELETE_REFUSED.active));

    expect(await getDocument(ctx, id)).not.toBeNull();
    expect(await getDocument(ctx, active)).not.toBeNull();
    expect(await getDocument(other, theirs)).not.toBeNull();
    for (const p of [...(await versionPaths(id)), ...(await versionPaths(theirs))]) expect(await stored(p)).toBe(true);
    expect(await count("select count(*)::int as n from app.audit_log where action = 'document.deleted' and object_id = any($1::uuid[])", [[id, active, theirs]])).toBe(0);
  });

  it("refuses with the reason once anyone has signed; otherwise withdraws an open request first, then deletes it with its file to sign and its code message (D4)", async () => {
    const owner = await signIn("delete-sign@example.com");
    await pro(owner);
    const admin = await teammate(owner, "delete-sign-admin@example.com", "admin");

    const signed = await addDoc(owner, "NDA with Northwind", "nda", ONE_PAGE);
    const request = await createSignatureRequest(owner, { documentId: signed, signerName: "Robin Park", signerEmail: "robin@northwind.example", days: 7 });
    await db.root((tx) => tx.query("update app.signature_requests set status = 'signed', signed_at = now() where id = $1", [request.id]));
    await setArchived(owner, signed, true);
    await expect(deleteDocument(admin, signed)).rejects.toThrow(new UserError(DELETE_REFUSED.signed));
    expect(await getDocument(owner, signed)).not.toBeNull();

    // A signed copy among the versions is enough on its own.
    const copy = await addDoc(owner, "NDA with Fabrikam", "nda");
    await db.root((tx) =>
      tx.query(
        "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin) values ($1, 2, $2, $3, 'application/pdf', 100, $4, 'signed')",
        [copy, owner.orgId, `${owner.orgId}/${copy}/v2.pdf`, "b".repeat(64)],
      ),
    );
    await setArchived(owner, copy, true);
    await expect(deleteDocument(admin, copy)).rejects.toThrow(new UserError(DELETE_REFUSED.signed));

    const open = await addDoc(owner, "NDA with Contoso", "nda", ONE_PAGE);
    const pending = await createSignatureRequest(owner, { documentId: open, signerName: "Sam Ortiz", signerEmail: "sam@contoso.example", days: 7 });
    expect(await sendSigningCode(pending.id, pending.token)).toBe("ok");
    const [{ to_sign_path: toSign }] = await db.root((tx) => tx.query<{ to_sign_path: string }>("select to_sign_path from app.signature_requests where id = $1", [pending.id]));
    expect(await stored(toSign)).toBe(true);
    expect(await count("select count(*)::int as n from app.outbox where document_id = $1 and kind = 'esign_code'", [open])).toBe(1);
    // Archived without archiving's own withdrawal (a request that got in first), so this is the delete's withdrawal.
    await db.root((tx) => tx.query("update app.documents set status = 'archived' where id = $1", [open]));

    await deleteDocument(admin, open);

    const actions = (await db.root((tx) => tx.query<{ action: string; actor: string }>("select action, actor::text as actor from app.audit_log where object_id = $1 order by seq", [open]))).slice(-2);
    expect(actions).toEqual([
      { action: "esign.revoked", actor: admin.userId },
      { action: "document.deleted", actor: admin.userId },
    ]);
    expect(await stored(toSign)).toBe(false);
    expect(await count("select count(*)::int as n from app.signature_requests where document_id = $1", [open])).toBe(0);
    expect(await count("select count(*)::int as n from app.outbox where org_id = $1 and kind = 'esign_code'", [owner.orgId])).toBe(0);
  });

  it("frees Free's 100 MB: the total drops by the deleted document's bytes, and a file refused before fits after (D6)", async () => {
    const ctx = await signIn("delete-free@example.com");
    const id = await addDoc(ctx, "Old lease", "agreement");
    const MAX_ROW = 10 * 1024 * 1024; // the largest size_bytes a version row takes
    // Ten more versions at the row maximum: with the first, past 100 MB.
    await db.root((tx) =>
      tx.query(
        "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin) select $1, g, $2, $4 || g || '.pdf', 'application/pdf', $3, repeat('a', 64), 'upload' from generate_series(2, 11) g",
        [id, ctx.orgId, MAX_ROW, `${ctx.orgId}/${id}/v`],
      ),
    );
    const usage = () => count("select coalesce(sum(size_bytes), 0)::float8 as n from app.document_versions where org_id = $1", [ctx.orgId]);
    const before = await usage();
    expect(before).toBe(10 * MAX_ROW + PDF.length);
    await expect(addDoc(ctx, "New lease", "agreement")).rejects.toThrow(new PlanLimit(FILES_FULL));
    await setArchived(ctx, id, true);

    await deleteDocument(ctx, id);

    expect(before - (await usage())).toBe(10 * MAX_ROW + PDF.length);
    await addDoc(ctx, "New lease", "agreement");
    expect(await usage()).toBe(PDF.length);
  });

  it("files storage can't remove now stay queued, and the daily run removes them; no row points at them meanwhile", async () => {
    const ctx = await signIn("delete-queued@example.com");
    const id = await addDoc(ctx, "Old certificate", "coi");
    await setArchived(ctx, id, true);
    const paths = await versionPaths(id);
    const real = localBlobStore(blobDir);
    setBlobStoreForTests({
      ...real,
      remove: async () => {
        throw new Error("storage is down");
      },
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await deleteDocument(ctx, id);
    } finally {
      setBlobStoreForTests(real);
    }
    expect(logged).toHaveBeenCalledWith("delete document: 1 stored files could not be removed yet; queued for the daily run");
    expect(await getDocument(ctx, id)).toBeNull();
    expect(await count("select count(*)::int as n from app.document_versions where storage_path = any($1::text[])", [paths])).toBe(0);
    expect(await count("select count(*)::int as n from app.storage_cleanup where path = any($1::text[])", [paths])).toBe(1);
    expect(await stored(paths[0])).toBe(true);

    expect(await retryStorageCleanup()).toBeGreaterThanOrEqual(1);
    expect(await stored(paths[0])).toBe(false);
    expect(await count("select count(*)::int as n from app.storage_cleanup where path = any($1::text[])", [paths])).toBe(0);
  });
});

describe("Delete for good on the page (redesigned look only)", () => {
  const documentPage = (id: string) => renderPage(DocumentPage, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };

  it("an archived document offers it to owners and admins, behind a dialog that names the document and says what happens, truthfully (D5)", async () => {
    const ctx = await signIn("delete-page@example.com");
    const id = await addDoc(ctx, "Permit 21", "permit");
    const active = await addDoc(ctx, "Permit 22", "permit");
    await setArchived(ctx, id, true);

    const html = await documentPage(id);
    expect(actionsOf(html).filter((a) => a.label === "Delete for good")).toHaveLength(2);
    expect(html).toMatch(/<dialog[^>]*id="delete-document"/);
    expect(textOf(html)).toContain(`Delete “Permit 21” for good? ${DELETE_PROMISE}`);
    expect(DELETE_PROMISE).toBe("It's gone from ShipShape now, and removed from our storage backups within 7 days.");
    expect(textOf(html)).not.toMatch(/permanent|instant/i);

    expect(actionsOf(await documentPage(active)).some((a) => a.label === "Delete for good")).toBe(false);
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(textOf(await documentPage(id))).not.toContain("Delete for good");
    vi.unstubAllEnvs();

    const member = await teammate(ctx, "delete-page-member@example.com", "member");
    await finishSignIn(member.userId, { demo: false });
    expect(textOf(await documentPage(id))).not.toContain("Delete for good");
  });

  it("the action sends a stale sign-in to sign in again, then deletes and lands on Documents, which says so (D3)", async () => {
    const ctx = await signIn("delete-action@example.com");
    const id = await addDoc(ctx, "Permit 31", "permit");
    await setArchived(ctx, id, true);

    await finishSignIn(ctx.userId, { demo: false, authAt: Math.floor(Date.now() / 1000) - RECENT_AUTH_SECONDS - 1 });
    expect(await deleteForGood({}, form({ id }))).toEqual({ error: DELETE_REFUSED.reauth, reauth: true });
    expect(landing(returnTo("documents"))).toBe("/app/documents?archived=1");
    expect(await getDocument(ctx, id)).not.toBeNull();

    await finishSignIn(ctx.userId, { demo: false });
    expect(await deleteForGood({}, form({ id: "nope" }))).toEqual({ error: DOCUMENT_GONE });
    await expect(deleteForGood({}, form({ id }))).rejects.toThrow("redirect /app/documents?deleted=1");
    expect(await getDocument(ctx, id)).toBeNull();

    const list = textOf(await renderPage(DocumentsPage, { searchParams: Promise.resolve({ deleted: "1" }) }));
    expect(list).toContain(`Document deleted. ${DELETE_PROMISE}`);
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(textOf(await renderPage(DocumentsPage, { searchParams: Promise.resolve({ deleted: "1" }) }))).not.toContain("Document deleted.");
  });
});

describe("rollback", () => {
  it("0048 links outbox rows from before it to their document where exactly one fits, goes down with its down file and comes back up (PGlite)", async () => {
    const pg = await PGlite.create();
    try {
      const step = (t: Pick<PGlite, "exec" | "query">): MigrationStep => ({
        exec: async (s) => void (await t.exec(s)),
        query: async (text, params) => (await t.query<Record<string, unknown>>(text, params)).rows,
      });
      const conn = { ...step(pg), transaction: (fn: (t: MigrationStep) => Promise<void>) => pg.transaction((t) => fn(step(t))) };
      const all = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
      const files = await Promise.all(all.map(async (name) => ({ name, sql: await readFile(`supabase/migrations/${name}`, "utf8") })));
      const setup = [await readFile("supabase/platform/plain-postgres.sql", "utf8")];
      const state = async () => {
        const [row] = (
          await pg.query<{ code: string; column: boolean; del: boolean; fn: boolean }>(
            `select pg_get_functiondef('app.esign_issue_code(uuid, text, text, text, text)'::regprocedure) as code,
                    exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'outbox' and column_name = 'document_id') as column,
                    has_table_privilege('authenticated', 'app.documents', 'DELETE') as del,
                    to_regprocedure('app.delete_document(uuid, uuid)') is not null as fn`,
          )
        ).rows;
        return row;
      };

      const upTo47 = files.filter((f) => f.name <= "0047_audit_request_about.sql");
      expect(upTo47.at(-1)?.name).toBe("0047_audit_request_about.sql");
      await migrate(conn, setup, upTo47);
      const before = await state();
      expect(before).toMatchObject({ column: false, del: true, fn: false });

      // Messages written before 0048, in the words the reminder run and the signing code use.
      const org = "00000000-0000-4000-8000-000000000001";
      const [acme, w9, leaseA, leaseB, nda] = ["11", "12", "13", "14", "15"].map((n) => `00000000-0000-4000-8000-0000000000${n}`);
      await pg.query("insert into app.organizations (id, name) values ($1, 'Harbor')", [org]);
      for (const [id, title, kind] of [
        [acme, "W-9 Acme", "w9"],
        [w9, "W-9", "w9"],
        [leaseA, "Lease", "agreement"],
        [leaseB, "Lease", "agreement"],
        [nda, "NDA with Contoso", "nda"],
      ]) {
        await pg.query("insert into app.documents (id, org_id, title, kind) values ($1, $2, $3, $4)", [id, org, title, kind]);
      }
      await pg.query("insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin) values ($1, 1, $2, $3, 'application/pdf', 100, $4, 'upload')", [
        nda,
        org,
        `${org}/${nda}/v1.pdf`,
        "c".repeat(64),
      ]);
      await pg.query(
        "insert into app.signature_requests (org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, status) values ($1, $2, 1, 'Sam Ortiz', 'sam@contoso.example', $3, now() + interval '7 days', 'revoked')",
        [org, nda, "d".repeat(64)],
      );
      const message = async (kind: string, to: string, body: string) =>
        (await pg.query<{ id: string }>("insert into app.outbox (org_id, to_email, subject, body, kind) values ($1, $2, 's', $3, $4) returning id", [org, to, body, kind])).rows[0].id;
      const acmeMsg = await message("reminder", "o@harbor.example", "W-9 Acme expires in 7 days (Nov 10).\n\nRenew it.");
      const w9Msg = await message("reminder", "o@harbor.example", "W-9 is due for renewal today.\n\nRenew it.");
      const leaseMsg = await message("reminder", "o@harbor.example", "Lease expired on Nov 1.\n\nRenew it.");
      const codeMsg = await message("esign_code", "sam@contoso.example", 'Your code to sign "NDA with Contoso" for Harbor is 123456.');

      const upTo48 = files.filter((f) => f.name <= "0048_delete_document.sql");
      expect(await migrate(conn, setup, upTo48)).toEqual(["0048_delete_document.sql"]);
      expect(await state()).toMatchObject({ column: true, del: false, fn: true });
      const linked = Object.fromEntries((await pg.query<{ id: string; document_id: string | null }>("select id, document_id from app.outbox")).rows.map((r) => [r.id, r.document_id]));
      // Two documents called Lease: nothing says which, so that reminder stays unlinked (and goes in 90 days).
      expect(linked).toEqual({ [acmeMsg]: acme, [w9Msg]: w9, [leaseMsg]: null, [codeMsg]: nda });

      // infra/README.md, "Undoing a migration": the down file as the owner, then 0048's row, in one transaction.
      const down = await readFile("supabase/rollback/0048_delete_document.down.sql", "utf8");
      await pg.transaction(async (t) => {
        await t.exec("set local role shipshape_owner");
        await t.exec(down);
        await t.query("delete from meta.migrations where name = $1", ["0048_delete_document.sql"]);
      });
      expect(await state()).toEqual(before);

      expect(await migrate(conn, setup, upTo48)).toEqual(["0048_delete_document.sql"]);
      expect(await state()).toMatchObject({ column: true, del: false, fn: true });
      expect(await migrate(conn, setup, upTo48)).toEqual([]);
    } finally {
      await pg.close();
    }
  });
});
