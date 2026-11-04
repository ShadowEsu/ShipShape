import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SendEmailCommandInput } from "@aws-sdk/client-sesv2";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/reminders/route";
import { POST as snsPost } from "@/app/api/mail/events/route";
import { asService, asUser } from "@/lib/server/db";
import { launchProblems } from "@/lib/server/launch-check";
import {
  ACCOUNT_DAILY_CAP,
  CONFIGURATION_SET,
  DAILY_CAP,
  footer,
  handleSesNotification,
  mailConfig,
  MAX_ATTEMPTS,
  sendQueuedMail,
  setMailSenderForTests,
  WAITLIST_OPEN,
  WELCOME,
  type MailConfig,
  type MailSender,
  deletionRecordAddress,
  sendDeletionRecord,
} from "@/lib/server/mail";
import { migrate, type MigrationStep } from "@/lib/server/migrations";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { stopAndForget, stopEmail } from "@/lib/server/suppression";
import { hashKey } from "@/lib/server/crypto";
import { deleteAccount } from "@/lib/server/account";
import { setSignInAdminForTests } from "@/lib/server/cognito";
import { UserError } from "@/lib/server/errors";
import { fmtDay, isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";

// Email through SES (B12; Security 2026-11-04 0715, answer 5, and 1058, K1-K5), against a fake SES and a
// fake SNS certificate host.

let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
  // The daily run's file sweeps, kept out of the working tree.
  setBlobStoreForTests(localBlobStore(await mkdtemp(path.join(os.tmpdir(), "shipshape-mail-"))));
});

const FROM = "reminders@shipshape.example";
const TOPIC = "arn:aws:sns:us-east-1:111122223333:shipshape-mail-events";
const CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef.pem";
const SUPPORT = "support@shipshape.example";
const ON = { SHIPSHAPE_EMAIL: "1", SHIPSHAPE_EMAIL_FROM: FROM, AWS_REGION: "us-east-1", SHIPSHAPE_SES_EVENTS_TOPIC_ARN: TOPIC, CONTACT_EMAIL: SUPPORT };
const APP = "https://app.shipshape.example";
/** Every kind on: the welcome and the waitlist note too, with the settings they need. */
const ALL_ON = { ...ON, SHIPSHAPE_EMAIL_WELCOME: "1", SHIPSHAPE_EMAIL_WAITLIST: "1", SHIPSHAPE_EMAIL_DELETION: "1", SHIPSHAPE_APP_URL: APP, SHIPSHAPE_POSTAL_ADDRESS: "1 Main St, Springfield" };
const stub = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
};
const emailOn = () => stub(ON);
/** The settings as the sender reads them; on, so never null. */
function config(env: Record<string, string>): MailConfig {
  const cfg = mailConfig(env);
  if (!cfg) throw new Error("email is off");
  return cfg;
}

/** A fake SES: records each request, answers with a message id, or throws what `fail` returns for a call. */
function fakeSes(fail: (n: number, input: SendEmailCommandInput) => Error | null = () => null) {
  const calls: SendEmailCommandInput[] = [];
  const ses: MailSender = {
    async send(input) {
      calls.push(input);
      const e = fail(calls.length, input);
      if (e) throw e;
      return `msg-${calls.length}`;
    },
  };
  setMailSenderForTests(ses);
  return { calls, to: () => calls.map((c) => c.Destination?.ToAddresses?.[0]) };
}
const sesError = (name: string, message: string) => Object.assign(new Error(message), { name });

