import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createLocalDriver, type Tx } from "@/lib/server/db";
import { rateLimited } from "@/lib/server/http";
import { migrate, roleProblems, type MigrationStep } from "@/lib/server/migrations";
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
      `insert into app.signature_requests (id, org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, created_by, to_sign_path, to_sign_sha256)
       select r.id, $1::uuid, $2, 1, 'Sam Signer', 'sam@example.com', $3, now() + interval '7 days', $4, $1::uuid::text || '/' || r.id::text || '/v1.pdf', $5
       from (select gen_random_uuid() as id) r`,
      [orgA, docA, "c".repeat(64), a, "d".repeat(64)],
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
    tx.query<{ answer: string }>("select app.collect_receive($1, $2, $3, 'w9', 'w9.pdf', $4, 'application/pdf', 100, $5, null, false) as answer", [
      vendorLinkA,
      vendorHash,
      vendorFile,
      `${orgA}/${vendorFile}/v1.pdf`,
      SHA,
    ]),
  );
  expect(received.answer).toBe("ok");
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
  identities: null, // server only: which Cognito user is which user, checked below
  deletion_requests: null, // server only: accounts the daily run finishes deleting, checked below
  storage_cleanup: null, // server only: stored files a deletion couldn't remove yet, checked below
  session_revocations: null, // each person's own row only: when they last signed out everywhere, checked below
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

  it("waitlist, rate limits, sign-in identities, deletion requests and the file-cleanup queue are closed to signed-in users", async () => {
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.waitlist")));
    await expectDenied(asUser(a, (tx) => tx.query("insert into app.waitlist (email) values ('x@example.com')")));
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.rate_hits")));
    await expectDenied(asUser(a, (tx) => tx.query("select app.rate_hit('test', 'k', 60, 5)")));
    // A row here decides whose account a Cognito sign-in opens: signed-in users can't read or add one.
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.identities")));
    await expectDenied(asUser(a, (tx) => tx.query("insert into app.identities (provider, subject, user_id) values ('cognito', $1, $2)", [crypto.randomUUID(), a])));
    // A row here gets that account deleted by the daily run: nobody but the server writes one.
    await expectDenied(asUser(a, (tx) => tx.query("insert into app.deletion_requests (user_id) values ($1)", [b])));
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.deletion_requests")));
    await expectDenied(asUser(a, (tx) => tx.query("update app.deletion_requests set requested_at = now()")));
    // A row here gets that stored object deleted by the daily run: nobody but the server writes one.
    await expectDenied(asUser(a, (tx) => tx.query("insert into app.storage_cleanup (path) values ($1)", [`${orgB}/x/v1.pdf`])));
    await expectDenied(asUser(a, (tx) => tx.query("select 1 from app.storage_cleanup")));
    await expectDenied(asUser(a, (tx) => tx.query("delete from app.storage_cleanup")));
  });

  it("sign-out-everywhere times: each person reads only their own, and only moves it themselves (Security E9)", async () => {
    await asUser(a, (tx) => tx.query("select app.end_my_sessions()"));
    await asUser(b, (tx) => tx.query("select app.end_my_sessions()"));
    const seen = await asUser(a, (tx) => tx.query<{ user_id: string }>("select user_id from app.session_revocations"));
    expect(seen.map((r) => r.user_id)).toEqual([a]);
    // Nobody writes a row directly: setting someone else's would sign them out, or an old time would revive copies.
    await expectDenied(asUser(a, (tx) => tx.query("insert into app.session_revocations (user_id, valid_after) values ($1, now())", [b])));
    await expectDenied(asUser(a, (tx) => tx.query("update app.session_revocations set valid_after = '-infinity'")));
    await expectDenied(asUser(a, (tx) => tx.query("delete from app.session_revocations")));
    await expectDenied(asAnon((tx) => tx.query("select app.end_my_sessions()")));
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
    // The setup's rows come first, exactly; other tests in this file may add to A's history before this
    // one runs, and the view appended above is last.
    const setup = rows.slice(0, 9);
    expect(setup.map((r) => r.action)).toEqual([
      "workspace.created",
      "document.created",
      "document.version_added",
      "document.acknowledged",
      "passport.created",
      "esign.requested",
      "vendor.added",
      "collect.link_created",
      "collect.received",
    ]);
    expect(rows.at(-1)).toEqual({ action: "document.viewed", actor: a });
    // A vendor's upload has no signed-in actor; everything else was A.
    expect(setup.filter((r) => r.actor !== a).map((r) => [r.action, r.actor])).toEqual([["collect.received", null]]);

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

    const [second] = await db.root((tx) => tx.query<{ object_id: string | null }>("select object_id from app.audit_log where org_id = $1 and seq = 2", [orgA]));
    await db.root((tx) => tx.query("update app.audit_log set object_id = null where org_id = $1 and seq = 2", [orgA]));
    expect(String((await verify())[0].broken)).toBe("2");
    // Put it back, so A's history verifies again for the tests after this one.
    await db.root((tx) => tx.query("update app.audit_log set object_id = $2 where org_id = $1 and seq = 2", [orgA, second.object_id]));
    expect((await verify())[0].broken).toBeNull();
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

  // Real Postgres only: PGlite has one connection, so two transactions never overlap there.
  it.skipIf(!process.env.SHIPSHAPE_PG_TEST_URL)("two people adding to a workspace at once can both write its history, without a deadlock", async () => {
    const owner = await db.user("busy@example.com");
    const org = (await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Busy Workspace') as id")))[0].id;
    const [{ link, d1, d2 }] = await db.root((tx) =>
      tx.query<{ link: string; d1: string; d2: string }>(
        `with l as (insert into app.share_links (org_id, label, token_hash, expires_at) values ($1, 'Busy', repeat('c', 64), now() + interval '1 day') returning id),
              d as (insert into app.documents (org_id, title, kind) select $1, 'Doc ' || g, 'w9' from generate_series(1, 2) g returning id)
         select (select id from l) as link, (select min(id::text) from d) as d1, (select max(id::text) from d) as d2`,
        [org],
      ),
    );
    // Each adds a row that references the workspace (its foreign key takes a key-share lock on the
    // workspace's row, as every insert does), waits until the other has too, then writes history.
    let arrived = 0;
    let bothIn = () => {};
    const together = new Promise<void>((resolve) => (bothIn = resolve));
    const one = (doc: string) =>
      asUser(owner, async (tx) => {
        await tx.query("insert into app.share_link_documents (link_id, document_id, org_id) values ($1, $2, $3)", [link, doc, org]);
        if (++arrived === 2) bothIn();
        await together;
        await tx.query("select app.audit_append($1, 'document.viewed', $2)", [org, doc]);
      });
    await Promise.all([one(d1), one(d2)]);
    const [chain] = await asUser(owner, (tx) =>
      tx.query<{ broken: string | null; viewed: number }>(
        "select app.audit_verify($1) as broken, (select count(*)::int from app.audit_log where org_id = $1 and action = 'document.viewed') as viewed",
        [org],
      ),
    );
    expect(chain).toEqual({ broken: null, viewed: 2 });
  });

  it.skipIf(!process.env.SHIPSHAPE_PG_TEST_URL)("history writers in one workspace take turns: 3 at once for 20 rounds all land in one unbroken chain (Security A-31)", async () => {
    const owner = await db.user("rounds@example.com");
    const org = (await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Rounds Workspace') as id")))[0].id;
    const writer = async () => {
      for (let i = 0; i < 20; i++) await asUser(owner, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $1)", [org]));
    };
    await Promise.all([writer(), writer(), writer()]);
    const [chain] = await asUser(owner, (tx) =>
      tx.query<{ broken: string | null; viewed: number }>(
        "select app.audit_verify($1) as broken, (select count(*)::int from app.audit_log where org_id = $1 and action = 'document.viewed') as viewed",
        [org],
      ),
    );
    expect(chain).toEqual({ broken: null, viewed: 60 });
  });
});

describe("security review E2-E7", () => {
  it("signed-in users can only create real workspaces; sample workspaces are server-only", async () => {
    await expect(asUser(a, (tx) => tx.query("select app.create_workspace('x', true)"))).rejects.toThrow(/does not exist/);
    await expectDenied(asUser(a, (tx) => tx.query("select app.create_sample_workspace($1, 'x')", [a])));
    const owner = await db.user("e2-sample@example.com"); // not B: B's workspaces stay just B Cafe for the visibility test
    const [row] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [owner]));
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
    const [su] = await db.root((tx) => tx.query<{ name: string }>("select quote_ident(current_user) as name"));
    await expectDenied(inject(`set role ${su.name}`));
    await expectDenied(inject("alter table app.audit_log disable row level security"));
    await expectDenied(inject("select * from app.documents"));
    await expectDenied(inject("update app.audit_log set action = 'x.y'"));
  });

  it("no function in app is executable by PUBLIC; roles get only explicit grants (Security F2-1)", async () => {
    const open = await db.root((tx) =>
      tx.query<{ fn: string }>(
        `select p.oid::regprocedure::text as fn from pg_proc p
         where p.pronamespace = 'app'::regnamespace
           and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
         order by 1`,
      ),
    );
    expect(open.map((r) => r.fn)).toEqual([]);
  });

  it("a member can't write or forge history rows directly, in any workspace (Security F2-1)", async () => {
    const forge = (org: string) =>
      asUser(a, (tx) => tx.query("select app.audit_write($1, $2, 'esign.signed', $1, $3)", [org, a, "c".repeat(64)]));
    await expectDenied(forge(orgB));
    await expectDenied(forge(orgA));
    await expectDenied(asUser(a, (tx) => tx.query("select app.audit_hash($1, 1, now(), $2, 'x.y', null, null, null)", [orgA, a])));
  });
});

