import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/reminders/route";
import { asService, asUser } from "@/lib/server/db";
import { deadlinesIcs, fold, listDeadlines, listOutbox, runReminders, type Deadline } from "@/lib/server/deadlines";
import { listDocuments } from "@/lib/server/documents";
import type { Ctx } from "@/lib/server/profile";
import { SAMPLE_EIN, seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";

let db: TestDb;
let blobDir: string;
let sample: Ctx;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = new Date().toISOString().slice(0, 10);

async function freshSample(): Promise<Ctx> {
  const userId = await db.user(null);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Plumbing (sample)", role: "owner", today: isoToday() };
}

/** A real Pro workspace with one owner, and a way to add documents that expire in so many days. */
async function proWorkspace(email: string) {
  const owner = await db.user(email);
  const [org] = await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Pro Co') as id"));
  await db.root((tx) =>
    tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, $2, 'active', 'pro')", [org.id, `cus_${org.id.replaceAll("-", "")}`]),
  );
  const expiresIn = (title: string, days: number) =>
    asUser(owner, (tx) =>
      tx.query("insert into app.documents (org_id, title, kind, expires_on, created_by) values ($1, $2, 'permit', $3, $4)", [org.id, title, addDays(today, days), owner]),
    );
  return { owner, orgId: org.id, expiresIn };
}

const event = (title: string, days_left: number): Deadline => ({
  document_id: "00000000-0000-4000-8000-000000000002",
  title,
  kind: "permit",
  date_kind: "expires",
  due_on: addDays("2026-10-31", days_left),
  days_left,
});

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-deadlines-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  sample = await freshSample();
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

