import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DocumentPage from "@/app/app/documents/[id]/page";
import PassportDetail from "@/app/app/passport/[id]/page";
import { toggleSaved } from "@/app/app/saved/actions";
import SavedPage from "@/app/app/saved/page";
import { asAnon, asService, asUser } from "@/lib/server/db";
import { migrate, type MigrationStep } from "@/lib/server/migrations";
import { createPassport } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { isSaved, listSaved, SAVED_GONE, setSaved } from "@/lib/server/saved";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { actionsOf, renderPage, textOf } from "./support/render";

/**
 * Saved (0045): a person's own bookmarks to documents and passport links. Saves are personal: nobody else, in
 * the workspace or outside it, sees or changes them, and a save can only point at its own workspace's objects.
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
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.45" }),
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

beforeAll(async () => {
  db = await freshDb();
});

afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/permission denied|row-level security/i);
}

/** A new person in a new workspace of their own, signed in (the cookie jar) like the sign-in page does. */
async function signIn(email: string): Promise<Ctx> {
  await finishSignIn(await createLocalUser(email, false), { demo: false });
  return requireWorkspace();
}

/** Another person added to `ctx`'s workspace as a member (not signed in). */
async function member(ctx: Ctx, email: string): Promise<Ctx> {
  const userId = await db.user(email);
  await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [ctx.orgId, userId]));
  return { userId, demo: false, authAt: 0, orgId: ctx.orgId, name: ctx.name, role: "member", today: isoToday() };
}

async function addDoc(ctx: Ctx, title: string, kind = "w9", expiresOn: string | null = null): Promise<string> {
  const [d] = await asUser(ctx.userId, (tx) =>
    tx.query<{ id: string }>("insert into app.documents (org_id, title, kind, expires_on, created_by) values ($1, $2, $3, $4, $5) returning id", [
      ctx.orgId,
      title,
      kind,
      expiresOn,
      ctx.userId,
    ]),
  );
  return d.id;
}

async function addLink(ctx: Ctx, label: string, docs: string[]): Promise<string> {
  return (await createPassport(ctx, { label, days: 7, documentIds: docs })).id;
}

const save = (ctx: Ctx, kind: "document" | "link", id: string) => setSaved(ctx, { kind, id, saved: true });
const unsave = (ctx: Ctx, kind: "document" | "link", id: string) => setSaved(ctx, { kind, id, saved: false });
const rowsFor = (objectId: string) => db.root((tx) => tx.query<{ user_id: string }>("select user_id from app.saved_items where object_id = $1 order by user_id", [objectId]));
/** Saves, then dates the save `minutes` ago: saves in one test can land in the same millisecond, which PGlite's clock can't tell apart. */
async function saveAgo(ctx: Ctx, kind: "document" | "link", id: string, minutes: number) {
  await save(ctx, kind, id);
  await db.root((tx) => tx.query("update app.saved_items set created_at = now() - make_interval(mins => $3) where user_id = $1 and object_id = $2", [ctx.userId, id, minutes]));
}

