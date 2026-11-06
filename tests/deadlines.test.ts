import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/reminders/route";
import { asAnon, asService, asUser } from "@/lib/server/db";
import { deadlinesIcs, fold, groupTotal, listDeadlines, listOutbox, needsAttention, purgeOutbox, runReminders, shownDeadlines, type Deadline } from "@/lib/server/deadlines";
import type { Ctx } from "@/lib/server/profile";
import { SAMPLE_EIN, seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { fmtDay, isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { listDocuments } from "./support/documents";

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

  it("a date first seen one day out says 'in 1 day' in the subject and the body (wave 8 #6)", async () => {
    const pro = await proWorkspace("tomorrow@example.com");
    await pro.expiresIn("Dumpster permit", 1);
    expect(await runReminders(today, pro.orgId)).toEqual({ sent: 1, failed: 0 });
    const [m] = await db.root((tx) => tx.query<{ subject: string; body: string }>("select subject, body from app.outbox where org_id = $1", [pro.orgId]));
    expect(m.subject).toBe("Dumpster permit expires in 1 day");
    expect(m.body).toContain(`Dumpster permit expires in 1 day (${fmtDay(addDays(today, 1))}).`);
  });

  it("a document whose expiry and renewal fall on the same day gets one reminder that says both, ahead and once lapsed (W10-8)", async () => {
    const pro = await proWorkspace("same-day@example.com");
    await asUser(pro.owner, (tx) =>
      tx.query("insert into app.documents (org_id, title, kind, expires_on, renews_on, created_by) values ($1, 'Liquor license', 'permit', $2, $2, $3)", [
        pro.orgId,
        addDays(today, 7),
        pro.owner,
      ]),
    );
    expect(await runReminders(today, pro.orgId)).toEqual({ sent: 1, failed: 0 });
    const messages = () => db.root((tx) => tx.query<{ subject: string; body: string }>("select subject, body from app.outbox where org_id = $1 order by created_at", [pro.orgId]));
    const [ahead] = await messages();
    expect(ahead.subject).toBe("Liquor license expires and is due for renewal in 7 days");
    expect(ahead.body).toContain(`Liquor license expires and is due for renewal in 7 days (${fmtDay(addDays(today, 7))}).`);
    // Eight days on, both have passed: still one message.
    expect(await runReminders(addDays(today, 8), pro.orgId)).toEqual({ sent: 1, failed: 0 });
    const [, lapsed] = await messages();
    expect(lapsed.subject).toBe("Liquor license has lapsed");
    expect(lapsed.body).toContain(`Liquor license expired and passed its renewal date on ${fmtDay(addDays(today, 7))}.`);
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

describe("the outbox (0039: W10-4, W10-5)", () => {
  /** What the Deadlines page reads for this person in this workspace (listOutbox runs as them, so RLS alone decides). */
  const viewer = (userId: string, orgId: string, role: Ctx["role"], demo = false): Ctx => ({
    userId,
    demo,
    authAt: Math.floor(Date.now() / 1000),
    orgId,
    name: "Pro Co",
    role,
    today: isoToday(),
  });
  const addMember = (orgId: string, userId: string, role: Ctx["role"]) =>
    db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, $3)", [orgId, userId, role]));
  const remind = (orgId: string, subject: string) =>
    asService((tx) => tx.query("insert into app.outbox (org_id, to_email, subject, body) values ($1, 'boss@example.com', $2, 'x')", [orgId, subject]));

  /** A signing request on a new document, and a code issued for it the way the signer's page does (app.esign_issue_code, as anon). */
  async function issueCode(orgId: string, userId: string) {
    const secret = crypto.randomUUID().replaceAll("-", "").repeat(2);
    const req = await asUser(userId, async (tx) => {
      const [d] = await tx.query<{ id: string }>("insert into app.documents (org_id, title, kind, created_by) values ($1, 'NDA to sign', 'nda', $2) returning id", [orgId, userId]);
      await tx.query(
        "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, created_by) values ($1, 1, $2, $3, 'application/pdf', 100, $4, 'upload', $5)",
        [d.id, orgId, `${orgId}/${d.id}/1.pdf`, "a".repeat(64), userId],
      );
      const [r] = await tx.query<{ id: string }>(
        `insert into app.signature_requests (id, org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, created_by, to_sign_path, to_sign_sha256)
         select r.id, $1::uuid, $2, 1, 'Sam Signer', 'sam@example.com', $3, now() + interval '7 days', $4, $1::uuid::text || '/' || r.id::text || '/v1.pdf', $5
         from (select gen_random_uuid() as id) r returning id`,
        [orgId, d.id, secret, userId, "d".repeat(64)],
      );
      return r.id;
    });
    const [issued] = await asAnon((tx) =>
      tx.query<{ answer: string }>("select app.esign_issue_code($1, $2, $3, 'Your signing code', 'Your code is 123456.') as answer", [req, secret, "c".repeat(64)]),
    );
    expect(issued.answer).toBe("ok");
  }

  it("only the workspace's owners and admins read its reminders: a member sees none, nor does another workspace's owner (W10-4)", async () => {
    const pro = await proWorkspace("outbox-owner@example.com");
    const admin = await db.user("outbox-admin@example.com");
    const member = await db.user("outbox-member@example.com");
    await addMember(pro.orgId, admin, "admin");
    await addMember(pro.orgId, member, "member");
    const other = await proWorkspace("outbox-other@example.com");
    await remind(pro.orgId, "Permit expires in 7 days");
    await remind(pro.orgId, "Permit expires in 30 days");

    const subjects = async (ctx: Ctx) => (await listOutbox(ctx)).map((m) => m.subject).sort();
    expect(await subjects(viewer(pro.owner, pro.orgId, "owner"))).toEqual(["Permit expires in 30 days", "Permit expires in 7 days"]);
    expect(await subjects(viewer(admin, pro.orgId, "admin"))).toEqual(["Permit expires in 30 days", "Permit expires in 7 days"]);
    expect(await subjects(viewer(member, pro.orgId, "member"))).toEqual([]);
    expect(await subjects(viewer(other.owner, pro.orgId, "owner"))).toEqual([]);
    expect(await asUser(other.owner, (tx) => tx.query("select 1 from app.outbox where org_id = $1", [pro.orgId]))).toEqual([]);
  });

  it("a signing code is hidden from a real workspace's owner and admin, and shown in the sample workspace (W10-5)", async () => {
    const real = await proWorkspace("codes-owner@example.com");
    const admin = await db.user("codes-admin@example.com");
    await addMember(real.orgId, admin, "admin");
    await remind(real.orgId, "Permit expires in 7 days");
    await issueCode(real.orgId, real.owner);
    const kinds = await db.root((tx) => tx.query<{ kind: string }>("select kind from app.outbox where org_id = $1 order by kind", [real.orgId]));
    expect(kinds.map((r) => r.kind)).toEqual(["esign_code", "reminder"]);
    expect((await listOutbox(viewer(real.owner, real.orgId, "owner"))).map((m) => m.subject)).toEqual(["Permit expires in 7 days"]);
    expect((await listOutbox(viewer(admin, real.orgId, "admin"))).map((m) => m.subject)).toEqual(["Permit expires in 7 days"]);

    const sample = await freshSample();
    await issueCode(sample.orgId, sample.userId);
    expect((await listOutbox(sample)).map((m) => m.subject)).toContain("Your signing code");
  });

  it("purge_outbox can't be run by a signed-in user", async () => {
    const pro = await proWorkspace("purge-denied@example.com");
    await expect(asUser(pro.owner, (tx) => tx.query("select app.purge_outbox()"))).rejects.toThrow(/permission denied/);
  });

  it("the daily purge keeps an 89-day reminder and deletes a 91-day one, keeps a 23-hour code and deletes a 25-hour one; a second run deletes none", async () => {
    const pro = await proWorkspace("purge@example.com");
    const add = (subject: string, kind: string, age: string) =>
      asService((tx) =>
        tx.query("insert into app.outbox (org_id, to_email, subject, body, kind, created_at) values ($1, 'purge@example.com', $2, 'x', $3, now() - $4::interval)", [
          pro.orgId,
          subject,
          kind,
          age,
        ]),
      );
    await add("reminder 89 days", "reminder", "89 days");
    await add("reminder 91 days", "reminder", "91 days");
    await add("code 23 hours", "esign_code", "23 hours");
    await add("code 25 hours", "esign_code", "25 hours");
    const left = async () =>
      (await db.root((tx) => tx.query<{ subject: string }>("select subject from app.outbox where org_id = $1 order by subject", [pro.orgId]))).map((r) => r.subject);

    expect(await purgeOutbox()).toBe(2);
    expect(await left()).toEqual(["code 23 hours", "reminder 89 days"]);
    expect(await purgeOutbox()).toBe(0);
    expect(await left()).toEqual(["code 23 hours", "reminder 89 days"]);

    // The daily job runs it.
    await add("reminder 92 days", "reminder", "92 days");
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    const run = await cron(new Request("http://x/api/cron/reminders", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }));
    vi.unstubAllEnvs();
    expect(await run.json()).toMatchObject({ ok: true, outbox: 1 });
    expect(await left()).toEqual(["code 23 hours", "reminder 89 days"]);
  });
});

describe("the Deadlines page's dates", () => {
  it("lists the earliest of each part (lapsed, passed renewal notice, next 30 days, later) and counts every one", async () => {
    const { owner, orgId, expiresIn } = await proWorkspace("deadlines-shown@example.com");
    const ctx: Ctx = { userId: owner, demo: false, authAt: Math.floor(Date.now() / 1000), orgId, name: "Pro Co", role: "owner", today };
    for (const days of [-10, -5, -1, 0, 5, 30, 31, 60, 400]) await expiresIn(`D${days}`, days);
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind, renews_on) values ($1, 'R-3', 'other', $2)", [orgId, addDays(today, -3)]));

    const shown = await shownDeadlines(ctx, 2);
    expect(shown.map((d) => [d.title, d.part, d.part_total])).toEqual([
      ["D-10", "lapsed", 3],
      ["D-5", "lapsed", 3],
      ["R-3", "passed", 1],
      ["D0", "soon", 3],
      ["D5", "soon", 3],
      ["D31", "later", 3],
      ["D60", "later", 3],
    ]);
    // The page's Lapsed group is every date that passed, renewal notices too: 3 of its 4 shown.
    const lapsed = shown.filter((d) => d.days_left < 0);
    expect([lapsed.length, groupTotal(lapsed)]).toEqual([3, 4]);
    // What needs attention is what Home lists: lapsed expiries and anything in the next 30 days, not a passed renewal notice.
    expect(shown.filter(needsAttention).map((d) => d.title)).toEqual(["D-10", "D-5", "D0", "D5"]);
    expect(await shownDeadlines(ctx)).toHaveLength(10);
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