beforeEach(async () => {
  await db.root(async (tx) => {
    await tx.query("delete from app.outbox");
    await tx.query("delete from app.email_suppressions");
    await tx.query("delete from app.waitlist");
  });
});
afterEach(() => {
  setMailSenderForTests(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let n = 0;
/** A person with an account address; `cognito`: signed up through Cognito (a verified email). */
async function account(name: string, { cognito = true } = {}) {
  const email = `${name}-${++n}@example.test`;
  const id = await db.user(email);
  if (cognito) await db.root((tx) => tx.query("insert into app.identities (provider, subject, user_id) values ('cognito', $1, $2)", [randomUUID(), id]));
  return { id, email };
}
async function workspace(ownerId: string) {
  const [org] = await asUser(ownerId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Mail Co') as id"));
  return org.id;
}
const join = (orgId: string, userId: string, role: string) => db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, $3)", [orgId, userId, role]));
/** An outbox row, as runReminders (or esign_issue_code, kind 'esign_code') writes it, `age` old. */
async function queue(orgId: string, to: string, { kind = "reminder", age = "1 minute", subject = "Permit expires in 7 days" } = {}) {
  const [row] = await db.root((tx) =>
    tx.query<{ id: string }>("insert into app.outbox (org_id, to_email, subject, body, kind, created_at) values ($1, $2, $3, 'Permit expires in 7 days (Nov 10, 2026).', $4, now() - $5::interval) returning id", [
      orgId,
      to,
      subject,
      kind,
      age,
    ]),
  );
  return row.id;
}
/** A welcome row for `userId` in `orgId`, to `to`, with the reviewed text (as app.queue_welcome writes it). */
async function queueWelcome(orgId: string, userId: string, to: string, { body = WELCOME.body } = {}) {
  const [r] = await db.root((tx) =>
    tx.query<{ id: string }>("insert into app.outbox (org_id, to_email, subject, body, kind, user_id) values ($1, $2, $3, $4, 'welcome', $5) returning id", [orgId, to, WELCOME.subject, body, userId]),
  );
  return r.id;
}
/** `address` on the waitlist (with `interests`), and its waitlist_open row (as scripts/waitlist-open-batch.sql writes it). */
async function queueWaitlist(address: string, { interests = [] as string[] } = {}) {
  await db.root((tx) => tx.query("insert into app.waitlist (email, interests) values ($1, $2) on conflict (email) do nothing", [address, interests]));
  const [r] = await db.root((tx) =>
    tx.query<{ id: string }>(
      "insert into app.outbox (to_email, subject, body, kind, waitlist_email, address_sha256) values ($1, $2, $3, 'waitlist_open', $1, encode(sha256(convert_to(lower($1), 'UTF8')), 'hex')) returning id",
      [address, WAITLIST_OPEN.subject, WAITLIST_OPEN.body],
    ),
  );
  return r.id;
}
const row = async (id: string) =>
  (
    await db.root((tx) =>
      tx.query<{ sent: boolean; claimed: boolean; attempts: number; last_error: string | null; ses_message_id: string | null }>(
        "select sent_at is not null as sent, claimed_at is not null as claimed, attempts, last_error, ses_message_id from app.outbox where id = $1",
        [id],
      ),
    )
  )[0];

describe("off by default", () => {
  it("sends nothing, touches no row, and the daily run answers as before", async () => {
    const ses = fakeSes();
    const owner = await account("off-owner");
    const id = await queue(await workspace(owner.id), owner.email);
    expect(mailConfig(process.env)).toBeNull();
    expect(await sendQueuedMail()).toBeNull();
    // A kind's own flag does nothing without SHIPSHAPE_EMAIL=1 (Security K5).
    stub({ ...ALL_ON, SHIPSHAPE_EMAIL: "" });
    await queueWelcome(await workspace((await account("off-welcome")).id), owner.id, owner.email);
    await queueWaitlist("off-waitlist@example.test");
    expect(mailConfig(process.env)).toBeNull();
    expect(await sendQueuedMail()).toBeNull();
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    const run = await cron(new Request("http://x/api/cron/reminders", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }));
    expect(run.status).toBe(200);
    expect(Object.keys(await run.json())).not.toContain("mail");
    expect(ses.calls).toEqual([]);
    expect(await row(id)).toEqual({ sent: false, claimed: false, attempts: 0, last_error: null, ses_message_id: null });
  });

  it("only SHIPSHAPE_EMAIL=1 turns it on; on, every setting must be there and valid, and the launch check says which", async () => {
    expect(mailConfig({ ...ON, SHIPSHAPE_EMAIL: "true" })).toBeNull();
    expect(mailConfig({ ...ON, SHIPSHAPE_EMAIL: "" })).toBeNull();
    expect(mailConfig(ON)).toEqual({
      from: FROM,
      region: "us-east-1",
      topicArn: TOPIC,
      support: SUPPORT,
      replyReaches: false,
      kinds: ["reminder"],
      deletionRecord: false,
      appUrl: null,
      postalAddress: null,
    });
    expect(mailConfig({ ...ALL_ON, SHIPSHAPE_APP_URL: `${APP}/somewhere` })).toMatchObject({ kinds: ["reminder", "welcome", "waitlist_open"], deletionRecord: true, appUrl: APP, postalAddress: "1 Main St, Springfield" });
    expect(() => mailConfig({ ...ON, CONTACT_EMAIL: "" })).toThrow("CONTACT_EMAIL");
    // Each kind's flag is exactly 1 or unset; on, it needs what its email holds.
    for (const flag of ["SHIPSHAPE_EMAIL_WELCOME", "SHIPSHAPE_EMAIL_WAITLIST", "SHIPSHAPE_EMAIL_DELETION"]) {
      expect(() => mailConfig({ ...ALL_ON, [flag]: "true" })).toThrow(`${flag} must be 1 or unset`);
    }
    expect(() => mailConfig({ ...ON, SHIPSHAPE_EMAIL_WELCOME: "1" })).toThrow("SHIPSHAPE_EMAIL_WELCOME=1 needs SHIPSHAPE_APP_URL");
    expect(() => mailConfig({ ...ALL_ON, SHIPSHAPE_POSTAL_ADDRESS: " " })).toThrow("SHIPSHAPE_EMAIL_WAITLIST=1 needs SHIPSHAPE_POSTAL_ADDRESS");
    expect(() => mailConfig({ ...ALL_ON, SHIPSHAPE_POSTAL_ADDRESS: "1 Main St\nSpringfield" })).toThrow("SHIPSHAPE_POSTAL_ADDRESS");
    expect(mailConfig({ ...ALL_ON, SHIPSHAPE_EMAIL_WAITLIST: "", SHIPSHAPE_POSTAL_ADDRESS: "" })).toMatchObject({ kinds: ["reminder", "welcome"], postalAddress: null });
    expect(() => mailConfig({ ...ON, SHIPSHAPE_EMAIL_FROM: "" })).toThrow("SHIPSHAPE_EMAIL_FROM");
    expect(() => mailConfig({ ...ON, SHIPSHAPE_EMAIL_FROM: "not an address" })).toThrow("SHIPSHAPE_EMAIL_FROM");
    expect(() => mailConfig({ ...ON, AWS_REGION: "" })).toThrow("AWS_REGION");
    expect(() => mailConfig({ ...ON, SHIPSHAPE_SES_EVENTS_TOPIC_ARN: "" })).toThrow("SHIPSHAPE_SES_EVENTS_TOPIC_ARN");
    expect(() => mailConfig({ ...ON, SHIPSHAPE_SES_EVENTS_TOPIC_ARN: TOPIC.replace("us-east-1", "eu-west-1") })).toThrow("SHIPSHAPE_SES_EVENTS_TOPIC_ARN");

    const mailProblems = (env: Record<string, string>) => launchProblems({ VERCEL_ENV: "production", ...env }).filter((p) => /SHIPSHAPE_EMAIL|Email sending/.test(p));
    expect(mailProblems({})).toEqual([]);
    expect(mailProblems(ON)).toEqual([]);
    expect(mailProblems({ ...ON, SHIPSHAPE_EMAIL_FROM: "" })).toEqual(["Email sending (SHIPSHAPE_EMAIL=1) needs SHIPSHAPE_EMAIL_FROM, the SES-verified sender address"]);
    expect(mailProblems({ SHIPSHAPE_EMAIL: "yes" })).toEqual(["SHIPSHAPE_EMAIL must be 1 or unset"]);
  });
});

describe("sending (SHIPSHAPE_EMAIL=1)", () => {
  beforeEach(emailOn);

  it("sends only reminders, only to the Cognito-verified account address of an owner or admin of the row's workspace", async () => {
    const ses = fakeSes();
    const owner = await account("owner");
    const org = await workspace(owner.id);
    const admin = await account("admin");
    await join(org, admin.id, "admin");
    const member = await account("member");
    await join(org, member.id, "member");
    const local = await account("local-admin", { cognito: false });
    await join(org, local.id, "admin");
    const leaving = await account("leaving-admin");
    await join(org, leaving.id, "admin");
    await db.root((tx) => tx.query("insert into app.deletion_requests (user_id) values ($1)", [leaving.id]));
    const elsewhere = await account("other-owner");
    await workspace(elsewhere.id);
    const sampleOwner = await account("sample-owner");
    const [sample] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [sampleOwner.id]));

    await queue(org, owner.email.toUpperCase());
    await queue(org, admin.email);
    await queue(org, member.email);
    await queue(org, local.email);
    await queue(org, leaving.email);
    await queue(org, elsewhere.email); // an account holder, but not of this workspace
    await queue(org, "vendor@supplier.example");
    await queue(org, owner.email, { kind: "esign_code", subject: "Your ShipShape signing code" });
    await queue(org, owner.email, { age: "4 days" });
    await queue(sample.id, sampleOwner.email);

    expect(await sendQueuedMail()).toEqual({ sent: 2, failed: 0, held: 0 });
    expect(ses.to().sort()).toEqual([owner.email.toUpperCase(), admin.email].sort());
  });

  it("asks SES for a plain-text message through the configuration set, ending with why it came and how to stop it: no HTML part, no tracking, nothing else", async () => {
    const ses = fakeSes();
    const owner = await account("shape");
    const id = await queue(await workspace(owner.id), owner.email);
    await sendQueuedMail();
    expect(ses.calls).toEqual([
      {
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [owner.email] },
        Content: {
          Simple: {
            Subject: { Data: "Permit expires in 7 days", Charset: "UTF-8" },
            Body: { Text: { Data: `Permit expires in 7 days (Nov 10, 2026).\n\n--\n${footer(config(ON), "reminder")}`, Charset: "UTF-8" } },
          },
        },
        ConfigurationSetName: "shipshape-mail",
      },
    ]);
    expect(CONFIGURATION_SET).toBe("shipshape-mail");
    expect(await row(id)).toEqual({ sent: true, claimed: true, attempts: 1, last_error: null, ses_message_id: "msg-1" });
  });

  it("never sends a row twice: not on the next run, not from two runs at once, not after a run died between SES and marking it sent", async () => {
    const ses = fakeSes();
    const owner = await account("twice");
    const org = await workspace(owner.id);
    const id = await queue(org, owner.email);
    await sendQueuedMail();
    await sendQueuedMail();
    expect(ses.calls).toHaveLength(1);

    const a = await queue(org, owner.email, { subject: "A" });
    const b = await queue(org, owner.email, { subject: "B" });
    await Promise.all([sendQueuedMail(), sendQueuedMail()]);
    expect(ses.calls.map((c) => c.Content?.Simple?.Subject?.Data).sort()).toEqual(["A", "B", "Permit expires in 7 days"]);
    expect([await row(a), await row(b), await row(id)].every((r) => r.sent && r.attempts === 1)).toBe(true);

    // Claimed and never marked sent: the outcome is unknown, so it isn't tried again.
    const lost = await queue(org, owner.email, { subject: "Lost" });
    await db.root((tx) => tx.query("update app.outbox set claimed_at = now(), attempts = 1 where id = $1", [lost]));
    await sendQueuedMail();
    expect(ses.calls.map((c) => c.Content?.Simple?.Subject?.Data)).not.toContain("Lost");
  });

  it("records a failed send by the error's name, retries it on the next run, and gives up after MAX_ATTEMPTS", async () => {
    const owner = await account("retry");
    const org = await workspace(owner.id);
    const id = await queue(org, owner.email);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let ses = fakeSes(() => sesError("MessageRejected", `Email address is not verified: ${owner.email}`));
    expect(await sendQueuedMail()).toEqual({ sent: 0, failed: 1, held: 0 });
    expect(await row(id)).toEqual({ sent: false, claimed: false, attempts: 1, last_error: "MessageRejected", ses_message_id: null });
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([`mail: ${id} not sent (MessageRejected)`]);

    ses = fakeSes();
    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(ses.calls).toHaveLength(1);
    expect(await row(id)).toEqual({ sent: true, claimed: true, attempts: 2, last_error: null, ses_message_id: "msg-1" });

    const stubborn = await queue(org, owner.email, { subject: "Stubborn" });
    ses = fakeSes(() => sesError("MessageRejected", "no"));
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await sendQueuedMail();
    expect(ses.calls).toHaveLength(MAX_ATTEMPTS);
    expect((await row(stubborn)).attempts).toBe(MAX_ATTEMPTS);
  });

  it("stops the run when SES says to slow down or stop; the rest wait for the next run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = await account("throttled");
    const org = await workspace(owner.id);
    await queue(org, owner.email, { subject: "First" });
    await queue(org, owner.email, { subject: "Second" });
    const ses = fakeSes(() => sesError("TooManyRequestsException", "Maximum sending rate exceeded."));
    expect(await sendQueuedMail()).toEqual({ sent: 0, failed: 1, held: 1 });
    expect(ses.calls).toHaveLength(1);
  });

  it("caps one account at ACCOUNT_DAILY_CAP a day, and everything at DAILY_CAP", async () => {
    let ses = fakeSes();
    const owner = await account("busy");
    const org = await workspace(owner.id);
    const admin = await account("busy-admin");
    await join(org, admin.id, "admin");
    for (let i = 0; i < ACCOUNT_DAILY_CAP + 2; i++) await queue(org, owner.email, { subject: `Doc ${i}` });
    await queue(org, admin.email, { subject: "Admin's" });
    expect(await sendQueuedMail()).toEqual({ sent: ACCOUNT_DAILY_CAP + 1, failed: 0, held: 2 });
    expect(ses.to().filter((t) => t === owner.email)).toHaveLength(ACCOUNT_DAILY_CAP);
    expect(ses.to()).toContain(admin.email);
    // Later the same day: the owner's two still wait.
    ses = fakeSes();
    expect(await sendQueuedMail()).toEqual({ sent: 0, failed: 0, held: 2 });

    await db.root((tx) => tx.query("delete from app.outbox"));
    // Everything sent in the last 24 hours counts toward the overall cap, whoever it went to.
    await db.root((tx) =>
      tx.query(
        "insert into app.outbox (org_id, to_email, subject, body, claimed_at, sent_at, attempts) select $1, 'earlier' || g || '@example.test', 's', 'b', now(), now(), 1 from generate_series(1, $2::int) g",
        [org, DAILY_CAP - 1],
      ),
    );
    // Oldest first: the older one takes the last place.
    await queue(org, owner.email, { subject: "Fits", age: "2 minutes" });
    await queue(org, admin.email, { subject: "Over", age: "1 minute" });
    ses = fakeSes();
    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 1 });
    expect(ses.calls.map((c) => c.Content?.Simple?.Subject?.Data)).toEqual(["Fits"]);
  });

  it("rows that can't go out (out of attempts, or claimed by a run that died) never crowd out one that can", async () => {
    const ses = fakeSes();
    const owner = await account("crowded");
    const org = await workspace(owner.id);
    // Older than the fresh row, so they'd fill the run's DAILY_CAP places first; claimed over a day ago, so the caps don't count them.
    await db.root((tx) =>
      tx.query(
        `insert into app.outbox (org_id, to_email, subject, body, created_at, claimed_at, attempts)
         select $1, $2, 'dead', 'b', now() - interval '2 days', case when g % 2 = 0 then now() - interval '2 days' end, case when g % 2 = 0 then 1 else $3::int end
         from generate_series(1, $4::int) g`,
        [org, owner.email, MAX_ATTEMPTS, DAILY_CAP * 2],
      ),
    );
    await queue(org, owner.email, { subject: "Fresh" });
    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(ses.calls.map((c) => c.Content?.Simple?.Subject?.Data)).toEqual(["Fresh"]);
  });

  it("the daily run emails the reminders it just wrote, and says so", async () => {
    const ses = fakeSes();
    const owner = await account("cron");
    const org = await workspace(owner.id);
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, $2, 'active', 'pro')", [org, `cus_${org.replaceAll("-", "")}`]));
    await asUser(owner.id, (tx) => tx.query("insert into app.documents (org_id, title, kind, expires_on, created_by) values ($1, 'Liquor permit', 'permit', current_date + 7, $2)", [org, owner.id]));
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    const run = await cron(new Request("http://x/api/cron/reminders", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }));
    expect(run.status).toBe(200);
    expect((await run.json()).mail).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(ses.calls).toHaveLength(1);
    expect(ses.calls[0].Destination?.ToAddresses).toEqual([owner.email]);
    expect(ses.calls[0].Content?.Simple?.Subject?.Data).toBe("Liquor permit expires in 7 days");
    // Exactly one "why you got this" line (Security F1): the footer's, which also says how to stop.
    const text = ses.calls[0].Content?.Simple?.Body?.Text?.Data ?? "";
    expect(text.endsWith(`\n\n--\n${footer(config(ON), "reminder")}`)).toBe(true);
    expect(text.match(/because/gi)).toHaveLength(1);
  });

  it("a failed send fails the daily run, so it shows; the next run sends it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const owner = await account("cron-fail");
    const org = await workspace(owner.id);
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, $2, 'active', 'pro')", [org, `cus_${org.replaceAll("-", "")}`]));
    await asUser(owner.id, (tx) => tx.query("insert into app.documents (org_id, title, kind, expires_on, created_by) values ($1, 'Food permit', 'permit', current_date + 30, $2)", [org, owner.id]));
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    const call = () => cron(new Request("http://x/api/cron/reminders", { headers: { authorization: `Bearer ${"s".repeat(40)}` } }));
    fakeSes(() => sesError("MessageRejected", "no"));
    expect((await call()).status).toBe(500);
    const ses = fakeSes();
    const run = await call();
    expect(run.status).toBe(200);
    expect((await run.json()).mail).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(ses.to()).toEqual([owner.email]);
  });

  it("stops at the daily run's budget; what's left waits for the next run", async () => {
    const ses = fakeSes();
    const owner = await account("late");
    const org = await workspace(owner.id);
    await queue(org, owner.email, { subject: "One" });
    await queue(org, owner.email, { subject: "Two" });
    expect(await sendQueuedMail(Date.now() - 1)).toEqual({ sent: 0, failed: 0, held: 2 });
    expect(ses.calls).toEqual([]);
    expect(await sendQueuedMail()).toEqual({ sent: 2, failed: 0, held: 0 });
  });
});

