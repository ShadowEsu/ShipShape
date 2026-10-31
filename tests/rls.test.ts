import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, type Tx } from "@/lib/server/db";
import { freshDb, type TestDb } from "./support/db";

/**
 * Tenancy (Security R1, R7): user B and anonymous visitors see none of user A's rows, by listing
 * or by guessed id, and can change none of them. Members can't edit or delete the audit log.
 */

let db: TestDb;
let a: string, b: string, orgA: string, orgB: string, docA: string;

const SHA = "a".repeat(64);

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/permission denied|row-level security|not a member|does not match|cannot change/i);
}

beforeAll(async () => {
  db = await freshDb();
  a = await db.user("a@example.com");
  b = await db.user("b@example.com");
  orgA = (await asUser(a, (tx) => tx.query<{ id: string }>("select app.create_workspace('A Plumbing') as id")))[0].id;
  orgB = (await asUser(b, (tx) => tx.query<{ id: string }>("select app.create_workspace('B Cafe') as id")))[0].id;
  docA = await asUser(a, async (tx) => {
    const [d] = await tx.query<{ id: string }>(
      "insert into app.documents (org_id, title, kind, created_by) values ($1, 'W-9 2026', 'w9', $2) returning id",
      [orgA, a],
    );
    await tx.query(
      "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, created_by) values ($1, 1, $2, $3, 'application/pdf', 100, $4, 'upload', $5)",
      [d.id, orgA, `${orgA}/${d.id}/1.pdf`, SHA, a],
    );
    await tx.query("insert into app.acknowledgments (org_id, user_id, document_id, text_version, text_sha256) values ($1, $2, $3, 'ack-v1', $4)", [
      orgA, a, d.id, SHA,
    ]);
    await tx.query("select app.audit_append($1, 'document.uploaded', $2)", [orgA, d.id]);
    return d.id;
  });
  await asService((tx) => tx.query("insert into app.waitlist (email) values ('w@example.com')"));
  await asService((tx) => tx.query("select app.rate_hit('test', 'k', 60, 5)"));
  for (const [u, item] of [[a, "terms_privacy"], [b, "terms_privacy"]]) {
    await asUser(u, (tx) => tx.query("insert into app.consents (user_id, item, policy_version) values ($1, $2, 'v1')", [u, item]));
  }
});

// Every table in schema app, with the column that ties a row to a workspace (null: not tenant data).
const TABLES: Record<string, string | null> = {
  organizations: "id",
  members: "org_id",
  profiles: "org_id",
  documents: "org_id",
  document_versions: "org_id",
  acknowledgments: "org_id",
  audit_log: "org_id",
  templates: null,
  waitlist: null,
  rate_hits: null,
  consents: null, // keyed by person, checked separately below
};

