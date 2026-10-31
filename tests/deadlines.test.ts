import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/reminders/route";
import { asService, asUser } from "@/lib/server/db";
import { deadlinesIcs, listDeadlines, listOutbox, runReminders } from "@/lib/server/deadlines";
import { listDocuments } from "@/lib/server/documents";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
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

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-deadlines-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  const userId = await db.user(null);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  sample = { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Plumbing (sample)", role: "owner" };
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

describe("reminders", () => {
  it("sends each due reminder once: the certificate 30 days out and the lapsed permit", async () => {
    expect(await runReminders(today, sample.orgId)).toBe(2);
    expect(await runReminders(today, sample.orgId)).toBe(0);
    const out = await listOutbox(sample);
    expect(out.map((m) => m.subject).sort()).toEqual([
      "Certificate of liability insurance (sample) expires in 21 days",
      "City business license (sample) has lapsed",
    ]);
    expect(out.every((m) => m.to_email === "you@sample.example")).toBe(true);
  });

  it("sends the next reminder when the date gets closer, and the lapse reminder after it passes", async () => {
    expect(await runReminders(addDays(today, 15), sample.orgId)).toBe(1); // certificate: 6 days left, the 7-day reminder
    expect(await runReminders(addDays(today, 16), sample.orgId)).toBe(0);
    expect(await runReminders(addDays(today, 22), sample.orgId)).toBe(1); // certificate lapsed
  });

  it("goes to a real workspace's owners and admins, not to plain members", async () => {
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
    expect(await runReminders(today, org.id)).toBe(1);
    const sent = await db.root((tx) => tx.query<{ to_email: string; body: string }>("select to_email, body from app.outbox where org_id = $1", [org.id]));
    expect(sent.map((m) => m.to_email)).toEqual(["owner@example.com"]);
    expect(sent[0].body).toContain("Liquor license expires in 5 days");
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
});