describe("kinds (Security 1058, K1, K2, K5)", () => {
  /** A signing request to `signer` on a new document in `orgId` (revoked: no file to sign needed). */
  async function signerOf(orgId: string, signer: string) {
    await db.root(async (tx) => {
      const [d] = await tx.query<{ id: string }>("insert into app.documents (org_id, title, kind) values ($1, 'NDA', 'nda') returning id", [orgId]);
      await tx.query("insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin) values ($1, 1, $2, $3, 'application/pdf', 100, $4, 'upload')", [
        d.id,
        orgId,
        `${orgId}/${d.id}/v1.pdf`,
        "c".repeat(64),
      ]);
      await tx.query(
        "insert into app.signature_requests (org_id, document_id, version, signer_name, signer_email, token_hash, expires_at, status) values ($1, $2, 1, 'Sam Signer', $3, $4, now() + interval '7 days', 'revoked')",
        [orgId, d.id, signer, randomUUID().replaceAll("-", "").repeat(2)],
      );
    });
  }
  const subjects = ({ calls }: { calls: SendEmailCommandInput[] }) => calls.map((c) => `${c.Content?.Simple?.Subject?.Data} -> ${c.Destination?.ToAddresses?.[0]}`).sort();

  it("with every kind on, a vendor's, a signer's and a sample visitor's address never qualifies for any kind; each kind's own recipient does", async () => {
    stub(ALL_ON);
    const ses = fakeSes();
    const owner = await account("kinds-owner");
    const org = await workspace(owner.id);
    const member = await account("kinds-member");
    await join(org, member.id, "member");
    const admin = await account("kinds-admin");
    await join(org, admin.id, "admin");
    const vendor = `vendor-${++n}@supplier.example`;
    await db.root((tx) => tx.query("insert into app.vendors (org_id, name, email, requested) values ($1, 'Supplier', $2, array['w9'])", [org, vendor]));
    const signer = `signer-${++n}@client.example`;
    await signerOf(org, signer);
    const contact = `contact-${++n}@client.example`;
    await db.root((tx) => tx.query("insert into app.contacts (org_id, name, email, source) values ($1, 'Pat', $2, 'typed')", [org, contact]));
    // A sample visitor has no address; its workspace's reminders go to a made-up one (deadlines.ts).
    const visitor = await db.user(null);
    const [sample] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [visitor]));
    const sampleOwner = await account("kinds-sample-owner");
    const [sample2] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [sampleOwner.id]));

    for (const address of [vendor, signer, contact, "you@sample.example"]) {
      await queue(org, address);
      // A welcome is one per person: each of these is a new account's, addressed to someone else.
      const holder = await account("kinds-holder");
      await queueWelcome(await workspace(holder.id), holder.id, address);
      // Even one that joined the waitlist itself.
      await queueWaitlist(address);
    }
    await queue(sample.id, "you@sample.example");
    await queueWelcome(sample.id, visitor, "you@sample.example");
    await queueWelcome(sample2.id, sampleOwner.id, sampleOwner.email);
    // Each kind's other refusals: a welcome for a member or an admin, or to an address that isn't the row's person's;
    // a waitlist address with a Collect interest, or that belongs to an account.
    await queueWelcome(org, member.id, member.email);
    await queueWelcome(org, admin.id, admin.email);
    const stranger = await account("kinds-stranger");
    await queueWelcome(await workspace(stranger.id), stranger.id, owner.email);
    await queueWaitlist(`collector-${++n}@example.test`, { interests: ["collect"] });
    await queueWaitlist(owner.email);
    // Signing codes are not on the list.
    await queue(org, owner.email, { kind: "esign_code", subject: "Your ShipShape signing code" });

    // The ones that qualify.
    await queue(org, owner.email);
    await queueWelcome(org, owner.id, owner.email);
    const fan = `fan-${++n}@example.test`;
    await queueWaitlist(fan);

    const run = await sendQueuedMail();
    expect(subjects(ses)).toEqual([`Permit expires in 7 days -> ${owner.email}`, `${WAITLIST_OPEN.subject} -> ${fan}`, `${WELCOME.subject} -> ${owner.email}`].sort());
    expect(run).toEqual({ sent: 3, failed: 0, held: 0 });
  });

  it("a kind whose flag is off sends nothing, and its rows wait untouched; turning its flag on sends it", async () => {
    emailOn();
    let ses = fakeSes();
    const owner = await account("flags");
    const org = await workspace(owner.id);
    await queue(org, owner.email);
    const welcome = await queueWelcome(org, owner.id, owner.email);
    const fan = `flags-fan-${++n}@example.test`;
    const waitlist = await queueWaitlist(fan);

    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(subjects(ses)).toEqual([`Permit expires in 7 days -> ${owner.email}`]);
    for (const id of [welcome, waitlist]) expect(await row(id)).toEqual({ sent: false, claimed: false, attempts: 0, last_error: null, ses_message_id: null });

    stub({ SHIPSHAPE_EMAIL_WELCOME: "1", SHIPSHAPE_APP_URL: APP });
    ses = fakeSes();
    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(subjects(ses)).toEqual([`${WELCOME.subject} -> ${owner.email}`]);
    expect((await row(waitlist)).claimed).toBe(false);

    stub({ SHIPSHAPE_EMAIL_WAITLIST: "1", SHIPSHAPE_POSTAL_ADDRESS: "1 Main St, Springfield" });
    ses = fakeSes();
    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(subjects(ses)).toEqual([`${WAITLIST_OPEN.subject} -> ${fan}`]);
  });

  it("sends each kind as plain text through the configuration set: its reviewed text with the app's address filled in, then its footer; a row with any other text isn't sent", async () => {
    stub(ALL_ON);
    const cfg = config(ALL_ON);
    const ses = fakeSes();
    const owner = await account("texts");
    const org = await workspace(owner.id);
    await queueWelcome(org, owner.id, owner.email);
    const fan = `texts-fan-${++n}@example.test`;
    await queueWaitlist(fan);
    expect(await sendQueuedMail()).toEqual({ sent: 2, failed: 0, held: 0 });
    const request = (to: string, text: { subject: string; body: string }, kind: "welcome" | "waitlist_open") => ({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: text.subject, Charset: "UTF-8" }, Body: { Text: { Data: `${text.body.replaceAll("{app_url}", APP)}\n\n--\n${footer(cfg, kind)}`, Charset: "UTF-8" } } } },
      ConfigurationSetName: CONFIGURATION_SET,
    });
    expect(ses.calls).toEqual([request(owner.email, WELCOME, "welcome"), request(fan, WAITLIST_OPEN, "waitlist_open")]);
    expect(ses.calls.every((c) => !/[{}]/.test(c.Content?.Simple?.Body?.Text?.Data ?? ""))).toBe(true);
    expect(ses.calls[0].Content?.Simple?.Body?.Text?.Data).toContain(`Open your workspace: ${APP}/app`);
    expect(ses.calls[1].Content?.Simple?.Body?.Text?.Data).toContain(`Create your account: ${APP}/signin`);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const other = await account("texts-other");
    const id = await queueWelcome(await workspace(other.id), other.id, other.email, { body: "Something else entirely." });
    expect(await sendQueuedMail()).toEqual({ sent: 0, failed: 1, held: 0 });
    expect(ses.calls).toHaveLength(2);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([`mail: ${id} not sent (not the reviewed text)`]);
  });

  it("every kind counts toward the same caps: an address's ACCOUNT_DAILY_CAP and the overall DAILY_CAP", async () => {
    stub(ALL_ON);
    const ses = fakeSes();
    const owner = await account("shared-cap");
    const org = await workspace(owner.id);
    for (let i = 0; i < ACCOUNT_DAILY_CAP; i++) await queue(org, owner.email, { subject: `Doc ${i}`, age: "2 minutes" });
    await queueWelcome(org, owner.id, owner.email);
    expect(await sendQueuedMail()).toEqual({ sent: ACCOUNT_DAILY_CAP, failed: 0, held: 1 });
    expect(ses.calls.map((c) => c.Content?.Simple?.Subject?.Data)).not.toContain(WELCOME.subject);

    await db.root((tx) => tx.query("delete from app.outbox"));
    await db.root((tx) =>
      tx.query(
        "insert into app.outbox (org_id, to_email, subject, body, claimed_at, sent_at, attempts) select $1, 'earlier' || g || '@example.test', 's', 'b', now(), now(), 1 from generate_series(1, $2::int) g",
        [org, DAILY_CAP],
      ),
    );
    await queueWaitlist(`capped-${++n}@example.test`);
    expect(await sendQueuedMail()).toEqual({ sent: 0, failed: 0, held: 1 });
  });
});