describe("row level security", () => {
  it("covers every table in schema app, each with RLS enabled", async () => {
    const rows = await db.root((tx) =>
      tx.query<{ relname: string; relrowsecurity: boolean }>(
        "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app' and c.relkind = 'r' order by 1",
      ),
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(Object.keys(TABLES).sort());
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("user A sees their own rows", async () => {
    for (const [table, col] of Object.entries(TABLES)) {
      if (!col) continue;
      const rows = await asUser(a, (tx) => tx.query(`select 1 from app.${table} where ${col} = $1`, [orgA]));
      expect(rows.length, table).toBeGreaterThan(0);
    }
  });

  it("user B sees 0 of A's rows in every tenant table, listing or by id", async () => {
    for (const [table, col] of Object.entries(TABLES)) {
      if (!col) continue;
      const byOrg = await asUser(b, (tx) => tx.query(`select 1 from app.${table} where ${col} = $1`, [orgA]));
      expect(byOrg.length, table).toBe(0);
      const all = await asUser(b, (tx) => tx.query(`select ${col} as org from app.${table}`));
      expect(all.every((r) => r.org === orgB), table).toBe(true);
    }
    expect(await asUser(b, (tx) => tx.query("select 1 from app.documents where id = $1", [docA]))).toEqual([]);
  });

  it("consents are private to the person who gave them", async () => {
    expect(await asUser(b, (tx) => tx.query("select 1 from app.consents where user_id = $1", [a]))).toEqual([]);
    expect((await asUser(a, (tx) => tx.query<{ user_id: string }>("select user_id from app.consents"))).map((r) => r.user_id)).toEqual([a]);
    await expectDenied(asUser(b, (tx) => tx.query("insert into app.consents (user_id, item, policy_version) values ($1, 'esign', 'v1')", [a])));
    await expectDenied(asUser(a, (tx) => tx.query("update app.consents set policy_version = 'v0' where user_id = $1", [a])));
    await expectDenied(asUser(a, (tx) => tx.query("delete from app.consents where user_id = $1", [a])));
  });

  it("anonymous visitors can read templates and nothing else", async () => {
    await expect(asAnon((tx) => tx.query("select 1 from app.templates"))).resolves.toBeDefined();
    for (const table of Object.keys(TABLES)) {
      if (table === "templates") continue;
      await expectDenied(asAnon((tx) => tx.query(`select 1 from app.${table}`)));
    }
  });

  it("waitlist and rate limits are closed to signed-in users", async () => {
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.waitlist")));
    await expectDenied(asUser(a, (tx) => tx.query("insert into app.waitlist (email) values ('x@example.com')")));
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.rate_hits")));
    await expectDenied(asUser(a, (tx) => tx.query("select app.rate_hit('test', 'k', 60, 5)")));
  });

  it("user B can't change, delete or add to A's workspace", async () => {
    const changed = (q: (tx: Tx) => Promise<unknown[]>) => asUser(b, q);
    expect(await changed((tx) => tx.query("update app.documents set title = 'x' where id = $1 returning 1", [docA]))).toEqual([]);
    expect(await changed((tx) => tx.query("delete from app.documents where id = $1 returning 1", [docA]))).toEqual([]);
    expect(await changed((tx) => tx.query("update app.profiles set legal_name = 'x' where org_id = $1 returning 1", [orgA]))).toEqual([]);
    expect(await changed((tx) => tx.query("update app.organizations set name = 'x' where id = $1 returning 1", [orgA]))).toEqual([]);
    await expectDenied(
      asUser(b, (tx) => tx.query("insert into app.documents (org_id, title, kind, created_by) values ($1, 'x', 'other', $2)", [orgA, b])),
    );
    await expectDenied(
      asUser(b, (tx) =>
        tx.query(
          "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, created_by) values ($1, 2, $2, $3, 'application/pdf', 1, $4, 'upload', $5)",
          [docA, orgA, `${orgA}/x`, SHA, b],
        ),
      ),
    );
    await expectDenied(asUser(b, (tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'owner')", [orgA, b])));
    await expectDenied(asUser(b, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $2)", [orgA, docA])));
    await expectDenied(asUser(b, (tx) => tx.query("select app.audit_verify($1)", [orgA])));
  });

  it("B can't attach a version to A's document from B's own workspace", async () => {
    await expectDenied(
      asUser(b, (tx) =>
        tx.query(
          "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, created_by) values ($1, 2, $2, $3, 'application/pdf', 1, $4, 'upload', $5)",
          [docA, orgB, `${orgB}/x`, SHA, b],
        ),
      ),
    );
  });

  it("documents never move between workspaces", async () => {
    // Make A a member of B's workspace too, so only the org-change guard can stop the move.
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [orgB, a]));
    await expectDenied(asUser(a, (tx) => tx.query("update app.documents set org_id = $1 where id = $2", [orgB, docA])));
    await db.root((tx) => tx.query("delete from app.members where org_id = $1 and user_id = $2", [orgB, a]));
  });

  it("versions and the audit log are append only, even for the owner", async () => {
    await expectDenied(asUser(a, (tx) => tx.query("update app.document_versions set sha256 = $1 where document_id = $2", ["b".repeat(64), docA])));
    await expectDenied(asUser(a, (tx) => tx.query("delete from app.document_versions where document_id = $1", [docA])));
    await expectDenied(asUser(a, (tx) => tx.query("update app.audit_log set action = 'x.y' where org_id = $1", [orgA])));
    await expectDenied(asUser(a, (tx) => tx.query("delete from app.audit_log where org_id = $1", [orgA])));
    await expectDenied(
      asUser(a, (tx) =>
        tx.query("insert into app.audit_log (org_id, seq, at, action, prev_hash, hash) values ($1, 99, now(), 'x.y', 'p', 'h')", [orgA]),
      ),
    );
  });

  it("members can't grant themselves a higher role or edit the profile as a plain member", async () => {
    const c = await db.user("c@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [orgA, c]));
    await expectDenied(asUser(c, (tx) => tx.query("update app.members set role = 'owner' where user_id = $1", [c])));
    expect(await asUser(c, (tx) => tx.query("update app.profiles set legal_name = 'x' where org_id = $1 returning 1", [orgA]))).toEqual([]);
    expect(await asUser(c, (tx) => tx.query("delete from app.documents where id = $1 returning 1", [docA]))).toEqual([]);
    expect((await asUser(c, (tx) => tx.query("select 1 from app.documents where id = $1", [docA]))).length).toBe(1);
  });
});

describe("audit chain", () => {
  it("verifies, then reports the first row someone edited behind the app's back", async () => {
    await asUser(a, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $2)", [orgA, docA]));
    const verify = () => asUser(a, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1) as broken", [orgA]));
    expect((await verify())[0].broken).toBeNull();

    const rows = await asUser(a, (tx) => tx.query<{ seq: string; actor: string | null }>("select seq::text, actor from app.audit_log where org_id = $1 order by seq", [orgA]));
    expect(rows.map((r) => r.seq)).toEqual(["1", "2", "3"]);
    expect(rows.every((r) => r.actor === a)).toBe(true);

    await db.root((tx) => tx.query("update app.audit_log set object_id = null where org_id = $1 and seq = 2", [orgA]));
    expect(String((await verify())[0].broken)).toBe("2");
  });
});
