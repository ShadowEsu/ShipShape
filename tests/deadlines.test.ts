import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/reminders/route";
import { asService, asUser } from "@/lib/server/db";
import { deadlinesIcs, listDeadlines, listOutbox, runReminders } from "@/lib/server/deadlines";
import { listDocuments } from "@/lib/server/documents";
import type { Ctx } from "@/lib/server/profile";
import { SAMPLE_EIN, seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
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
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Plumbing (sample)", role: "owner" };
}

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
    expect(await runReminders(today, sample.orgId)).toBe(2);
    expect(await runReminders(today, sample.orgId)).toBe(0);
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
    expect(await runReminders(today, sample.orgId)).toBe(2); // today's: the 30-day reminder and the lapsed permit
    expect(await runReminders(addDays(today, 15), sample.orgId)).toBe(1); // certificate: 6 days left, the 7-day reminder
    expect(await runReminders(addDays(today, 16), sample.orgId)).toBe(0);
    expect(await runReminders(addDays(today, 22), sample.orgId)).toBe(1); // certificate lapsed
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
    expect(await runReminders(today, org.id)).toBe(0); // Free: the dates show in the app and calendar file only

    await db.root((tx) =>
      tx.query("insert into app.billing (org_id, stripe_customer_id, stripe_subscription_id, status, plan) values ($1, 'cus_R1', 'sub_R1', 'active', 'pro')", [org.id]),
    );
    expect(await runReminders(today, org.id)).toBe(1);
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
});