describe("stop (Security 1058, K3)", () => {
  const stop = (address: string) => stopEmail((text, params) => asService((tx) => tx.query(text, params)), address, hashKey());

  it("a stopped address gets nothing of any kind, however it's written; a second stop changes nothing, and a typo is refused", async () => {
    stub(ALL_ON);
    const ses = fakeSes();
    const owner = await account("stopped");
    const org = await workspace(owner.id);
    const fan = `stopped-fan-${++n}@example.test`;
    expect(await stop(` ${owner.email.toUpperCase()} `)).toBe(true);
    expect(await stop(fan)).toBe(true);
    expect(await stop(owner.email)).toBe(false);
    await expect(stop("not an address")).rejects.toThrow("isn't an email address");
    expect(await db.root((tx) => tx.query<{ reason: string }>("select reason from app.email_suppressions"))).toEqual([{ reason: "stop" }, { reason: "stop" }]);

    await queue(org, owner.email);
    await queueWelcome(org, owner.id, owner.email);
    await queueWaitlist(fan);
    expect(await sendQueuedMail()).toEqual({ sent: 0, failed: 0, held: 3 });
    expect(ses.calls).toEqual([]);
  });

  it("the operator's stop (scripts/email-stop.ts, as shipshape_owner) also deletes the waitlist entry, so 'come off the list' is true (Security S-W1)", async () => {
    stub(ALL_ON);
    const ses = fakeSes();
    const fan = `leaving-fan-${++n}@example.test`;
    await queueWaitlist(fan);
    const asOwner = (address: string) =>
      db.root(async (tx) => {
        await tx.query("set local role shipshape_owner");
        return stopAndForget((text, params) => tx.query(text, params), address, hashKey());
      });
    expect(await asOwner(` ${fan.toUpperCase()} `)).toEqual({ added: true, waitlistRemoved: true });
    expect(await db.root((tx) => tx.query("select 1 from app.waitlist where email = $1", [fan]))).toEqual([]);
    expect(await asOwner(fan)).toEqual({ added: false, waitlistRemoved: false });
    expect(await sendQueuedMail()).toMatchObject({ sent: 0 });
    expect(ses.calls).toEqual([]);
  });

  it("a footer says 'reply' only when the sender is the support address; otherwise it says to write to it, and every kind's footer gives a way to stop", () => {
    const kinds = ["reminder", "welcome", "waitlist_open"] as const;
    const elsewhere = config(ALL_ON);
    const inbox = config({ ...ALL_ON, SHIPSHAPE_EMAIL_FROM: SUPPORT.toUpperCase() });
    expect([elsewhere.replyReaches, inbox.replyReaches]).toEqual([false, true]);
    for (const kind of kinds) {
      expect(footer(elsewhere, kind)).not.toMatch(/reply/i);
      expect(footer(elsewhere, kind)).toContain(`write to ${SUPPORT}`);
      expect(footer(inbox, kind)).toMatch(/reply/i);
    }
    // The ways to stop: a reminder's document archived or undated; the others, a "stop" to the support address.
    expect(footer(elsewhere, "reminder")).toMatch(/To stop reminders about this document, archive it or clear its dates/);
    expect(footer(elsewhere, "welcome")).toMatch(/To get no more email from ShipShape, write to that address\./);
    expect(footer(elsewhere, "waitlist_open")).toMatch(/To come off the list, write to that address\./);
  });
});

