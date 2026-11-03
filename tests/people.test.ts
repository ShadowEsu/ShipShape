import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DocumentPage from "@/app/app/documents/[id]/page";
import PersonPage from "@/app/app/people/[id]/page";
import { addPersonAction, deletePersonAction, keepSignerAction } from "@/app/app/people/actions";
import PeoplePage from "@/app/app/people/page";
import { searchPeopleAction } from "@/app/app/search-actions";
import { exportWorkspace } from "@/lib/server/account";
import { csvCell } from "@/lib/server/csv";
import { asAnon, asService, asUser } from "@/lib/server/db";
import { PEOPLE_FULL } from "@/lib/server/limits";
import { migrate, type MigrationStep } from "@/lib/server/migrations";
import { addPerson, deletePerson, editPerson, getPerson, KEEP_GONE, keepSigner, listPeople, PERSON_NOT_YOURS, searchPeople } from "@/lib/server/people";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { actionsOf, renderPage, textOf } from "./support/render";

/**
 * People (0046): the contacts a workspace keeps on purpose (spec-people-2026-11-03, Security's ruling P1-P5). Each policy
 * and database rule has a test here that fails when it's taken away (the PR lists each mutant and the test it fails).
 */

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
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.46" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  RedirectType: { push: "push", replace: "replace" },
  usePathname: () => "/app",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: TestDb;
let blobDir: string;

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-people-"));
  setBlobStoreForTests(localBlobStore(blobDir));
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/permission denied|row-level security/i);
}

/** A new person in a new workspace of their own (its owner), signed in (the cookie jar) like the sign-in page does. */
async function signIn(email: string): Promise<Ctx> {
  await finishSignIn(await createLocalUser(email, false), { demo: false });
  return requireWorkspace();
}

/** Another person added to `ctx`'s workspace with `role` (not signed in). */
async function member(ctx: Ctx, email: string, role: "member" | "admin" | "owner" = "member"): Promise<Ctx> {
  const userId = await db.user(email);
  await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, $3)", [ctx.orgId, userId, role]));
  return { userId, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: ctx.orgId, name: ctx.name, role, today: isoToday() };
}

/** A document with one version (so its page has the signature form), straight into the database. */
async function addDoc(ctx: Ctx, title: string, kind = "nda", status = "active"): Promise<string> {
  const [d] = await db.root((tx) =>
    tx.query<{ id: string }>("insert into app.documents (org_id, title, kind, status, created_by) values ($1, $2, $3, $4, $5) returning id", [ctx.orgId, title, kind, status, ctx.userId]),
  );
  await db.root((tx) =>
    tx.query(
      "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, created_by) values ($1, 1, $2, $3, 'application/pdf', 100, $4, 'upload', $5)",
      [d.id, ctx.orgId, `${ctx.orgId}/${d.id}/1.pdf`, "a".repeat(64), ctx.userId],
    ),
  );
  return d.id;
}

/** A signature request the owner typed `name` and `email` into, straight into the database (no PDF build). */
async function addRequest(ctx: Ctx, documentId: string, name: string, email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.root((tx) =>
    tx.query(
      `insert into app.signature_requests (id, org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, created_by, to_sign_path, to_sign_sha256)
       values ($1, $2, $3, 1, $4, $5, $6, now() + interval '7 days', $7, $8, $9)`,
      [id, ctx.orgId, documentId, name, email, crypto.randomUUID().replaceAll("-", "").repeat(2), ctx.userId, `${ctx.orgId}/${id}/v1.pdf`, "d".repeat(64)],
    ),
  );
  return id;
}

/** A contact inserted directly, as `ctx` under row level security (bypassing the app's checks). */
const insertAs = (ctx: Ctx, orgId: string, name: string, email: string | null = null, createdBy = ctx.userId) =>
  asUser(ctx.userId, (tx) =>
    tx.query<{ id: string }>("insert into app.contacts (org_id, name, email, source, created_by) values ($1, $2, $3, 'typed', $4) returning id", [orgId, name, email, createdBy]),
  );

/**
 * A contact inserted directly without RETURNING, for the refusals: with RETURNING the select policy would refuse a row
 * the caller can't read, hiding whether the insert policy itself held.
 */
const plant = (ctx: Ctx, orgId: string, createdBy = ctx.userId) =>
  asUser(ctx.userId, (tx) => tx.query("insert into app.contacts (org_id, name, source, created_by) values ($1, 'Planted', 'typed', $2)", [orgId, createdBy]));

const contactsOf = (orgId: string) =>
  db.root((tx) =>
    tx.query<{ name: string; email: string | null; company: string | null; source: string; created_by: string | null }>(
      "select name, email, company, source, created_by from app.contacts where org_id = $1 order by name",
      [orgId],
    ),
  );