describe("saving", () => {
  it("saves and unsaves a document; saving twice is one save, unsaving twice changes nothing", async () => {
    const ctx = await signIn("saved-toggle@example.com");
    const doc = await addDoc(ctx, "Form W-9");
    expect(await isSaved(ctx, "document", doc)).toBe(false);
    expect(await save(ctx, "document", doc)).toBe(`/app/documents/${doc}`);
    await save(ctx, "document", doc);
    expect(await isSaved(ctx, "document", doc)).toBe(true);
    expect((await listSaved(ctx)).map((r) => r.id)).toEqual([doc]);
    await unsave(ctx, "document", doc);
    await unsave(ctx, "document", doc);
    expect(await isSaved(ctx, "document", doc)).toBe(false);
    expect(await listSaved(ctx)).toEqual([]);
  });

  it("lists documents and links newest first, as display rows; the limit takes the newest", async () => {
    const ctx = await signIn("saved-order@example.com");
    const w9 = await addDoc(ctx, "Form W-9");
    const coi = await addDoc(ctx, "Liability certificate", "coi", "2030-01-31");
    const link = await addLink(ctx, "For Northwind", [w9, coi]);
    await saveAgo(ctx, "document", w9, 30);
    await saveAgo(ctx, "link", link, 20);
    await saveAgo(ctx, "document", coi, 10);
    const rows = await listSaved(ctx);
    expect(rows.map((r) => r.id)).toEqual([coi, link, w9]);
    expect(rows[0]).toMatchObject({ kind: "document", title: "Liability certificate", kindLabel: "Insurance certificate", expiresOn: "2030-01-31", validity: "ok", href: `/app/documents/${coi}` });
    expect(rows[1]).toMatchObject({ kind: "link", label: "For Northwind", documents: 2, state: "working", revokedAt: null, href: `/app/passport/${link}` });
    expect(rows[2]).toMatchObject({ kind: "document", kindLabel: "W-9", expiresOn: null, validity: "none" });
    expect((await listSaved(ctx, 2)).map((r) => r.id)).toEqual([coi, link]);
  });

  it("shows turned-off and expired links with their state", async () => {
    const ctx = await signIn("saved-link-state@example.com");
    // Free has one open link at a time: turn each off before the next.
    const doc = await addDoc(ctx, "Form W-9");
    const off = await addLink(ctx, "Turned off", [doc]);
    await db.root((tx) => tx.query("update app.share_links set revoked_at = now() where id = $1", [off]));
    const ended = await addLink(ctx, "Ended", [doc]);
    await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [ended]));
    await saveAgo(ctx, "link", off, 20);
    await saveAgo(ctx, "link", ended, 10);
    expect((await listSaved(ctx)).map((r) => (r.kind === "link" ? `${r.label} ${r.state}` : r.id))).toEqual(["Ended expired", "Turned off revoked"]);
  });

  it("never lists an archived document (Security S5) and won't save one; restored, it's back", async () => {
    const ctx = await signIn("saved-archived@example.com");
    const doc = await addDoc(ctx, "Old permit", "permit");
    await save(ctx, "document", doc);
    await asUser(ctx.userId, (tx) => tx.query("update app.documents set status = 'archived' where id = $1", [doc]));
    expect(await listSaved(ctx)).toEqual([]);
    const other = await addDoc(ctx, "Other permit", "permit");
    await asUser(ctx.userId, (tx) => tx.query("update app.documents set status = 'archived' where id = $1", [other]));
    await expect(save(ctx, "document", other)).rejects.toThrow(SAVED_GONE);
    await asUser(ctx.userId, (tx) => tx.query("update app.documents set status = 'active' where id = $1", [doc]));
    expect((await listSaved(ctx)).map((r) => r.id)).toEqual([doc]);
  });

  it("a deleted document's or link's saves go with it, and so do a member's when they leave", async () => {
    const ctx = await signIn("saved-deleted@example.com");
    const doc = await addDoc(ctx, "Form W-9");
    const kept = await addDoc(ctx, "Liability certificate", "coi");
    const link = await addLink(ctx, "For Northwind", [kept]);
    await save(ctx, "document", doc);
    await save(ctx, "link", link);
    await save(ctx, "document", kept);
    await asUser(ctx.userId, (tx) => tx.query("delete from app.documents where id = $1", [doc]));
    expect(await rowsFor(doc)).toEqual([]);
    await db.root((tx) => tx.query("delete from app.share_links where id = $1", [link]));
    expect(await rowsFor(link)).toEqual([]);
    expect((await listSaved(ctx)).map((r) => r.id)).toEqual([kept]);

    const m = await member(ctx, "saved-leaver@example.com");
    await save(m, "document", kept);
    await db.root((tx) => tx.query("delete from app.members where org_id = $1 and user_id = $2", [ctx.orgId, m.userId]));
    expect((await rowsFor(kept)).map((r) => r.user_id)).toEqual([ctx.userId]);
  });

  it("refuses ids that aren't a document or link id; isSaved says false for them", async () => {
    const ctx = await signIn("saved-invalid@example.com");
    await expect(setSaved(ctx, { kind: "document", id: "nope", saved: true })).rejects.toThrow();
    await expect(setSaved(ctx, { kind: "vendor", id: crypto.randomUUID(), saved: true })).rejects.toThrow();
    await expect(save(ctx, "document", crypto.randomUUID())).rejects.toThrow(SAVED_GONE);
    await expect(save(ctx, "link", crypto.randomUUID())).rejects.toThrow(SAVED_GONE);
    expect(await isSaved(ctx, "document", "nope")).toBe(false);
  });

  it("the sample workspace starts with its W-9 and insurance certificate saved, and may save more", async () => {
    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await finishSignIn(userId, { demo: true });
    const ctx = await requireWorkspace();
    const rows = await listSaved(ctx);
    expect(rows.map((r) => (r.kind === "document" ? r.kindLabel : r.kind)).sort()).toEqual(["Insurance certificate", "W-9"]);
    expect(rows.every((r) => r.kind === "document" && r.title.endsWith("(sample)"))).toBe(true);
    const [license] = await asUser(userId, (tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and kind = 'license'", [org.id]));
    await save(ctx, "document", license.id);
    expect(await listSaved(ctx)).toHaveLength(3);
  });
});