describe("the waitlist batch (Security 1058, B)", () => {
  /** scripts/waitlist-open-batch.sql as psql runs it with -v batch_size=<size>. */
  async function batch(size: number) {
    const sql = (await readFile("scripts/waitlist-open-batch.sql", "utf8")).replaceAll(":'batch_size'", "$1");
    const [marker] = await db.root((tx) => tx.query<{ row_count: number; list_sha256: string; body_sha256: string }>(sql, [String(size)]));
    return marker;
  }
  const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const onList = (address: string, interests: string[] = []) => db.root((tx) => tx.query("insert into app.waitlist (email, interests) values ($1, $2)", [address, interests]));

  it("writes each address once, across batches, oldest first, in batches of at most 50; its marker is the row count, the list's sha256 and the reviewed text's sha256", async () => {
    const owner = await account("batch-owner");
    const org = await workspace(owner.id);
    await db.root((tx) => tx.query("insert into app.vendors (org_id, name, email, requested) values ($1, 'Supplier', 'vendor-on-list@supplier.example', array['w9'])", [org]));
    for (const [address, interests] of [
      ["first@fans.example", []],
      ["collector@fans.example", ["collect"]],
      [owner.email, []],
      ["vendor-on-list@supplier.example", []],
      ["you@sample.example", []],
      ["second@fans.example", []],
    ] as const) {
      await onList(address, [...interests]);
    }
    expect(await batch(1)).toEqual({ row_count: 1, list_sha256: sha256("first@fans.example"), body_sha256: sha256(WAITLIST_OPEN.body) });
    expect(await batch(1)).toEqual({ row_count: 1, list_sha256: sha256("second@fans.example"), body_sha256: sha256(WAITLIST_OPEN.body) });
    expect(await batch(10)).toMatchObject({ row_count: 0 });
    const rows = await db.root((tx) => tx.query<{ to_email: string; subject: string; body: string; org_id: string | null }>("select to_email, subject, body, org_id from app.outbox where kind = 'waitlist_open' order by to_email"));
    expect(rows).toEqual(["first@fans.example", "second@fans.example"].map((to_email) => ({ to_email, subject: WAITLIST_OPEN.subject, body: WAITLIST_OPEN.body, org_id: null })));
    // The unique key, whatever writes the row.
    await expect(queueWaitlist("first@fans.example")).rejects.toThrow(/outbox_waitlist_open_once/);

    await db.root((tx) => tx.query("insert into app.waitlist (email, created_at) select 'many' || g || '@fans.example', now() + g * interval '1 second' from generate_series(1, 60) g"));
    const big = await batch(500);
    expect(big.row_count).toBe(50);
    expect(big.list_sha256).toBe(sha256(Array.from({ length: 50 }, (_, i) => `many${i + 1}@fans.example`).sort().join("\n")));
  });

  it("at sending, each address must still be on the list with no Collect interest and belong to no account; the footer carries the postal address, and with none set nothing is sent", async () => {
    stub(ALL_ON);
    const ses = fakeSes();
    for (const address of ["stays@fans.example", "leaves@fans.example", "collects@fans.example", "signs-up@fans.example"]) await onList(address);
    expect(await batch(10)).toMatchObject({ row_count: 4 });
    await db.root(async (tx) => {
      await tx.query("delete from app.waitlist where email = 'leaves@fans.example'");
      await tx.query("update app.waitlist set interests = array['collect'] where email = 'collects@fans.example'");
    });
    await db.user("signs-up@fans.example");

    vi.stubEnv("SHIPSHAPE_POSTAL_ADDRESS", "");
    await expect(sendQueuedMail()).rejects.toThrow("SHIPSHAPE_POSTAL_ADDRESS");
    expect(ses.calls).toEqual([]);

    vi.stubEnv("SHIPSHAPE_POSTAL_ADDRESS", "1 Main St, Springfield");
    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(ses.to()).toEqual(["stays@fans.example"]);
    expect(ses.calls[0].Content?.Simple?.Body?.Text?.Data).toMatch(/\nShipShape is operated by Unvibe, 1 Main St, Springfield$/);
  });
});