/** Fills a workspace with `n` contacts as the superuser (row level security off, the triggers still on). */
const fill = (ctx: Ctx, n: number) =>
  db.root((tx) =>
    tx.query("insert into app.contacts (org_id, name, source, created_by) select $1, 'Person ' || g, 'typed', $2 from generate_series(1, $3::int) g", [ctx.orgId, ctx.userId, n]),
  );

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

/** The workspace export's files, by name, as text. */
async function exported(ctx: Ctx, name: string): Promise<Record<string, string>> {
  const file = path.join(blobDir, `${name}.zip`);
  await writeFile(file, (await exportWorkspace(ctx)).bytes);
  const names = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
  return Object.fromEntries(names.filter((n) => !n.includes("/")).map((n) => [n, execFileSync("unzip", ["-p", file, n]).toString()]));
}

describe("the database's own rules (P3, P4)", () => {
  it("P3: refuses an over-length name, email or company, a control character, a malformed email and an unknown source, through db.root and asUser", async () => {
    const ctx = await signIn("people-checks@example.com");
    const root = (cols: Record<string, string | null>) =>
      db.root((tx) =>
        tx.query("insert into app.contacts (org_id, name, email, company, source, created_by) values ($1, $2, $3, $4, $5, $6)", [
          ctx.orgId,
          cols.name ?? "Jordan",
          cols.email ?? null,
          cols.company ?? null,
          cols.source ?? "typed",
          ctx.userId,
        ]),
      );
    await expect(root({ name: "n".repeat(121) })).rejects.toThrow(/contacts_name_check/);
    await expect(root({ name: "" })).rejects.toThrow(/contacts_name_check/);
    await expect(root({ name: "Jordan\u0007" })).rejects.toThrow(/contacts_name_check/);
    await expect(root({ email: `${"e".repeat(190)}@example.com` })).rejects.toThrow(/contacts_email_check/);
    await expect(root({ email: "not an email" })).rejects.toThrow(/contacts_email_check/);
    await expect(root({ company: "c".repeat(121) })).rejects.toThrow(/contacts_company_check/);
    await expect(root({ company: "" })).rejects.toThrow(/contacts_company_check/);
    await expect(root({ source: "imported" })).rejects.toThrow(/contacts_source_check/);
    // The same refusals for a member writing straight to the table.
    await expect(
      asUser(ctx.userId, (tx) => tx.query("insert into app.contacts (org_id, name, source, created_by) values ($1, $2, 'typed', $3)", [ctx.orgId, "n".repeat(121), ctx.userId])),
    ).rejects.toThrow(/contacts_name_check/);
    await expect(
      asUser(ctx.userId, (tx) => tx.query("insert into app.contacts (org_id, name, source, created_by) values ($1, 'Jordan', 'mined', $2)", [ctx.orgId, ctx.userId])),
    ).rejects.toThrow(/contacts_source_check/);
    // At the limits, all fine.
    await root({ name: "n".repeat(120), email: `${"e".repeat(188)}@example.com`, company: "c".repeat(120), source: "signer" });
    expect(await contactsOf(ctx.orgId)).toHaveLength(1);
  });

  it("P3: an update can't change created_by (or org_id), even for the owner; name, email and company can", async () => {
    const ctx = await signIn("people-created-by@example.com");
    const other = await signIn("people-created-by-other@example.com");
    const [c] = await insertAs(ctx, ctx.orgId, "Jordan Lee", "jordan@northwind.example");
    await expectDenied(asUser(ctx.userId, (tx) => tx.query("update app.contacts set created_by = $2 where id = $1", [c.id, other.userId])));
    await expectDenied(asUser(ctx.userId, (tx) => tx.query("update app.contacts set created_by = null where id = $1", [c.id])));
    await expectDenied(asUser(ctx.userId, (tx) => tx.query("update app.contacts set source = 'sample' where id = $1", [c.id])));
    await expectDenied(asUser(ctx.userId, (tx) => tx.query("update app.contacts set org_id = $2 where id = $1", [c.id, other.orgId])));
    // forbid_org_change holds even where the grant doesn't apply.
    await expect(db.root((tx) => tx.query("update app.contacts set org_id = $2 where id = $1", [c.id, other.orgId]))).rejects.toThrow(/org_id cannot change/);
    await asUser(ctx.userId, (tx) => tx.query("update app.contacts set name = 'Jordan L.', company = 'Northwind' where id = $1", [c.id]));
    expect(await contactsOf(ctx.orgId)).toEqual([{ name: "Jordan L.", email: "jordan@northwind.example", company: "Northwind", source: "typed", created_by: ctx.userId }]);
  });

  it("P3: created_by goes to null when its person is deleted, and the workspace keeps the contact", async () => {
    const owner = await signIn("people-fk-owner@example.com");
    const m = await member(owner, "people-fk-member@example.com");
    await insertAs(m, owner.orgId, "Dana Kim");
    await db.root((tx) => tx.query("delete from auth.users where id = $1", [m.userId]));
    expect(await contactsOf(owner.orgId)).toEqual([{ name: "Dana Kim", email: null, company: null, source: "typed", created_by: null }]);
  });

  it("one address is one contact per workspace, whatever its case; another workspace may keep the same address", async () => {
    const ctx = await signIn("people-unique@example.com");
    const other = await signIn("people-unique-other@example.com");
    await insertAs(ctx, ctx.orgId, "Jordan Lee", "jordan@northwind.example");
    await expect(insertAs(ctx, ctx.orgId, "J. Lee", "Jordan@Northwind.example")).rejects.toThrow(/contacts_email_idx|duplicate key/);
    await insertAs(other, other.orgId, "Jordan Lee", "jordan@northwind.example");
    // No email: as many as you like.
    await insertAs(ctx, ctx.orgId, "Sam");
    await insertAs(ctx, ctx.orgId, "Sam");
  });

  it("P4: the 501st insert, made straight to the table under asUser and bypassing the app, fails", async () => {
    const ctx = await signIn("people-cap@example.com");
    await fill(ctx, 499);
    await insertAs(ctx, ctx.orgId, "The 500th");
    await expect(insertAs(ctx, ctx.orgId, "The 501st")).rejects.toThrow(/at most 500 contacts/);
    expect((await contactsOf(ctx.orgId)).length).toBe(500);
    // Another workspace has its own 500.
    const other = await signIn("people-cap-other@example.com");
    await insertAs(other, other.orgId, "First");
  });

  it("P4: the cap's count runs under a per-workspace advisory lock, so two inserts at once can't both take the last place", async () => {
    const ctx = await signIn("people-cap-lock@example.com");
    const locks = await asUser(ctx.userId, async (tx) => {
      const held = () => tx.query<{ n: number }>("select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()");
      const before = (await held())[0].n;
      await tx.query("insert into app.contacts (org_id, name, source, created_by) values ($1, 'Jordan', 'typed', $2)", [ctx.orgId, ctx.userId]);
      return { before, after: (await held())[0].n };
    });
    expect(locks).toEqual({ before: 0, after: 1 });
  });

  it("writes contact.added, contact.updated and contact.deleted to the history with the actor and the contact's id only, never the name or email", async () => {
    const ctx = await signIn("people-audit@example.com");
    const id = await addPerson(ctx, { name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind" });
    await editPerson(ctx, id, { name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind" }); // nothing changed: no row
    await editPerson(ctx, id, { name: "Jordan L.", email: "jordan@northwind.example", company: "" });
    await deletePerson(ctx, id);
    const rows = await db.root((tx) =>
      tx.query<Record<string, unknown>>("select action, actor, object_id, detail_sha256, about from app.audit_log where org_id = $1 and action like 'contact.%' order by seq", [ctx.orgId]),
    );
    expect(rows).toEqual(
      ["contact.added", "contact.updated", "contact.deleted"].map((action) => ({ action, actor: ctx.userId, object_id: id, detail_sha256: null, about: null })),
    );
    const all = JSON.stringify(await db.root((tx) => tx.query("select * from app.audit_log where org_id = $1", [ctx.orgId])));
    expect(all).not.toMatch(/Jordan|northwind/i);
    expect(await asUser(ctx.userId, (tx) => tx.query<{ bad: string | null }>("select app.audit_verify($1) as bad", [ctx.orgId]))).toEqual([{ bad: null }]);
  });
});

describe("who sees and changes People (row level security)", () => {
  it("someone in another workspace sees 0 rows on the page, in search and in the export, and can't insert into the first workspace", async () => {
    const a = await signIn("people-tenant-a@example.com");
    await addPerson(a, { name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind Builders" });
    const b = await signIn("people-tenant-b@example.com");

    expect(await listPeople(b)).toEqual([]);
    expect(await asUser(b.userId, (tx) => tx.query("select * from app.contacts"))).toEqual([]);
    expect(await asUser(b.userId, (tx) => tx.query("select * from app.contacts where org_id = $1", [a.orgId]))).toEqual([]);
    expect(await searchPeople(b, "Jordan")).toEqual([]);
    expect(await searchPeople(b, "Northwind")).toEqual([]);
    expect(await searchPeopleAction("Jordan")).toEqual([]);
    expect(textOf(await renderPage(PeoplePage, { searchParams: Promise.resolve({}) }))).toContain("Nobody here yet");
    const [contact] = await db.root((tx) => tx.query<{ id: string }>("select id from app.contacts where org_id = $1", [a.orgId]));
    expect(await getPerson(b, contact.id)).toBeNull();
    await expect(renderPage(PersonPage, { params: Promise.resolve({ id: contact.id }), searchParams: Promise.resolve({}) })).rejects.toThrow("not found");
    expect((await exported(b, "people-tenant-b"))["contacts.csv"]).toBe("name,email,company,source,created_at");

    // Into A's workspace: as B, or in A's name.
    await expectDenied(plant(b, a.orgId));
    await expectDenied(plant(b, a.orgId, a.userId));
    // In B's own workspace, but in someone else's name.
    await expectDenied(plant(b, b.orgId, a.userId));
    await expectDenied(asAnon((tx) => tx.query("select 1 from app.contacts")));
    await expectDenied(asAnon((tx) => tx.query("insert into app.contacts (org_id, name, source) values ($1, 'x', 'typed')", [a.orgId])));
    // Nor change or delete A's.
    expect(await asUser(b.userId, (tx) => tx.query("update app.contacts set name = 'x' where id = $1 returning 1", [contact.id]))).toEqual([]);
    expect(await asUser(b.userId, (tx) => tx.query("delete from app.contacts returning 1"))).toEqual([]);
    expect((await contactsOf(a.orgId)).map((c) => c.name)).toEqual(["Jordan Lee"]);
  });

  it("two members of one workspace both read emails (pinned, per Security's ruling)", async () => {
    const owner = await signIn("people-emails-owner@example.com");
    const m = await member(owner, "people-emails-member@example.com");
    await addPerson(owner, { name: "Jordan Lee", email: "jordan@northwind.example" });
    await addPerson(m, { name: "Dana Kim", email: "dana@bayside.example" });
    for (const who of [owner, m]) {
      expect((await listPeople(who)).map((p) => [p.name, p.email])).toEqual([
        ["Dana Kim", "dana@bayside.example"],
        ["Jordan Lee", "jordan@northwind.example"],
      ]);
    }
  });

  it("a plain member can't edit or delete another member's contact; they can their own; an owner or admin can any", async () => {
    const owner = await signIn("people-change-owner@example.com");
    const m = await member(owner, "people-change-member@example.com");
    const admin = await member(owner, "people-change-admin@example.com", "admin");
    const ownersId = await addPerson(owner, { name: "Jordan Lee" });
    const membersId = await addPerson(m, { name: "Dana Kim" });

    // The member, straight to the table: nothing changes, with or without a WHERE.
    expect(await asUser(m.userId, (tx) => tx.query("update app.contacts set name = 'x' where id = $1 returning 1", [ownersId]))).toEqual([]);
    expect(await asUser(m.userId, (tx) => tx.query("delete from app.contacts where id = $1 returning 1", [ownersId]))).toEqual([]);
    expect(await asUser(m.userId, (tx) => tx.query<{ id: string }>("update app.contacts set company = 'x' returning id"))).toEqual([{ id: membersId }]);
    expect(await asUser(m.userId, (tx) => tx.query<{ id: string }>("delete from app.contacts returning id"))).toEqual([{ id: membersId }]);
    // Through the app: words, not a silent no-op.
    await expect(editPerson(m, ownersId, { name: "x" })).rejects.toThrow(PERSON_NOT_YOURS);
    await expect(deletePerson(m, ownersId)).rejects.toThrow(PERSON_NOT_YOURS);
    expect((await listPeople(m)).map((p) => [p.name, p.canChange])).toEqual([["Jordan Lee", false]]);

    // The member's own: theirs to change and delete.
    const again = await addPerson(m, { name: "Dana Kim" });
    await editPerson(m, again, { name: "Dana K." });
    expect((await listPeople(m)).find((p) => p.id === again)).toMatchObject({ name: "Dana K.", canChange: true });

    // An admin and the owner: anyone's.
    await editPerson(admin, again, { name: "Dana Kim", company: "Bayside Drywall" });
    expect(await asUser(admin.userId, (tx) => tx.query("update app.contacts set name = 'Jordan L.' where id = $1 returning 1", [ownersId]))).toHaveLength(1);
    await deletePerson(owner, again);
    expect(await asUser(admin.userId, (tx) => tx.query("delete from app.contacts where id = $1 returning 1", [ownersId]))).toHaveLength(1);
    expect(await contactsOf(owner.orgId)).toEqual([]);
  });

  it("someone who left the workspace can't change what they added", async () => {
    const owner = await signIn("people-left-owner@example.com");
    const m = await member(owner, "people-left-member@example.com");
    const id = await addPerson(m, { name: "Dana Kim" });
    await db.root((tx) => tx.query("delete from app.members where org_id = $1 and user_id = $2", [owner.orgId, m.userId]));
    expect(await asUser(m.userId, (tx) => tx.query("select 1 from app.contacts"))).toEqual([]);
    // Without a WHERE or RETURNING only the delete policy decides (the select policy applies once a column is read).
    await asUser(m.userId, (tx) => tx.query("delete from app.contacts"));
    expect((await contactsOf(owner.orgId)).map((c) => c.name)).toEqual(["Dana Kim"]);
    await expectDenied(plant(m, owner.orgId));
  });
});

describe("Keep in People (P2)", () => {
  it("copies only the owner-typed name and email of this workspace's request; another workspace's id, or none, creates nothing", async () => {
    const a = await signIn("people-keep-a@example.com");
    const doc = await addDoc(a, "Mutual NDA");
    const request = await addRequest(a, doc, "Jordan Lee", "jordan@northwind.example");
    // What the signer typed is on the request too; it never goes to People.
    await db.root((tx) => tx.query("update app.signature_requests set signed_name = 'Someone Else' where id = $1", [request]));

    const b = await signIn("people-keep-b@example.com");
    await expect(keepSigner(b, request)).rejects.toThrow(KEEP_GONE);
    await expect(keepSigner(b, crypto.randomUUID())).rejects.toThrow(KEEP_GONE);
    await expect(keepSigner(b, "not-an-id")).rejects.toThrow(KEEP_GONE);
    // Through the form: the same neutral words on People, whichever it was.
    await expect(keepSignerAction(form({ request }))).rejects.toThrow("redirect /app/people?error=keep");
    await expect(keepSignerAction(form({ request: crypto.randomUUID() }))).rejects.toThrow("redirect /app/people?error=keep");
    expect(textOf(await renderPage(PeoplePage, { searchParams: Promise.resolve({ error: "keep" }) }))).toContain(KEEP_GONE);
    expect(await contactsOf(a.orgId)).toEqual([]);
    expect(await contactsOf(b.orgId)).toEqual([]);

    // In A's workspace: the form's other fields are ignored; the request's own name and email are kept.
    await finishSignIn(a.userId, { demo: false });
    await expect(keepSignerAction(form({ request, name: "Planted", email: "planted@example.com", company: "Planted" }))).rejects.toThrow(`redirect /app/documents/${doc}`);
    expect(await contactsOf(a.orgId)).toEqual([{ name: "Jordan Lee", email: "jordan@northwind.example", company: null, source: "signer", created_by: a.userId }]);

    // Kept already (the same address on another request, any case): says so and adds nothing.
    const again = await addRequest(a, doc, "J. Lee", "Jordan@Northwind.example");
    expect(await keepSigner(a, again)).toMatchObject({ kept: "already", name: "Jordan Lee", documentId: doc });
    await expect(keepSignerAction(form({ request: again }))).rejects.toThrow(`redirect /app/documents/${doc}?kept=already`);
    expect(await contactsOf(a.orgId)).toHaveLength(1);
  });

  it("the redesigned document page offers Keep in People beside each signer, posting only the request's id, then shows In People", async () => {
    const ctx = await signIn("people-keep-page@example.com");
    const doc = await addDoc(ctx, "Mutual NDA");
    const request = await addRequest(ctx, doc, "Jordan Lee", "jordan@northwind.example");
    const page = () => renderPage(DocumentPage, { params: Promise.resolve({ id: doc }), searchParams: Promise.resolve({}) });
    const html = await page();
    const keep = /<form[^>]*>((?:(?!<\/form>)[\s\S])*?Keep in People[\s\S]*?)<\/form>/.exec(html)?.[1] ?? "";
    expect([...keep.matchAll(/<input[^>]*name="([^"]*)"[^>]*>/g)].map((m) => m[1])).toEqual(["request"]);
    expect(keep).toContain(`value="${request}"`);
    expect(textOf(html)).not.toContain("In People");
    await keepSigner(ctx, request);
    const after = textOf(await page());
    expect(after).toContain("In People");
    expect(after).not.toContain("Keep in People");
    // The earlier look has no such button.
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(await page()).not.toContain("Keep in People");
  });
});

describe("signature request counts", () => {
  it("count this workspace's requests to exactly that email on active documents: not an archived document's, not another email's", async () => {
    const ctx = await signIn("people-counts@example.com");
    const id = await addPerson(ctx, { name: "Jordan Lee", email: "jordan@northwind.example" });
    await addPerson(ctx, { name: "No Email" });
    const active = await addDoc(ctx, "Mutual NDA");
    const archived = await addDoc(ctx, "Old agreement", "agreement", "archived");
    const counted = await addRequest(ctx, active, "Jordan Lee", "Jordan@northwind.example");
    await addRequest(ctx, archived, "Jordan Lee", "jordan@northwind.example");
    await addRequest(ctx, active, "Jordan Lee", "jordan.lee@northwind.example");
    await addRequest(ctx, active, "Jordan Lee", "jordan@northwind.example.com");
    // Another workspace's request to the same address.
    const other = await signIn("people-counts-other@example.com");
    await addRequest(other, await addDoc(other, "Their NDA"), "Jordan Lee", "jordan@northwind.example");

    expect((await listPeople(ctx)).map((p) => [p.name, p.requests])).toEqual([
      ["Jordan Lee", 1],
      ["No Email", 0],
    ]);
    const got = await getPerson(ctx, id);
    expect(got?.requests.map((r) => [r.id, r.documentId, r.title])).toEqual([[counted, active, "Mutual NDA"]]);
    await finishSignIn(ctx.userId, { demo: false });
    expect(textOf(await renderPage(PeoplePage, { searchParams: Promise.resolve({}) }))).toContain("Jordan Lee jordan@northwind.example · Signature requests: 1");
    const person = await renderPage(PersonPage, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    const links = actionsOf(person).filter((a) => a.href?.endsWith("#signatures"));
    expect(links.map((a) => a.href)).toEqual([`/app/documents/${active}#signatures`]);
    expect(links[0].label).toMatch(/^Mutual NDA Waiting · asked /);
    // Restored, the archived document's request counts again.
    await db.root((tx) => tx.query("update app.documents set status = 'active' where id = $1", [archived]));
    expect((await listPeople(ctx))[0].requests).toBe(2);
  });
});

describe("export (P1)", () => {
  it("csvCell puts a ' before a cell that starts like a formula, then quotes as before", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1 555 0100")).toBe("'+1 555 0100");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe(`"'\rcmd"`);
    expect(csvCell("Jordan Lee")).toBe("Jordan Lee");
    expect(csvCell("Lee, Jordan")).toBe(`"Lee, Jordan"`);
    expect(csvCell('Say "hi"')).toBe(`"Say ""hi"""`);
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("")).toBe("");
    expect(csvCell(null)).toBe("");
  });

  it('a contact named =HYPERLINK("x") comes out as \'=HYPERLINK(...) in contacts.csv, and history.csv neutralises the same way', async () => {
    const ctx = await signIn("people-export@example.com");
    await addPerson(ctx, { name: '=HYPERLINK("x")', email: "jordan@northwind.example", company: "@Northwind" });
    await addPerson(ctx, { name: "Dana Kim", company: "Bayside Drywall" });
    // No history cell can start like a formula today (actions are checked words, the rest ids, times and hashes), so this
    // plants one past the check, as the superuser, to prove history.csv goes through the same writer.
    await db.root(async (tx) => {
      await tx.query("alter table app.audit_log drop constraint audit_log_action_check");
      await tx.query("select app.audit_write($1, null, $2, null)", [ctx.orgId, '=HYPERLINK("x")']);
      await tx.query("alter table app.audit_log add constraint audit_log_action_check check (action ~ '^[a-z]+(\\.[a-z_]+)+$' and length(action) <= 60) not valid");
    });
    const files = await exported(ctx, "people-export");
    const contacts = files["contacts.csv"].split("\n");
    expect(contacts[0]).toBe("name,email,company,source,created_at");
    expect(contacts.slice(1).map((l) => l.replace(/,[^,]*$/, ""))).toEqual([`"'=HYPERLINK(""x"")",jordan@northwind.example,'@Northwind,typed`, "Dana Kim,,Bayside Drywall,typed"]);
    expect(files["history.csv"]).toContain(`,"'=HYPERLINK(""x"")",`);
    expect(files["history.csv"]).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(files["README.txt"]).toContain("\ncontacts.csv ");
  });
});

describe("search (§8)", () => {
  it("finds this workspace's people by name and company, never by email, six at most, with LIKE's wildcards as plain characters", async () => {
    const ctx = await signIn("people-search@example.com");
    await addPerson(ctx, { name: "Jordan Lee", email: "jordan@harbor.example", company: "Northwind Builders" });
    await addPerson(ctx, { name: "Dana Kim", email: "dana@northwind-mail.example", company: "Bayside Drywall" });
    await addPerson(ctx, { name: "100% Sam" });
    expect((await searchPeople(ctx, "jordan")).map((p) => p.name)).toEqual(["Jordan Lee"]);
    expect((await searchPeople(ctx, "northwind")).map((p) => p.name)).toEqual(["Jordan Lee"]);
    expect(await searchPeople(ctx, "harbor.example")).toEqual([]);
    expect(await searchPeople(ctx, "@")).toEqual([]);
    expect((await searchPeople(ctx, "%")).map((p) => p.name)).toEqual(["100% Sam"]);
    expect(await searchPeople(ctx, "_")).toEqual([]);
    expect(await searchPeople(ctx, "  ")).toEqual([]);
    expect(await searchPeopleAction("bayside")).toEqual([{ id: expect.any(String), title: "Dana Kim", line: "Bayside Drywall" }]);
    expect(await searchPeopleAction({ q: "dana" })).toEqual([]);
    await fill(ctx, 10);
    expect(await searchPeople(ctx, "Person")).toHaveLength(6);
  });
});

describe("pages and forms", () => {
  const peoplePage = (searchParams: { error?: string } = {}) => renderPage(PeoplePage, { searchParams: Promise.resolve(searchParams) });
  const personPage = (id: string, searchParams: { error?: string } = {}) => renderPage(PersonPage, { params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

  it("People with nobody in it says how to add someone, in both looks, with the Add a person form", async () => {
    await signIn("people-page-empty@example.com");
    for (const look of ["", "v1"]) {
      vi.stubEnv("SHIPSHAPE_UI", look);
      const html = await peoplePage();
      const text = textOf(html);
      expect(text).toContain("People People you keep in touch with for documents.");
      expect(text).toContain(
        "Nobody here yet Add a person below with their name, and an email and company if you like. On a document's page you can also tap Keep in People beside a signer.",
      );
      expect(text).toContain("Add a person");
      expect(html).toMatch(/<input[^>]*name="name"/);
      expect(text).toContain("Add person");
    }
  });

  it("lists people A to Z as hairline rows: name, then company · email · Signature requests: N", async () => {
    const ctx = await signIn("people-page-list@example.com");
    const jordan = await addPerson(ctx, { name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind Builders" });
    const dana = await addPerson(ctx, { name: "dana Kim" });
    const html = await peoplePage();
    expect(html).toContain('<ul class="hair-list">');
    expect(actionsOf(html).filter((a) => a.href?.startsWith("/app/people/"))).toEqual([
      { tag: "a", label: "dana Kim Signature requests: 0", href: `/app/people/${dana}` },
      { tag: "a", label: "Jordan Lee Northwind Builders · jordan@northwind.example · Signature requests: 0", href: `/app/people/${jordan}` },
    ]);
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(textOf(await peoplePage())).toContain("Jordan Lee Northwind Builders · jordan@northwind.example · Signature requests: 0");
  });

  it("Add a person adds through the form and opens their page; a bad email is named at its field; a full workspace says so", async () => {
    const ctx = await signIn("people-page-add@example.com");
    await expect(addPersonAction({}, form({ name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind" }))).rejects.toThrow(/^redirect \/app\/people\/[0-9a-f-]{36}$/);
    expect(await contactsOf(ctx.orgId)).toEqual([{ name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind", source: "typed", created_by: ctx.userId }]);
    expect(await addPersonAction({}, form({ name: "Dana", email: "dana at bayside", company: "" }))).toEqual({
      fieldErrors: { email: "That email address doesn't look right. Check it, or leave the field empty." },
      values: { name: "Dana", email: "dana at bayside", company: "" },
    });
    expect(await addPersonAction({}, form({ name: "", email: "", company: "" }))).toMatchObject({ fieldErrors: { name: "Give the person a name." } });
    expect(await addPersonAction({}, form({ name: "J. Lee", email: "JORDAN@northwind.example", company: "" }))).toMatchObject({
      error: "That email is already in People, as Jordan Lee. Nothing was added.",
    });
    await fill(ctx, 499);
    expect(await addPersonAction({}, form({ name: "One more", email: "", company: "" }))).toMatchObject({ error: PEOPLE_FULL });
    expect((await contactsOf(ctx.orgId)).length).toBe(500);
  });

  it("a person's page: details, requests to their documents, Edit and Delete for whoever may, and Ask to sign by the person's id only", async () => {
    const ctx = await signIn("people-page-person@example.com");
    const id = await addPerson(ctx, { name: "Jordan Lee", email: "jordan@northwind.example", company: "Northwind Builders" });
    const nda = await addDoc(ctx, "Mutual NDA");
    await addDoc(ctx, "Form W-9", "w9");
    await addDoc(ctx, "Old agreement", "agreement", "archived");
    const html = await personPage(id);
    const text = textOf(html);
    expect(text).toContain("Jordan Lee Northwind Builders · jordan@northwind.example");
    expect(text).toContain("Signature requests: 0 No signature requests to this email yet.");
    // Ask to sign: the active documents that get signed, each to its page with the person's id, never their email.
    const asks = actionsOf(html).filter((a) => a.href?.includes("person="));
    expect(asks).toEqual([{ tag: "a", label: "Mutual NDA", href: `/app/documents/${nda}?person=${id}#signer-name` }]);
    expect(html).not.toMatch(/href="[^"]*jordan%40|href="[^"]*jordan@/);
    expect(text).toContain("Edit");
    expect(actionsOf(html).map((a) => a.label)).toContain("Delete from People");
    // The earlier look offers every active document with a file.
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(actionsOf(await personPage(id)).filter((a) => a.href?.includes("person=")).map((a) => a.label)).toEqual(["Form W-9", "Mutual NDA"]);
    vi.stubEnv("SHIPSHAPE_UI", "");

    // A plain member sees the person, but not Edit or Delete for someone they didn't add.
    const m = await member(ctx, "people-page-person-member@example.com");
    await finishSignIn(m.userId, { demo: false });
    const theirs = await personPage(id);
    expect(textOf(theirs)).toContain(PERSON_NOT_YOURS);
    expect(actionsOf(theirs).map((a) => a.label)).not.toContain("Delete from People");
    await expect(deletePersonAction(form({ id }))).rejects.toThrow(`redirect /app/people/${id}?error=change`);
    expect(await contactsOf(ctx.orgId)).toHaveLength(1);
  });

  it("Ask to sign opens the document's request form with the person's name and email filled in, read under row level security", async () => {
    const ctx = await signIn("people-page-ask@example.com");
    const id = await addPerson(ctx, { name: "Jordan Lee", email: "jordan@northwind.example" });
    const nda = await addDoc(ctx, "Mutual NDA");
    const field = (html: string, name: string) => new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
    const page = (person?: string) => renderPage(DocumentPage, { params: Promise.resolve({ id: nda }), searchParams: Promise.resolve(person ? { person } : {}) });
    for (const look of ["", "v1"]) {
      vi.stubEnv("SHIPSHAPE_UI", look);
      const html = await page(id);
      expect(field(html, "signer_name")).toContain('value="Jordan Lee"');
      expect(field(html, "signer_email")).toContain('value="jordan@northwind.example"');
      expect(field(await page(), "signer_name")).not.toContain("value=");
    }
    // Another workspace's person fills in nothing.
    const other = await signIn("people-page-ask-other@example.com");
    const theirs = await addPerson(other, { name: "Dana Kim", email: "dana@bayside.example" });
    await finishSignIn(ctx.userId, { demo: false });
    expect(field(await page(theirs), "signer_email")).not.toContain("value=");
  });

  it("Delete takes the person out of People and leaves their signature requests as they were", async () => {
    const ctx = await signIn("people-page-delete@example.com");
    const id = await addPerson(ctx, { name: "Jordan Lee", email: "jordan@northwind.example" });
    const doc = await addDoc(ctx, "Mutual NDA");
    const request = await addRequest(ctx, doc, "Jordan Lee", "jordan@northwind.example");
    await expect(deletePersonAction(form({ id }))).rejects.toThrow("redirect /app/people");
    expect(await contactsOf(ctx.orgId)).toEqual([]);
    expect(await db.root((tx) => tx.query("select signer_name, signer_email from app.signature_requests where id = $1", [request]))).toEqual([
      { signer_name: "Jordan Lee", signer_email: "jordan@northwind.example" },
    ]);
  });

  it("the sample workspace starts with three made-up people, marked (sample), with .example addresses", async () => {
    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    expect(await contactsOf(org.id)).toEqual([
      { name: "Dana Kim (sample)", email: "dana.kim@bayside.example", company: "Bayside Drywall (sample)", source: "sample", created_by: userId },
      { name: "Jordan Lee (sample)", email: "jordan.lee@northwind.example", company: "Northwind Builders (sample)", source: "sample", created_by: userId },
      { name: "Priya Shah (sample)", email: "priya.shah@summit.example", company: "Summit Supply Co. (sample)", source: "sample", created_by: userId },
    ]);
  });
});

describe("rollback", () => {
  it("0046 goes down with its down file and comes back up with npm run migrate's runner (PGlite)", async () => {
    const pg = await PGlite.create();
    try {
      const step = (t: Pick<PGlite, "exec" | "query">): MigrationStep => ({
        exec: async (s) => void (await t.exec(s)),
        query: async (text, params) => (await t.query<Record<string, unknown>>(text, params)).rows,
      });
      const conn = { ...step(pg), transaction: (fn: (t: MigrationStep) => Promise<void>) => pg.transaction((t) => fn(step(t))) };
      // Up to 0046 only, so this keeps proving 0046 once later migrations exist.
      const names = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql") && n <= "0046_contacts.sql").sort();
      expect(names.at(-1)).toBe("0046_contacts.sql");
      const files = await Promise.all(names.map(async (name) => ({ name, sql: await readFile(`supabase/migrations/${name}`, "utf8") })));
      const setup = [await readFile("supabase/platform/plain-postgres.sql", "utf8")];
      const shape = async () =>
        (
          await pg.query<{ t: string | null; policies: number; functions: number }>(
            `select to_regclass('app.contacts')::text as t,
                    (select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'contacts') as policies,
                    (select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace and proname in ('contacts_cap', 'audit_contact_change')) as functions`,
          )
        ).rows[0];
      expect(await migrate(conn, setup, files)).toEqual(names);
      expect(await shape()).toEqual({ t: "app.contacts", policies: 5, functions: 2 });

      // infra/README.md, "Undoing a migration": the down file as the owner, then 0046's row, in one transaction.
      const down = await readFile("supabase/rollback/0046_contacts.down.sql", "utf8");
      await pg.transaction(async (t) => {
        await t.exec("set local role shipshape_owner");
        await t.exec(down);
        await t.query("delete from meta.migrations where name = $1", ["0046_contacts.sql"]);
      });
      expect(await shape()).toEqual({ t: null, policies: 0, functions: 0 });
      expect((await pg.query("select 1 from pg_class where relname like 'contacts%'")).rows).toEqual([]);
      // What 0046 used but didn't make stays.
      expect((await pg.query("select 1 from pg_proc where proname in ('forbid_org_change', 'stamp_update')")).rows).toHaveLength(2);

      expect(await migrate(conn, setup, files)).toEqual(["0046_contacts.sql"]);
      expect(await shape()).toEqual({ t: "app.contacts", policies: 5, functions: 2 });
      expect(await migrate(conn, setup, files)).toEqual([]);
    } finally {
      await pg.close();
    }
  });
});