describe("reminders", () => {
  // Each reminder test has a workspace of its own: what's been sent decides what's due next.
  it("sends each due reminder once: the certificate 30 days out and the lapsed permit", async () => {
    const sample = await freshSample();
    expect(await runReminders(today, sample.orgId)).toEqual({ sent: 2, failed: 0 });
    expect(await runReminders(today, sample.orgId)).toEqual({ sent: 0, failed: 0 });
    const out = await listOutbox(sample);
    expect(out.map((m) => m.subject).sort()).toEqual([
      "Certificate of liability insurance (sample) expires in 21 days",
      "City business license (sample) has lapsed",
    ]);
    expect(out.every((m) => m.to_email === "you@sample.example")).toBe(true);
    // Titles and dates only: no business facts or tax IDs in a message that leaves ShipShape.
    expect(out.some((m) => /\d{2}-?\d{7}|Harbor Plumbing LLC/.test(m.subject + m.body))).toBe(false);
  });

  it("sends the next reminder when the date gets closer, and the lapse reminder after it passes", async () => {
    const sample = await freshSample();
    expect(await runReminders(today, sample.orgId)).toEqual({ sent: 2, failed: 0 }); // today's: the 30-day reminder and the lapsed permit
    expect(await runReminders(addDays(today, 15), sample.orgId)).toEqual({ sent: 1, failed: 0 }); // certificate: 6 days left, the 7-day reminder
    expect(await runReminders(addDays(today, 16), sample.orgId)).toEqual({ sent: 0, failed: 0 });
    expect(await runReminders(addDays(today, 22), sample.orgId)).toEqual({ sent: 1, failed: 0 }); // certificate lapsed
  });

  it("go to a Pro workspace's owners and admins, not plain members; Free workspaces get none", async () => {
    const owner = await db.user("owner@example.com");
    const member = await db.user("member@example.com");
    const [org] = await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Real Co') as id"));
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [org.id, member]));
    await asUser(owner, (tx) =>
      tx.query("insert into app.documents (org_id, title, kind, expires_on, created_by) values ($1, 'Liquor license', 'license', $2, $3)", [
        org.id,
        addDays(today, 5),
        owner,
      ]),
    );
    expect(await runReminders(today, org.id)).toEqual({ sent: 0, failed: 0 }); // Free: the dates show in the app and calendar file only

    await db.root((tx) =>
      tx.query("insert into app.billing (org_id, stripe_customer_id, stripe_subscription_id, status, plan) values ($1, 'cus_R1', 'sub_R1', 'active', 'pro')", [org.id]),
    );
    expect(await runReminders(today, org.id)).toEqual({ sent: 1, failed: 0 });
    const sent = await db.root((tx) => tx.query<{ to_email: string; body: string }>("select to_email, body from app.outbox where org_id = $1", [org.id]));
    expect(sent.map((m) => m.to_email)).toEqual(["owner@example.com"]);
    expect(sent[0].body).toContain("Liquor license expires in 5 days");
  });

  it("an owner with a long but valid address (up to 254 characters) gets theirs, and stops nobody else's", async () => {
    const long = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(48)}.com`;
    expect(long.length).toBe(245);
    const proWithDueLicense = async (email: string) => {
      const owner = await db.user(email);
      const [org] = await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Pro Co') as id"));
      await asUser(owner, (tx) =>
        tx.query("insert into app.documents (org_id, title, kind, expires_on, created_by) values ($1, 'Contractor license', 'license', $2, $3)", [org.id, addDays(today, 5), owner]),
      );
      await db.root((tx) =>
        tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, $2, 'active', 'pro')", [org.id, `cus_${org.id.replaceAll("-", "")}`]),
      );
      return org.id;
    };
    const longOrg = await proWithDueLicense(long);
    const otherOrg = await proWithDueLicense("short@example.com");
    await runReminders(today); // every workspace in one run, as the daily job does
    const sent = await db.root((tx) => tx.query<{ org_id: string; to_email: string }>("select org_id, to_email from app.outbox where org_id = any($1::uuid[])", [[longOrg, otherOrg]]));
    expect(sent.map((m) => [m.org_id, m.to_email]).sort()).toEqual([[longOrg, long], [otherOrg, "short@example.com"]].sort());
  });

  it("start 90 days out: a date 90 days away gets its first reminder, one 91 days away doesn't yet", async () => {
    const pro = await proWorkspace("window@example.com");
    await pro.expiresIn("Permit at 90", 90);
    await pro.expiresIn("Permit at 91", 91);
    expect(await runReminders(today, pro.orgId)).toEqual({ sent: 1, failed: 0 });
    const sent = await db.root((tx) => tx.query<{ subject: string }>("select subject from app.outbox where org_id = $1", [pro.orgId]));
    expect(sent.map((m) => m.subject)).toEqual(["Permit at 90 expires in 90 days"]);
  });

  it("a date exactly 7 days out gets the 7-day reminder; 8 days out still gets the 30-day one", async () => {
    const pro = await proWorkspace("seven@example.com");
    await pro.expiresIn("Permit at 7", 7);
    await pro.expiresIn("Permit at 8", 8);
    expect(await runReminders(today, pro.orgId)).toEqual({ sent: 2, failed: 0 });
    const rows = await db.root((tx) =>
      tx.query<{ title: string; days_before: number }>(
        "select d.title, r.days_before from app.reminders_sent r join app.documents d on d.id = r.document_id where r.org_id = $1 order by d.title",
        [pro.orgId],
      ),
    );
    expect(rows).toEqual([
      { title: "Permit at 7", days_before: 7 },
      { title: "Permit at 8", days_before: 30 },
    ]);
  });

  it("go to an admin as well as the owner", async () => {
    const pro = await proWorkspace("boss@example.com");
    const admin = await db.user("admin@example.com");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'admin')", [pro.orgId, admin]));
    await pro.expiresIn("Dumpster permit", 5);
    expect(await runReminders(today, pro.orgId)).toEqual({ sent: 1, failed: 0 });
    const sent = await db.root((tx) => tx.query<{ to_email: string }>("select to_email from app.outbox where org_id = $1 order by to_email", [pro.orgId]));
    expect(sent.map((m) => m.to_email)).toEqual(["admin@example.com", "boss@example.com"]);
  });

  // Real Postgres only: PGlite has one connection, so two runs never overlap there.
  it.skipIf(!process.env.SHIPSHAPE_PG_TEST_URL)("two runs at the same moment (the cron delivered twice) send each reminder once (review #10)", async () => {
    const pro = await proWorkspace("twice@example.com");
    await pro.expiresIn("Elevator permit", 7);
    // Opens the pool's connections first, so the two runs really overlap.
    await Promise.all([1, 2, 3].map(() => asService((tx) => tx.query("select pg_sleep(0.1)"))));
    const runs = await Promise.all([runReminders(today, pro.orgId), runReminders(today, pro.orgId)]);
    expect(runs.map((r) => r.sent + r.failed).sort()).toEqual([0, 1]);
    expect(runs.map((r) => r.failed)).toEqual([0, 0]);
    const sent = await db.root((tx) => tx.query<{ to_email: string }>("select to_email from app.outbox where org_id = $1", [pro.orgId]));
    expect(sent.map((m) => m.to_email)).toEqual(["twice@example.com"]);
  });
});

describe("calendar file", () => {
  it("has one all-day event per upcoming date, none for lapsed ones, with 30- and 7-day alarms", async () => {
    const ics = deadlinesIcs(sample.name, await listDeadlines(sample), new Date("2026-10-31T12:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const events = ics.split("BEGIN:VEVENT").length - 1;
    const upcoming = (await listDeadlines(sample)).filter((d) => d.days_left >= 0);
    expect(events).toBe(upcoming.length);
    expect(ics).not.toContain("City business license"); // lapsed
    const docs = await listDocuments(sample);
    const coi = docs.find((d) => d.kind === "coi")!;
    expect(ics).toContain(`DTSTART;VALUE=DATE:${coi.expires_on!.replaceAll("-", "")}`);
    expect(ics).toContain("TRIGGER:-P7D");
    // The workspace's EIN and legal name never go into a calendar file (UIDs carry random UUIDs, so match the value itself).
    expect(ics.replaceAll("-", "")).not.toContain(SAMPLE_EIN.replace("-", ""));
    expect(ics).not.toContain("Harbor Plumbing LLC");
  });

  it("escapes calendar syntax in titles and keeps lines within 75 bytes", () => {
    const ics = deadlinesIcs("A, B; C", [
      { document_id: "00000000-0000-4000-8000-000000000001", title: "Permit; zone A, lot 7 — renewal with a very long name that keeps going past the limit", kind: "permit", date_kind: "renews", due_on: "2027-01-15", days_left: 76 },
    ]);
    expect(ics).toContain("X-WR-CALNAME:A\\, B\\; C deadlines");
    expect(ics).toContain("Permit\\; zone A\\, lot 7");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it("never folds a line in the middle of an emoji (review #21)", () => {
    // "SUMMARY:" plus 64 letters is 72 bytes; the 4-byte emoji would be cut after its first half.
    const line = `SUMMARY:${"a".repeat(64)}😀 expires`;
    const [first, second] = fold(line).split("\r\n");
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(75);
    expect(first.endsWith("a")).toBe(true); // a lone high surrogate would be 3 bytes of U+FFFD once written
    expect(second).toBe(" 😀 expires");
  });

  it("keeps a date that falls today and drops one that passed yesterday", () => {
    const ics = deadlinesIcs("W", [event("Due today", 0), event("Lapsed yesterday", -1)]);
    expect(ics).toContain("SUMMARY:Due today expires");
    expect(ics).not.toContain("Lapsed yesterday");
  });

  it("sets the 30-day alarm from 30 days out and the 7-day alarm from 7 days out, not later", () => {
    const alarms = (daysLeft: number) => deadlinesIcs("W", [event("Permit", daysLeft)]).match(/TRIGGER:-P\d+D/g) ?? [];
    expect(alarms(30)).toEqual(["TRIGGER:-P30D", "TRIGGER:-P7D"]);
    expect(alarms(29)).toEqual(["TRIGGER:-P7D"]);
    expect(alarms(7)).toEqual(["TRIGGER:-P7D"]);
    expect(alarms(6)).toEqual([]);
  });
});

describe("reminder job endpoint", () => {
  it("runs only with the scheduler's secret", async () => {
    const call = (auth?: string) => cron(new Request("http://x/api/cron/reminders", { headers: auth ? { authorization: auth } : {} }));
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer x")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    expect((await call()).status).toBe(403);
    expect((await call(`Bearer ${"t".repeat(40)}`)).status).toBe(403);
    const ok = await call(`Bearer ${"s".repeat(40)}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
    vi.unstubAllEnvs();
  });

  it("reports a failed run while files a deletion left can't be removed, and clears them once they can (Security N-091a)", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    const call = () => cron(new Request("http://x/api/cron/reminders", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }));
    const orphan = `${crypto.randomUUID()}/${crypto.randomUUID()}/v1.pdf`;
    await db.root((tx) => tx.query("insert into app.storage_cleanup (path) values ($1)", [orphan]));
    const local = localBlobStore(blobDir);
    setBlobStoreForTests({ ...local, remove: () => Promise.reject(new Error("AccessDenied")) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await call()).status).toBe(500);
    } finally {
      spy.mockRestore();
      setBlobStoreForTests(local);
    }
    expect((await call()).status).toBe(200);
    expect(await db.root((tx) => tx.query("select 1 from app.storage_cleanup where path = $1", [orphan]))).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("skips a reminder that can't be written, sends everyone else's, reports the run failed, and sends it next time (Security R-1tx)", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    const call = () => cron(new Request("http://x/api/cron/reminders", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }));
    const blocked = await freshSample();
    const fine = await freshSample();
    // Any row the outbox refuses, for one workspace only, as a future bad row would be.
    await db.root((tx) => tx.query(`alter table app.outbox add constraint test_refuse_one check (org_id <> '${blocked.orgId}'::uuid)`));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentTo = (org: string) => db.root((tx) => tx.query("select 1 from app.outbox where org_id = $1", [org]));
    const recorded = (org: string) => db.root((tx) => tx.query("select 1 from app.reminders_sent where org_id = $1", [org]));
    try {
      const run = await runReminders(today);
      expect(run.failed).toBe(2);
      expect(await sentTo(fine.orgId)).toHaveLength(2);
      expect(await sentTo(blocked.orgId)).toHaveLength(0);
      expect(await recorded(blocked.orgId)).toHaveLength(0);
      // One line per skipped reminder: its document and the error code, never an address.
      const logged = spy.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith("reminders: "));
      const blockedDocs = (await listDocuments(blocked)).map((d) => d.id);
      expect(logged).toHaveLength(2);
      expect(logged.every((m) => blockedDocs.some((id) => m === `reminders: ${id} not sent (23514)`))).toBe(true);
      expect((await call()).status).toBe(500);
    } finally {
      spy.mockRestore();
      await db.root((tx) => tx.query("alter table app.outbox drop constraint test_refuse_one"));
    }
    expect(await runReminders(today, blocked.orgId)).toEqual({ sent: 2, failed: 0 });
    expect((await call()).status).toBe(200);
    vi.unstubAllEnvs();
  });
});