describe("the deletion record (Security 1058, D-1)", () => {
  const COGNITO = { COGNITO_DOMAIN: "https://auth.example.test", COGNITO_USER_POOL_ID: "us-east-1_Test1", COGNITO_CLIENT_ID: "client123", COGNITO_CLIENT_SECRET: "client-secret" };
  beforeEach(() => {
    stub({ ...ALL_ON, ...COGNITO });
    setSignInAdminForTests({ deleteUser: async () => {} });
  });
  afterEach(() => setSignInAdminForTests(undefined));
  const ctxFor = (userId: string, orgId: string, role: "owner" | "member") => ({ userId, orgId, role, demo: false, name: "Mail Co", authAt: Math.floor(Date.now() / 1000), today: isoToday() });
  const text = (c: SendEmailCommandInput) => c.Content?.Simple?.Body?.Text?.Data ?? "";

  it("goes once, after the deletion, to the deleting person's verified address, owner or member; nothing keeps the address", async () => {
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    const ses = fakeSes();
    const owner = await account("deleting-owner");
    const org = await workspace(owner.id);
    const member = await account("deleting-member");
    const other = await account("staying-owner");
    const theirs = await workspace(other.id);
    await join(theirs, member.id, "member");

    await deleteAccount(ctxFor(owner.id, org, "owner"));
    await deleteAccount(ctxFor(member.id, theirs, "member"));
    expect(ses.to()).toEqual([owner.email, member.email]);
    const [record] = ses.calls;
    expect(record).toMatchObject({ FromEmailAddress: FROM, ConfigurationSetName: CONFIGURATION_SET, Content: { Simple: { Subject: { Data: "Record of your ShipShape account deletion" } } } });
    expect(Object.keys(record.Content?.Simple?.Body ?? {})).toEqual(["Text"]);
    expect(text(record)).toMatch(new RegExp(`^You deleted your ShipShape account on ${fmtDay(isoToday())}\\. This email is your record\\.`));
    expect(text(record)).toContain(`If you didn't do this, write to ${SUPPORT}`);
    expect(text(record)).toMatch(/ShipShape sends nothing else to this address unless you create a new account\.$/);
    expect(text(record)).not.toMatch(/someone else|last email/i);

    // In memory only: no outbox row, no table, no log line holds it.
    for (const email of [owner.email, member.email]) {
      expect(await db.root((tx) => tx.query("select 1 from app.outbox where lower(to_email) = lower($1)", [email]))).toEqual([]);
      expect(await db.root((tx) => tx.query("select 1 from auth.users where lower(email) = lower($1)", [email]))).toEqual([]);
      for (const spy of logs) expect(spy.mock.calls.flat().some((a) => String(a).includes(email))).toBe(false);
    }
  });

  it("left for the daily run, it says the deletion is still finishing; it's sent once and never again by the run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ses = fakeSes();
    const owner = await account("unfinished");
    const org = await workspace(owner.id);
    await db.root((tx) => tx.query("alter function app.delete_my_account(uuid[]) rename to delete_my_account_unavailable"));
    let error: unknown;
    try {
      error = await deleteAccount(ctxFor(owner.id, org, "owner")).catch((e: unknown) => e);
    } finally {
      await db.root((tx) => tx.query("alter function app.delete_my_account_unavailable(uuid[]) rename to delete_my_account"));
    }
    expect(error).toBeInstanceOf(UserError);
    expect(ses.to()).toEqual([owner.email]);
    expect(text(ses.calls[0])).toMatch(new RegExp(`^You asked to delete your ShipShape account on ${fmtDay(isoToday())}\\. Part of it is still finishing; ShipShape completes it by itself within 2 days\\.`));
    // The queue never has a copy to send again.
    expect(await sendQueuedMail()).toEqual({ sent: 0, failed: 0, held: 0 });
    expect(ses.calls).toHaveLength(1);
  });

  it("isn't sent while its flag is off, to a suppressed address, over the caps, or to an account with no Cognito identity; a failed send is one try, logged without the address, and the deletion stands", async () => {
    const ses = fakeSes();
    const deleted = async (name: string, { cognito = true } = {}) => {
      const who = await account(name, { cognito });
      const org = await workspace(who.id);
      return { who, org, run: () => deleteAccount(ctxFor(who.id, org, "owner")) };
    };

    const off = await deleted("record-off");
    vi.stubEnv("SHIPSHAPE_EMAIL_DELETION", "");
    // Off, the address isn't even read, and nothing is sent to one passed in.
    expect(await deletionRecordAddress(off.who.id)).toBeNull();
    await sendDeletionRecord(off.who.email, "finished");
    await off.run();
    vi.stubEnv("SHIPSHAPE_EMAIL_DELETION", "1");

    const stopped = await deleted("record-stopped");
    await stopEmail((t, p) => asService((tx) => tx.query(t, p)), stopped.who.email, hashKey());
    await stopped.run();

    // Its own reminders today, in the workspace the deletion then removes: they count, as they did before it.
    const busy = await deleted("record-busy");
    await db.root((tx) =>
      tx.query("insert into app.outbox (org_id, to_email, subject, body, claimed_at, sent_at, attempts) select $1, $2, 's', 'b', now(), now(), 1 from generate_series(1, $3::int)", [
        busy.org,
        busy.who.email,
        ACCOUNT_DAILY_CAP,
      ]),
    );
    await busy.run();

    const local = await deleted("record-local", { cognito: false });
    await local.run();
    expect(ses.calls).toEqual([]);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let tries = 0;
    const failing = await deleted("record-fails");
    setMailSenderForTests({
      async send() {
        tries++;
        throw sesError("MessageRejected", `Email address is not verified: ${failing.who.email}`);
      },
    });
    await expect(failing.run()).resolves.toBeUndefined();
    expect(tries).toBe(1);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual(["mail: the deletion record wasn't sent (MessageRejected)"]);
    expect(await db.root((tx) => tx.query("select 1 from auth.users where id = $1", [failing.who.id]))).toEqual([]);
  });
});

