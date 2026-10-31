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
  await expect(p).rejects.toThrow(/permission denied|row-level security|not a member|does not match|cannot change|not a user event|not allowed/i);
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
    await tx.query("select app.confirm_facts($1, array['legal_name'])", [orgA]);
    return d.id;
  });
  await asService((tx) => tx.query("insert into app.waitlist (email) values ('w@example.com')"));
  await asService((tx) => tx.query("select app.rate_hit('test', 'k', 60, 5)"));
  // M3 tables: a passport link (opened once), a signature request, a sent reminder, an outbox message.
  const linkHash = "b".repeat(64);
  const linkA = await asUser(a, async (tx) => {
    const [l] = await tx.query<{ id: string }>(
      "insert into app.share_links (org_id, label, token_hash, expires_at, created_by) values ($1, 'For Northwind', $2, now() + interval '7 days', $3) returning id",
      [orgA, linkHash, a],
    );
    await tx.query("insert into app.share_link_documents (link_id, document_id, org_id) values ($1, $2, $3)", [l.id, docA, orgA]);
    await tx.query(
      "insert into app.signature_requests (org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, created_by) values ($1, $2, 1, 'Sam Signer', 'sam@example.com', $3, now() + interval '7 days', $4)",
      [orgA, docA, "c".repeat(64), a],
    );
    return l.id;
  });
  await asAnon((tx) => tx.query("select * from app.passport_open($1, $2, $3)", [linkA, linkHash, "0".repeat(16)]));
  await asService(async (tx) => {
    await tx.query("insert into app.reminders_sent (document_id, org_id, due_on, days_before) values ($1, $2, current_date, 30)", [docA, orgA]);
    await tx.query("insert into app.outbox (org_id, to_email, subject, body) values ($1, 'a@example.com', 'Reminder', 'Your W-9')", [orgA]);
    // M4: A's workspace is a Stripe customer; one webhook event was processed.
    await tx.query("insert into app.billing (org_id, stripe_customer_id, stripe_subscription_id, status, plan) values ($1, 'cus_A1', 'sub_A1', 'active', 'pro')", [orgA]);
    await tx.query("insert into app.stripe_events (id, type) values ('evt_A1', 'customer.subscription.updated')");
  });
  // Collect: a vendor of A's, its upload link, and one file received through it (as a vendor would).
  const vendorHash = "d".repeat(64);
  const vendorLinkA = await asUser(a, async (tx) => {
    const [v] = await tx.query<{ id: string }>("insert into app.vendors (org_id, name, requested, created_by) values ($1, 'Rivera Electric', array['w9'], $2) returning id", [orgA, a]);
    const [l] = await tx.query<{ id: string }>(
      "insert into app.vendor_links (org_id, vendor_id, token_hash, expires_at, created_by) values ($1, $2, $3, now() + interval '7 days', $4) returning id",
      [orgA, v.id, vendorHash, a],
    );
    return l.id;
  });
  const vendorFile = "00000000-0000-4000-8000-0000000000f1";
  const [received] = await asAnon((tx) =>
    tx.query<{ ok: boolean }>("select app.collect_receive($1, $2, $3, 'w9', 'w9.pdf', $4, 'application/pdf', 100, $5, null, false) as ok", [
      vendorLinkA,
      vendorHash,
      vendorFile,
      `${orgA}/${vendorFile}/v1.pdf`,
      SHA,
    ]),
  );
  expect(received.ok).toBe(true);
  for (const [u, item] of [[a, "terms_privacy"], [b, "terms_privacy"]]) {
    await asUser(u, (tx) => tx.query("insert into app.consents (user_id, item, policy_version) values ($1, $2, 'v1')", [u, item]));
  }
});