describe("storage lockdown (Security C-4)", () => {
  const problems = async () => (await db.root((tx) => tx.query<{ p: string }>("select p from app.storage_lockdown_problems() p"))).map((r) => r.p);

  it("creates one private bucket for every file, and reports anything that would open storage to visitors", async () => {
    const [bucket] = await db.root((tx) =>
      tx.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        "select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'documents'",
      ),
    );
    expect(bucket).toEqual({ public: false, file_size_limit: "10485760", allowed_mime_types: ["application/pdf", "image/png", "image/jpeg"] });
    expect(await problems()).toEqual([]);

    await db.root((tx) => tx.query("create policy anyone_reads on storage.objects for select to anon using (true)"));
    await db.root((tx) => tx.query("update storage.buckets set public = true where id = 'documents'"));
    await db.root((tx) => tx.query("alter table storage.objects disable row level security"));
    expect(await problems()).toEqual([
      "row level security is off on storage.objects",
      "storage policy anyone_reads on storage.objects applies to anon",
      "bucket documents is public",
    ]);

    await db.root((tx) => tx.query("drop policy anyone_reads on storage.objects"));
    await db.root((tx) => tx.query("update storage.buckets set public = false where id = 'documents'"));
    await db.root((tx) => tx.query("alter table storage.objects enable row level security"));
    expect(await problems()).toEqual([]);
  });

  it("the check isn't callable from the app's roles", async () => {
    await expectDenied(asUser(a, (tx) => tx.query("select app.storage_lockdown_problems()")));
    await expectDenied(asAnon((tx) => tx.query("select app.storage_lockdown_problems()")));
  });
});