// SNS -------------------------------------------------------------------------------------------------

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

/** An SNS message as the topic would post it, signed (SignatureVersion 2) by `key` after `tamper`. */
function snsMessage(fields: Record<string, string>, { key = keys.privateKey, tamper = {} }: { key?: KeyObject; tamper?: Record<string, string> } = {}) {
  const m: Record<string, string> = {
    Type: "Notification",
    MessageId: randomUUID(),
    TopicArn: TOPIC,
    Message: "{}",
    Timestamp: new Date().toISOString(),
    SignatureVersion: "2",
    SigningCertURL: CERT_URL,
    ...fields,
  };
  // SNS's documented order (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).
  const order = m.Type === "Notification" ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  const text = order
    .filter((k) => m[k] !== undefined)
    .map((k) => `${k}\n${m[k]}\n`)
    .join("");
  return JSON.stringify({ ...m, ...tamper, Signature: sign("sha256", Buffer.from(text), key).toString("base64") });
}
const bounce = (address: string, bounceType = "Permanent") =>
  JSON.stringify({ eventType: "Bounce", bounce: { bounceType, bounceSubType: "General", bouncedRecipients: [{ emailAddress: address }] }, mail: { destination: [address] } });
const complaint = (address: string) => JSON.stringify({ eventType: "Complaint", complaint: { complainedRecipients: [{ emailAddress: address }] } });

/** SNS's certificate host and subscribe URL, faked; records every URL fetched. */
function fakeSns() {
  const fetched: string[] = [];
  const fetchFn = async (input: string | URL) => {
    const url = String(input);
    fetched.push(url);
    return url === CERT_URL ? new Response(PUBLIC_PEM) : new Response("<ConfirmSubscriptionResponse/>");
  };
  return { fetched, fetchFn };
}

describe("bounces and complaints (the suppression list)", () => {
  beforeEach(emailOn);

  it("a verified permanent bounce or complaint suppresses the address (as a hash); the sender skips it; a transient bounce doesn't", async () => {
    const sns = fakeSns();
    const owner = await account("bounced");
    const org = await workspace(owner.id);
    const admin = await account("complained");
    await join(org, admin.id, "admin");
    const busy = await account("full-inbox");
    await join(org, busy.id, "admin");

    const post = (message: string) => handleSesNotification(snsMessage({ Message: message }), { fetchFn: sns.fetchFn });
    expect(await post(bounce(owner.email.toUpperCase()))).toEqual({ status: 200, message: "suppressed" });
    expect(await post(complaint(admin.email))).toEqual({ status: 200, message: "suppressed" });
    expect(await post(bounce(busy.email, "Transient"))).toEqual({ status: 200, message: "ignored" });
    expect(await post(JSON.stringify({ eventType: "Delivery" }))).toEqual({ status: 200, message: "ignored" });
    // Again: no second row, no error.
    expect(await post(bounce(owner.email))).toEqual({ status: 200, message: "suppressed" });

    const stored = await db.root((tx) => tx.query<{ address_hash: string; reason: string }>("select address_hash, reason from app.email_suppressions order by reason"));
    expect(stored.map((s) => s.reason)).toEqual(["bounce", "complaint"]);
    expect(stored.every((s) => /^[0-9a-f]{32}$/.test(s.address_hash))).toBe(true);

    const ses = fakeSes();
    await queue(org, owner.email);
    await queue(org, admin.email);
    await queue(org, busy.email);
    expect(await sendQueuedMail()).toEqual({ sent: 1, failed: 0, held: 2 });
    expect(ses.to()).toEqual([busy.email]);
  });

  it("refuses a message from another topic, a bad or tampered signature, a certificate off SNS's host and SignatureVersion 1", async () => {
    const sns = fakeSns();
    const post = (raw: string) => handleSesNotification(raw, { fetchFn: sns.fetchFn });
    const message = bounce("victim@example.test");
    expect(await post(snsMessage({ Message: message, TopicArn: TOPIC.replace("events", "other") }))).toEqual({ status: 403, message: "another topic" });
    expect(await post(snsMessage({ Message: message }, { key: otherKeys.privateKey }))).toEqual({ status: 403, message: "bad signature" });
    expect(await post(snsMessage({ Message: message }, { tamper: { Message: bounce("someone-else@example.test") } }))).toEqual({ status: 403, message: "bad signature" });
    for (const url of [
      "https://sns.us-east-1.amazonaws.com.evil.example/cert.pem",
      "http://sns.us-east-1.amazonaws.com/cert.pem",
      "https://sns.eu-west-1.amazonaws.com/cert.pem",
      "https://evil.example/cert.pem",
      "https://sns.us-east-1.amazonaws.com:8443/cert.pem",
      "https://user@sns.us-east-1.amazonaws.com/cert.pem",
      "https://sns.us-east-1.amazonaws.com/cert.txt",
      "https://sns.us-east-1.amazonaws.com/cert.pem?next=https://evil.example/",
      `${CERT_URL}#elsewhere`,
    ]) {
      expect(await post(snsMessage({ Message: message, SigningCertURL: url }))).toEqual({ status: 403, message: "bad signature" });
    }
    expect(sns.fetched.every((u) => u === CERT_URL)).toBe(true);
    expect(await post(snsMessage({ Message: message, SignatureVersion: "1" }))).toEqual({ status: 400, message: "not an SNS message" });
    expect(await post("not json")).toEqual({ status: 400, message: "not an SNS message" });
    expect(await db.root((tx) => tx.query("select 1 from app.email_suppressions"))).toEqual([]);
  });

  it("keeps SNS's certificate only once it has verified a message, and refuses an oversized body before parsing it", async () => {
    const url = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-rotated.pem";
    let answers = 0;
    const fetched: string[] = [];
    const fetchFn = async (input: string | URL) => {
      fetched.push(String(input));
      return ++answers === 1 ? new Response("<html>Service Unavailable</html>", { status: 503 }) : new Response(PUBLIC_PEM);
    };
    const post = () => handleSesNotification(snsMessage({ Message: bounce("rotated@example.test"), SigningCertURL: url }), { fetchFn });
    expect(await post()).toEqual({ status: 403, message: "bad signature" });
    expect(await post()).toEqual({ status: 200, message: "suppressed" });
    expect(await post()).toEqual({ status: 200, message: "suppressed" });
    expect(fetched).toEqual([url, url]);

    expect(await handleSesNotification(" ".repeat(300_001), { fetchFn })).toEqual({ status: 413, message: "too large" });
  });

  it("confirms the topic's subscription on SNS's own host only", async () => {
    const sns = fakeSns();
    const confirm = (subscribeUrl: string) =>
      handleSesNotification(snsMessage({ Type: "SubscriptionConfirmation", Message: "You have chosen to subscribe", SubscribeURL: subscribeUrl, Token: "t0k3n" }), { fetchFn: sns.fetchFn });
    const real = "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t0k3n";
    expect(await confirm(real)).toEqual({ status: 200, message: "subscribed" });
    expect(sns.fetched).toContain(real);
    expect(await confirm("https://evil.example/?Action=ConfirmSubscription")).toEqual({ status: 400, message: "bad subscribe URL" });
    expect(sns.fetched.some((u) => u.includes("evil"))).toBe(false);
  });

  it("is a 404 while email is off, through the route too", async () => {
    vi.unstubAllEnvs();
    const sns = fakeSns();
    expect(await handleSesNotification(snsMessage({ Message: bounce("x@example.test") }), { fetchFn: sns.fetchFn })).toEqual({ status: 404, message: "email off" });
    const res = await snsPost(new Request("http://x/api/mail/events", { method: "POST", body: snsMessage({ Message: bounce("x@example.test") }) }));
    expect(res.status).toBe(404);
    expect(sns.fetched).toEqual([]);
  });
});