describe("saves are personal (row level security)", () => {
  it("someone in another workspace sees none of them and can't save, add or remove one against the first workspace", async () => {
    const a = await signIn("saved-tenant-a@example.com");
    const doc = await addDoc(a, "Form W-9");
    const link = await addLink(a, "For Northwind", [doc]);
    await save(a, "document", doc);
    await save(a, "link", link);
    const b = await signIn("saved-tenant-b@example.com");

    expect(await listSaved(b)).toEqual([]);
    expect(await asUser(b.userId, (tx) => tx.query("select org_id, user_id, kind, object_id, created_at from app.saved_items"))).toEqual([]);
    expect(await isSaved(b, "document", doc)).toBe(false);
    // Through the app: the document isn't in B's workspace.
    await expect(save(b, "document", doc)).rejects.toThrow(SAVED_GONE);
    await expect(save(b, "link", link)).rejects.toThrow(SAVED_GONE);
    // Straight to the table: in B's own workspace pointing at A's document or link (the object check)...
    await expectDenied(asUser(b.userId, (tx) => tx.query("insert into app.saved_items (org_id, user_id, kind, object_id) values ($1, $2, 'document', $3)", [b.orgId, b.userId, doc])));
    await expectDenied(asUser(b.userId, (tx) => tx.query("insert into app.saved_items (org_id, user_id, kind, object_id) values ($1, $2, 'link', $3)", [b.orgId, b.userId, link])));
    // ...or in A's workspace (not a member), as B or as A.
    await expectDenied(asUser(b.userId, (tx) => tx.query("insert into app.saved_items (org_id, user_id, kind, object_id) values ($1, $2, 'document', $3)", [a.orgId, b.userId, doc])));
    await expectDenied(asUser(b.userId, (tx) => tx.query("insert into app.saved_items (org_id, user_id, kind, object_id) values ($1, $2, 'document', $3)", [a.orgId, a.userId, doc])));
    await asUser(b.userId, (tx) => tx.query("delete from app.saved_items where object_id = any($1::uuid[])", [[doc, link]]));
    expect(await rowsFor(doc)).toEqual([{ user_id: a.userId }]);
    expect(await rowsFor(link)).toEqual([{ user_id: a.userId }]);
  });

  it("another member of the same workspace doesn't see the first member's saves and can't add or remove one for them", async () => {
    const a = await signIn("saved-member-a@example.com");
    const doc = await addDoc(a, "Form W-9");
    const other = await addDoc(a, "Liability certificate", "coi");
    await save(a, "document", doc);
    const m = await member(a, "saved-member-m@example.com");

    expect(await listSaved(m)).toEqual([]);
    expect(await asUser(m.userId, (tx) => tx.query("select org_id, user_id, kind, object_id, created_at from app.saved_items"))).toEqual([]);
    expect(await isSaved(m, "document", doc)).toBe(false);
    // A save in the first member's name.
    await expectDenied(asUser(m.userId, (tx) => tx.query("insert into app.saved_items (org_id, user_id, kind, object_id) values ($1, $2, 'document', $3)", [a.orgId, a.userId, other])));
    await asUser(m.userId, (tx) => tx.query("delete from app.saved_items where org_id = $1", [a.orgId]));
    // Without a WHERE only the delete policy decides (the select policy applies once a WHERE reads a column).
    await asUser(m.userId, (tx) => tx.query("delete from app.saved_items"));
    expect(await rowsFor(doc)).toEqual([{ user_id: a.userId }]);

    // Any member may save for themselves; each still sees only their own.
    await save(m, "document", doc);
    expect((await listSaved(m)).map((r) => r.id)).toEqual([doc]);
    expect(await asUser(a.userId, (tx) => tx.query<{ user_id: string }>("select user_id from app.saved_items"))).toEqual([{ user_id: a.userId }]);
    expect(await asUser(m.userId, (tx) => tx.query<{ user_id: string }>("select user_id from app.saved_items"))).toEqual([{ user_id: m.userId }]);
    await unsave(m, "document", doc);
    expect(await rowsFor(doc)).toEqual([{ user_id: a.userId }]);
  });

  it("a save can't be changed, and anonymous visitors can't read or add one", async () => {
    const a = await signIn("saved-update@example.com");
    const doc = await addDoc(a, "Form W-9");
    await save(a, "document", doc);
    await expectDenied(asUser(a.userId, (tx) => tx.query("update app.saved_items set created_at = now() - interval '1 day'")));
    await expectDenied(asUser(a.userId, (tx) => tx.query("update app.saved_items set object_id = $1", [crypto.randomUUID()])));
    await expectDenied(asAnon((tx) => tx.query("select 1 from app.saved_items")));
    await expectDenied(asAnon((tx) => tx.query("insert into app.saved_items (org_id, user_id, kind, object_id) values ($1, $2, 'document', $3)", [a.orgId, a.userId, doc])));
    // The two id columns come from object_id; nobody writes them (no grant, and Postgres refuses a value for a generated column).
    await expect(
      asUser(a.userId, (tx) => tx.query("insert into app.saved_items (org_id, user_id, kind, object_id, document_id) values ($1, $2, 'document', $3, $3)", [a.orgId, a.userId, doc])),
    ).rejects.toThrow(/permission denied|non-DEFAULT value/i);
  });
});