describe("rate-limit fingerprints (Security C-3 INFO)", () => {
  it("the daily purge clears windows that started over an hour ago with no traffic, and only the service role may run it", async () => {
    await db.root((tx) =>
      tx.query(
        "insert into app.rate_hits (bucket, key, window_start, n) values ('probe', 'old', now() - interval '61 minutes', 1), ('probe', 'fresh', now() - interval '5 minutes', 1)",
      ),
    );
    await expectDenied(asUser(a, (tx) => tx.query("select app.purge_rate_hits()")));
    const [run] = await asService((tx) => tx.query<{ n: number }>("select app.purge_rate_hits() as n"));
    expect(run.n).toBeGreaterThanOrEqual(1);
    const left = await db.root((tx) => tx.query<{ key: string }>("select key from app.rate_hits where bucket = 'probe'"));
    expect(left.map((r) => r.key)).toEqual(["fresh"]);
  });

  it("rateLimited refuses a window longer than an hour, which the purge would clear while it still counts", async () => {
    await expect(rateLimited("probe-window", "k", 1, 3601)).rejects.toThrow(/probe-window/);
    expect(await rateLimited("probe-window", "k", 1, 3600)).toBe(false);
  });
});

describe("works without BYPASSRLS, as on RDS and Aurora (AWS plan)", () => {
  it("service_role can't bypass row level security here, so every test proves the policies, not the bypass", async () => {
    const [role] = await db.root((tx) => tx.query<{ rolbypassrls: boolean }>("select rolbypassrls from pg_roles where rolname = 'service_role'"));
    expect(role.rolbypassrls).toBe(false);
  });

  it("every table with row level security gives service_role full access by policy", async () => {
    const missing = await db.root((tx) =>
      tx.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app' and c.relkind in ('r', 'p') and c.relrowsecurity
           and not exists (
             select 1 from pg_policies p
             where p.schemaname = 'app' and p.tablename = c.relname and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
               and 'service_role' = any (p.roles) and p.qual = 'true' and p.with_check = 'true')
         order by 1`,
      ),
    );
    expect(missing.map((r) => r.relname)).toEqual([]);
  });

  it("migrations set up plain Postgres (no Supabase schemas) as a non-superuser owner; the app's login owns nothing", async () => {
    const plain = await createLocalDriver(undefined, { supabaseStorage: false });
    try {
      const q = <T>(text: string) => plain.root((tx) => tx.query<T>(text));
      const files = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql"));
      expect((await q<{ n: number }>("select count(*)::int as n from meta.migrations"))[0].n).toBe(files.length);
      const roles = await q<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
        "select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('shipshape_owner', 'shipshape_app') order by 1",
      );
      expect(roles).toEqual([
        { rolname: "shipshape_app", rolsuper: false, rolbypassrls: false },
        { rolname: "shipshape_owner", rolsuper: false, rolbypassrls: false },
      ]);
      // Everything in app is the owner's: no object the superuser made, none the app could alter.
      const owners = await q<{ owner: string }>(
        `select distinct pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'app'
         union select distinct pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'`,
      );
      expect(owners).toEqual([{ owner: "shipshape_owner" }]);
      expect((await q<{ n: number }>("select count(*)::int as n from pg_tables where tableowner = 'shipshape_app'"))[0].n).toBe(0);
      expect(await q("select to_regnamespace('storage') as s")).toEqual([{ s: null }]);
      expect(await q("select * from app.storage_lockdown_problems()")).toEqual([]);

      // npm run migrate's end-of-run check (Security MG-2, MG-3) passes here, and catches the app
      // owning something other than a table, or another ShipShape role able to log in.
      const root: MigrationStep = { exec: async (s) => void (await q(s)), query: (text) => q(text) };
      expect(await roleProblems(root)).toEqual([]);
      await root.exec("create function public.runs_as_app() returns int language sql security definer as 'select 1'");
      await root.exec("alter function public.runs_as_app() owner to shipshape_app");
      await root.exec("alter role anon login");
      expect(await roleProblems(root)).toEqual(["shipshape_app owns 1 functions", "anon can log in"]);

      // Security S-PG1: no table forces row level security, so the app's login holding any role but
      // the three request roles (here the owner, through another role) or ADMIN on one is a problem.
      for (const s of ["drop function public.runs_as_app()", "alter role anon nologin"]) await root.exec(s);
      expect(await roleProblems(root)).toEqual([]);
      const run = async (...statements: string[]) => {
        for (const s of statements) await root.exec(s);
      };
      // Through another role into the owner: the owner's own grants come with it, ADMIN included.
      await run("create role middle nologin", "grant shipshape_owner to middle", "grant middle to shipshape_app");
      expect(await roleProblems(root)).toEqual([
        "shipshape_app is a member of middle",
        "shipshape_app is a member of shipshape_owner",
        "shipshape_app has ADMIN on anon",
        "shipshape_app has ADMIN on authenticated",
        "shipshape_app has ADMIN on service_role",
      ]);
      await run("revoke middle from shipshape_app");
      expect(await roleProblems(root)).toEqual([]);
      // A request role missing, another held with ADMIN.
      await run("revoke service_role from shipshape_app granted by shipshape_owner", "grant authenticated to shipshape_app with admin option");
      expect(await roleProblems(root)).toEqual(["shipshape_app isn't a member of service_role", "shipshape_app has ADMIN on authenticated"]);
    } finally {
      await plain.close();
    }
  });

  it("a master user that isn't a superuser (RDS) sets the database up, and re-runs (Security MG-1)", async () => {
    const pg = await PGlite.create();
    try {
      // Like RDS's master: can log in, create roles and databases, owns the database, no superuser.
      await pg.exec(
        "create role rds_master login createrole createdb; do $$ begin execute format('alter database %I owner to rds_master', current_database()); end $$; set session authorization rds_master",
      );
      const step = (t: Pick<PGlite, "exec" | "query">): MigrationStep => ({
        exec: async (s) => void (await t.exec(s)),
        query: async (text, params) => (await t.query<Record<string, unknown>>(text, params)).rows,
      });
      const conn = { ...step(pg), transaction: (fn: (t: MigrationStep) => Promise<void>) => pg.transaction((t) => fn(step(t))) };
      const names = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
      const files = await Promise.all(names.map(async (name) => ({ name, sql: await readFile(`supabase/migrations/${name}`, "utf8") })));
      const setup = [await readFile("supabase/platform/plain-postgres.sql", "utf8")];
      expect(await migrate(conn, setup, files)).toEqual(names);
      expect(await migrate(conn, setup, files)).toEqual([]);
      expect((await pg.query("select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as s")).rows).toEqual([{ u: "rds_master", s: false }]);
      expect(await roleProblems(step(pg))).toEqual([]);
    } finally {
      await pg.close();
    }
  });
});