describe("rollback", () => {
  it("0049 goes down with its down file and comes back up with npm run migrate's runner (PGlite)", async () => {
    const pg = await PGlite.create();
    try {
      const step = (t: Pick<PGlite, "exec" | "query">): MigrationStep => ({
        exec: async (s) => void (await t.exec(s)),
        query: async (text, params) => (await t.query<Record<string, unknown>>(text, params)).rows,
      });
      const conn = { ...step(pg), transaction: (fn: (t: MigrationStep) => Promise<void>) => pg.transaction((t) => fn(step(t))) };
      const all = (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
      const files = await Promise.all(all.map(async (name) => ({ name, sql: await readFile(`supabase/migrations/${name}`, "utf8") })));
      const setup = [await readFile("supabase/platform/plain-postgres.sql", "utf8")];
      const shape = async () =>
        (
          await pg.query<{ c: string }>(
            "select column_name as c from information_schema.columns where table_schema = 'app' and table_name = 'outbox' union all select 'table:' || table_name from information_schema.tables where table_schema = 'app' and table_name = 'email_suppressions' order by 1",
          )
        ).rows.map((r) => r.c);

      const upTo48 = files.filter((f) => f.name <= "0048_delete_document.sql");
      expect(upTo48.at(-1)?.name).toBe("0048_delete_document.sql");
      await migrate(conn, setup, upTo48);
      const before = await shape();
      const upTo49 = files.filter((f) => f.name <= "0049_email_sending.sql");
      expect(await migrate(conn, setup, upTo49)).toEqual(["0049_email_sending.sql"]);
      const after = await shape();
      expect(after.filter((c) => !before.includes(c))).toEqual(["attempts", "claimed_at", "last_error", "sent_at", "ses_message_id", "table:email_suppressions"]);

      // infra/README.md, "Undoing a migration": the down file as the owner, then 0049's row, in one transaction.
      const down = await readFile("supabase/rollback/0049_email_sending.down.sql", "utf8");
      await pg.transaction(async (t) => {
        await t.exec("set local role shipshape_owner");
        await t.exec(down);
        await t.query("delete from meta.migrations where name = $1", ["0049_email_sending.sql"]);
      });
      expect(await shape()).toEqual(before);

      expect(await migrate(conn, setup, upTo49)).toEqual(["0049_email_sending.sql"]);
      expect(await shape()).toEqual(after);
      expect(await migrate(conn, setup, upTo49)).toEqual([]);
    } finally {
      await pg.close();
    }
  });

  it("0050 goes down with its down file, taking the new kinds' rows with it but keeping every stop, and comes back up (PGlite)", async () => {
    const pg = await PGlite.create();
    try {
      const step = (t: Pick<PGlite, "exec" | "query">): MigrationStep => ({
        exec: async (s) => void (await t.exec(s)),
        query: async (text, params) => (await t.query<Record<string, unknown>>(text, params)).rows,
      });
      const conn = { ...step(pg), transaction: (fn: (t: MigrationStep) => Promise<void>) => pg.transaction((t) => fn(step(t))) };
      const all = (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
      const files = await Promise.all(all.map(async (name) => ({ name, sql: await readFile(`supabase/migrations/${name}`, "utf8") })));
      const setup = [await readFile("supabase/platform/plain-postgres.sql", "utf8")];
      const shape = async () =>
        (
          await pg.query<{ c: string }>(
            `select column_name || ':' || is_nullable as c from information_schema.columns where table_schema = 'app' and table_name = 'outbox'
             union all select 'fn:' || proname from pg_proc where proname = 'queue_welcome'
             union all select 'check:' || pg_get_constraintdef(oid) from pg_constraint where conname in ('outbox_kind_check', 'email_suppressions_reason_check')
             order by 1`,
          )
        ).rows.map((r) => r.c);

      const upTo49 = files.filter((f) => f.name <= "0049_email_sending.sql");
      await migrate(conn, setup, upTo49);
      const before = await shape();
      const upTo50 = files.filter((f) => f.name <= "0050_email_kinds.sql");
      expect(await migrate(conn, setup, upTo50)).toEqual(["0050_email_kinds.sql"]);
      const after = await shape();
      expect(after.filter((c) => !before.includes(c)).filter((c) => !c.startsWith("check:"))).toEqual(["address_sha256:YES", "fn:queue_welcome", "org_id:YES", "user_id:YES", "waitlist_email:YES"]);
      await pg.exec(
        "insert into app.waitlist (email) values ('fan@fans.example'); insert into app.outbox (to_email, subject, body, kind, waitlist_email, address_sha256) values ('fan@fans.example', 's', 'b', 'waitlist_open', 'fan@fans.example', encode(sha256(convert_to('fan@fans.example', 'UTF8')), 'hex')); insert into app.email_suppressions (address_hash, reason) values (repeat('a', 32), 'stop')",
      );

      const down = await readFile("supabase/rollback/0050_email_kinds.down.sql", "utf8");
      await pg.transaction(async (t) => {
        await t.exec("set local role shipshape_owner");
        await t.exec(down);
        await t.query("delete from meta.migrations where name = $1", ["0050_email_kinds.sql"]);
      });
      // Everything back to 0049's shape except the suppression list's reason check, which still allows 'stop', and the
      // stop itself, which survives (Security S-R1).
      const keptCheck = after.filter((c) => c.startsWith("check:") && c.includes("'stop'"));
      expect(keptCheck).toHaveLength(1);
      expect((await shape()).sort()).toEqual([...before.filter((c) => !(c.startsWith("check:") && c.includes("'bounce'"))), ...keptCheck].sort());
      expect((await pg.query<{ reason: string }>("select reason from app.email_suppressions")).rows).toEqual([{ reason: "stop" }]);
      expect((await pg.query("select 1 from app.outbox where kind in ('welcome', 'waitlist_open')")).rows).toEqual([]);

      expect(await migrate(conn, setup, upTo50)).toEqual(["0050_email_kinds.sql"]);
      expect(await shape()).toEqual(after);
    } finally {
      await pg.close();
    }
  });
});