describe("pages", () => {
  const savedPage = () => renderPage(SavedPage, {});
  const documentPage = (id: string) => renderPage(DocumentPage, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
  const linkPage = (id: string) => renderPage(PassportDetail, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
  /** The Save toggle's form: its hidden fields and its button's visible text and accessible name. */
  const toggle = (html: string) => {
    const form = /<form[^>]*>((?:(?!<\/form>)[\s\S])*?name="saved"[\s\S]*?)<\/form>/.exec(html)?.[1] ?? "";
    const fields = Object.fromEntries([...form.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const button = /<button\b([^>]*)>([\s\S]*?)<\/button>/.exec(form);
    return { fields, text: textOf(button?.[2] ?? ""), name: /aria-label="([^"]*)"/.exec(button?.[1] ?? "")?.[1] ?? null, cls: /class="([^"]*)"/.exec(button?.[1] ?? "")?.[1], icon: /<svg\b/.test(button?.[2] ?? "") };
  };
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it("Saved with nothing saved says how to save, in both looks", async () => {
    await signIn("saved-page-empty@example.com");
    for (const look of ["", "v1"]) {
      vi.stubEnv("SHIPSHAPE_UI", look);
      const text = textOf(await savedPage());
      expect(text).toContain("Saved Documents and links you saved.");
      expect(text).toContain("Nothing saved yet Save a document or link from its page to keep it here.");
    }
    expect(actionsOf(await savedPage()).filter((a) => a.label === "Go to Documents")).toEqual([{ tag: "a", label: "Go to Documents", href: "/app/documents" }]);
  });

  it("Saved lists the person's saves newest first, each to its page, with a document's expiry and a link's state", async () => {
    const ctx = await signIn("saved-page-list@example.com");
    const doc = await addDoc(ctx, "Liability certificate", "coi", "2030-01-31");
    const link = await addLink(ctx, "For Northwind", [doc]);
    await saveAgo(ctx, "document", doc, 20);
    await saveAgo(ctx, "link", link, 10);
    await db.root((tx) => tx.query("update app.share_links set revoked_at = now() where id = $1", [link]));
    const html = await savedPage();
    expect(html).toContain('<ul class="group-list">');
    const hrefs = actionsOf(html).map((a) => a.href).filter((h) => h?.startsWith("/app/documents/") || h?.startsWith("/app/passport/"));
    expect(hrefs).toEqual([`/app/passport/${link}`, `/app/documents/${doc}`]);
    expect(textOf(html)).toContain("For Northwind Passport link · 1 document ○ Turned off");
    expect(textOf(html)).toContain("Liability certificate Insurance certificate ✓ Current · Jan 31, 2030");
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(textOf(await savedPage())).toContain("Liability certificate Insurance certificate ✓ Current · Jan 31, 2030");
  });

  it("the document page's Save toggle saves and unsaves through the form, and lands back on the page", async () => {
    const ctx = await signIn("saved-page-doc@example.com");
    const doc = await addDoc(ctx, "Form W-9");
    expect(toggle(await documentPage(doc))).toEqual({ fields: { kind: "document", id: doc, saved: "1" }, text: "Save", name: null, cls: "btn-ghost press px-4", icon: true });
    await expect(toggleSaved(form({ kind: "document", id: doc, saved: "1" }))).rejects.toThrow(`redirect /app/documents/${doc}`);
    expect(await isSaved(ctx, "document", doc)).toBe(true);
    expect(toggle(await documentPage(doc))).toEqual({ fields: { kind: "document", id: doc, saved: "0" }, text: "Saved", name: "Saved. Remove from Saved", cls: "btn-ghost press px-4", icon: true });
    // The same form sent twice changes nothing more.
    await expect(toggleSaved(form({ kind: "document", id: doc, saved: "0" }))).rejects.toThrow(`redirect /app/documents/${doc}`);
    await expect(toggleSaved(form({ kind: "document", id: doc, saved: "0" }))).rejects.toThrow(`redirect /app/documents/${doc}`);
    expect(await isSaved(ctx, "document", doc)).toBe(false);
    // Not a form the app sends: to Saved, nothing changed.
    await expect(toggleSaved(form({ kind: "vendor", id: doc, saved: "1" }))).rejects.toThrow("redirect /app/saved");
    // The earlier look has no toggle; an archived document shows none either.
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(await documentPage(doc)).not.toContain('name="saved"');
    vi.stubEnv("SHIPSHAPE_UI", "");
    await asUser(ctx.userId, (tx) => tx.query("update app.documents set status = 'archived' where id = $1", [doc]));
    expect(await documentPage(doc)).not.toContain('name="saved"');
    await expect(toggleSaved(form({ kind: "document", id: doc, saved: "1" }))).rejects.toThrow(`redirect /app/documents/${doc}`);
    expect(await isSaved(ctx, "document", doc)).toBe(false);
  });

  it("the passport link page's Save toggle sits in its header and works the same way", async () => {
    const ctx = await signIn("saved-page-link@example.com");
    const doc = await addDoc(ctx, "Form W-9");
    const link = await addLink(ctx, "For Northwind", [doc]);
    const html = await linkPage(link);
    expect(/<div class="page-actions[^"]*">([\s\S]*?)<\/div><\/header>/.exec(html)?.[1]).toContain('name="saved"');
    expect(toggle(html)).toEqual({ fields: { kind: "link", id: link, saved: "1" }, text: "Save", name: null, cls: "btn-ghost press px-4", icon: true });
    await expect(toggleSaved(form({ kind: "link", id: link, saved: "1" }))).rejects.toThrow(`redirect /app/passport/${link}`);
    expect(toggle(await linkPage(link)).text).toBe("Saved");
    expect((await listSaved(ctx)).map((r) => r.id)).toEqual([link]);
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    expect(await linkPage(link)).not.toContain('name="saved"');
  });
});

describe("rollback", () => {
  it("0045 goes down with its down file and comes back up with npm run migrate's runner (PGlite)", async () => {
    const pg = await PGlite.create();
    try {
      const step = (t: Pick<PGlite, "exec" | "query">): MigrationStep => ({
        exec: async (s) => void (await t.exec(s)),
        query: async (text, params) => (await t.query<Record<string, unknown>>(text, params)).rows,
      });
      const conn = { ...step(pg), transaction: (fn: (t: MigrationStep) => Promise<void>) => pg.transaction((t) => fn(step(t))) };
      // Up to 0045 only, so this keeps proving 0045 once later migrations exist.
      const names = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql") && n <= "0045_saved_items.sql").sort();
      expect(names.at(-1)).toBe("0045_saved_items.sql");
      const files = await Promise.all(names.map(async (name) => ({ name, sql: await readFile(`supabase/migrations/${name}`, "utf8") })));
      const setup = [await readFile("supabase/platform/plain-postgres.sql", "utf8")];
      const shape = async () =>
        (
          await pg.query<{ t: string | null; policies: number }>(
            "select to_regclass('app.saved_items')::text as t, (select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'saved_items') as policies",
          )
        ).rows[0];
      expect(await migrate(conn, setup, files)).toEqual(names);
      expect(await shape()).toEqual({ t: "app.saved_items", policies: 4 });

      // infra/README.md, "Undoing a migration": the down file as the owner, then 0045's row, in one transaction.
      const down = await readFile("supabase/rollback/0045_saved_items.down.sql", "utf8");
      await pg.transaction(async (t) => {
        await t.exec("set local role shipshape_owner");
        await t.exec(down);
        await t.query("delete from meta.migrations where name = $1", ["0045_saved_items.sql"]);
      });
      expect(await shape()).toEqual({ t: null, policies: 0 });
      // Its key and indexes went with it.
      expect((await pg.query("select 1 from pg_class where relname like 'saved_items%'")).rows).toEqual([]);

      expect(await migrate(conn, setup, files)).toEqual(["0045_saved_items.sql"]);
      expect(await shape()).toEqual({ t: "app.saved_items", policies: 4 });
      expect(await migrate(conn, setup, files)).toEqual([]);
    } finally {
      await pg.close();
    }
  });

  it("the runner never reads the rollback folder", async () => {
    expect((await readdir("supabase/migrations")).some((n) => n.includes(".down."))).toBe(false);
    const sources = await Promise.all(["lib/server/db.ts", "scripts/migrate.ts", "tests/support/db.ts"].map((f) => readFile(f, "utf8")));
    for (const s of sources) {
      expect(s).toContain('"supabase/migrations"');
      expect(s).not.toContain("supabase/rollback");
    }
  });
});