// Every table in schema app, with the column that ties a row to a workspace (null: not tenant data).
const TABLES: Record<string, string | null> = {
  organizations: "id",
  members: "org_id",
  profiles: "org_id",
  profile_facts: "org_id",
  documents: "org_id",
  document_versions: "org_id",
  acknowledgments: "org_id",
  audit_log: "org_id",
  templates: null,
  waitlist: null,
  rate_hits: null,
  consents: null, // keyed by person, checked separately below
  share_links: "org_id",
  share_link_documents: "org_id",
  share_access: "org_id",
  reminders_sent: "org_id",
  outbox: "org_id",
  signature_requests: "org_id",
  billing: "org_id",
  stripe_events: null, // server only, checked below
  ai_calls: null, // server only, checked in ai.test.ts
  vendors: "org_id",
  vendor_links: "org_id",
  vendor_files: "org_id",
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

  it("billing is read-only to members, Stripe ids and webhook events stay server-side", async () => {
    const [mine] = await asUser(a, (tx) => tx.query<{ plan: string }>("select plan from app.billing where org_id = $1", [orgA]));
    expect(mine.plan).toBe("pro");
    await expectDenied(asUser(a, (tx) => tx.query("select stripe_customer_id from app.billing")));
    await expectDenied(asUser(a, (tx) => tx.query("update app.billing set plan = 'pro' where org_id = $1", [orgA])));
    await expectDenied(asUser(b, (tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, plan, status) values ($1, 'cus_B9', 'pro', 'active')", [orgB])));
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.stripe_events")));
    expect((await asUser(b, (tx) => tx.query<{ plan: string | null }>("select app.org_plan($1) as plan", [orgA])))[0].plan).toBeNull();
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
  it("records data changes itself, verifies, then reports the first row someone edited behind the app's back", async () => {
    await asUser(a, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $2)", [orgA, docA]));
    const verify = () => asUser(a, (tx) => tx.query<{ broken: string | null }>("select app.audit_verify($1) as broken", [orgA]));
    expect((await verify())[0].broken).toBeNull();

    const rows = await asUser(a, (tx) =>
      tx.query<{ action: string; actor: string | null }>("select action, actor from app.audit_log where org_id = $1 order by seq", [orgA]),
    );
    expect(rows.map((r) => r.action)).toEqual([
      "workspace.created",
      "document.created",
      "document.version_added",
      "document.acknowledged",
      "passport.created",
      "esign.requested",
      "vendor.added",
      "collect.link_created",
      "collect.received",
      "document.viewed",
    ]);
    // A vendor's upload has no signed-in actor; everything else was A.
    expect(rows.filter((r) => r.actor !== a).map((r) => [r.action, r.actor])).toEqual([["collect.received", null]]);

    // A version's fingerprint is part of the chain: swapping it breaks that row (Security F2).
    const [version] = await db.root((tx) =>
      tx.query<{ seq: string; detail_sha256: string }>("select seq::text as seq, detail_sha256 from app.audit_log where org_id = $1 and action = 'document.version_added'", [orgA]),
    );
    expect(version.detail_sha256).toBe(SHA);
    const setDetail = (sha: string) => db.root((tx) => tx.query("update app.audit_log set detail_sha256 = $2 where org_id = $1 and seq = $3", [orgA, sha, version.seq]));
    await setDetail("f".repeat(64));
    expect(String((await verify())[0].broken)).toBe(version.seq);
    await setDetail(SHA);
    expect((await verify())[0].broken).toBeNull();

    await db.root((tx) => tx.query("update app.audit_log set object_id = null where org_id = $1 and seq = 2", [orgA]));
    expect(String((await verify())[0].broken)).toBe("2");
  });

  it("members can only append view-type events, never forge e-sign or data events", async () => {
    for (const action of ["esign.completed", "document.signed", "document.created", "workspace.created"]) {
      await expectDenied(asUser(a, (tx) => tx.query("select app.audit_append($1, $2, $3)", [orgA, action, docA])));
    }
  });

  it("service role can't verify without a member, or rewrite history", async () => {
    await expectDenied(asService((tx) => tx.query("select app.audit_verify($1)", [orgA])));
    await expectDenied(asService((tx) => tx.query("update app.audit_log set action = 'x.y' where org_id = $1", [orgA])));
    await expectDenied(asService((tx) => tx.query("delete from app.document_versions where document_id = $1", [docA])));
  });
});

describe("security review E2-E7", () => {
  it("signed-in users can only create real workspaces; sample workspaces are server-only", async () => {
    await expect(asUser(a, (tx) => tx.query("select app.create_workspace('x', true)"))).rejects.toThrow(/does not exist/);
    await expectDenied(asUser(a, (tx) => tx.query("select app.create_sample_workspace($1, 'x')", [a])));
    const [row] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [b]));
    const [org] = await db.root((tx) => tx.query<{ is_demo: boolean }>("select is_demo from app.organizations where id = $1", [row.id]));
    expect(org.is_demo).toBe(true);
  });

  it("an acknowledgment can't point at another workspace's document", async () => {
    await expectDenied(
      asUser(b, (tx) =>
        tx.query("insert into app.acknowledgments (org_id, user_id, document_id, text_version, text_sha256) values ($1, $2, $3, 'v1', $4)", [
          orgB, b, docA, SHA,
        ]),
      ),
    );
  });

  it("tax ids go only through set_tax_id, by owners and admins; updated_by is set by the database", async () => {
    await expectDenied(asUser(a, (tx) => tx.query("update app.profiles set ein_last4 = '9999' where org_id = $1", [orgA])));
    await expectDenied(asUser(a, (tx) => tx.query("update app.profiles set updated_by = $2 where org_id = $1", [orgA, b])));
    await expect(asUser(a, (tx) => tx.query("select app.set_tax_id($1, 'ein', 'not-a-cipher', '1234')", [orgA]))).rejects.toThrow(/invalid/);
    await asUser(a, (tx) => tx.query("select app.set_tax_id($1, 'ein', 'v1.k.iv.tag.body', '4567')", [orgA]));
    const c = await db.user("c2@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [orgA, c]));
    await expectDenied(asUser(c, (tx) => tx.query("select app.set_tax_id($1, 'ein', null, null)", [orgA])));
    await asUser(a, (tx) => tx.query("update app.profiles set legal_name = 'A Plumbing LLC' where org_id = $1", [orgA]));
    const [p] = await db.root((tx) => tx.query<{ updated_by: string; ein_last4: string }>("select updated_by, ein_last4 from app.profiles where org_id = $1", [orgA]));
    expect(p).toEqual({ updated_by: a, ein_last4: "4567" });
  });

  it("injected SQL that resets the role stops at the app role, below the superuser", async () => {
    const inject = (sql: string) => asUser(a, async (tx) => {
      await tx.query("reset role");
      return tx.query(sql);
    });
    await expectDenied(inject("set role postgres"));
    await expectDenied(inject("alter table app.audit_log disable row level security"));
    await expectDenied(inject("select * from app.documents"));
    await expectDenied(inject("update app.audit_log set action = 'x.y'"));
  });
});
