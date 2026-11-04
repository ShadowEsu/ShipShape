import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
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
  handleSesNotification,
  mailConfig,
  MAX_ATTEMPTS,
  REMINDER_FOOTER,
  sendReminderMail,
  setMailSenderForTests,
  type MailSender,
} from "@/lib/server/mail";
import { migrate, type MigrationStep } from "@/lib/server/migrations";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";

// Reminder email through SES (B12; Security 2026-11-04 0715, answer 5), against a fake SES and a
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
const ON = { SHIPSHAPE_EMAIL: "1", SHIPSHAPE_EMAIL_FROM: FROM, AWS_REGION: "us-east-1", SHIPSHAPE_SES_EVENTS_TOPIC_ARN: TOPIC };
const emailOn = () => {
  for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v);
};

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
    expect(await sendReminderMail()).toBeNull();
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
    expect(mailConfig(ON)).toEqual({ from: FROM, region: "us-east-1", topicArn: TOPIC });
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

    expect(await sendReminderMail()).toEqual({ sent: 2, failed: 0, held: 0 });
    expect(ses.to().sort()).toEqual([owner.email.toUpperCase(), admin.email].sort());
  });

  it("asks SES for a plain-text message through the configuration set, ending with why it came and how to stop it: no HTML part, no tracking, nothing else", async () => {
    const ses = fakeSes();
    const owner = await account("shape");
    const id = await queue(await workspace(owner.id), owner.email);
    await sendReminderMail();
    expect(ses.calls).toEqual([
      {
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [owner.email] },
        Content: {
          Simple: {
            Subject: { Data: "Permit expires in 7 days", Charset: "UTF-8" },
            Body: { Text: { Data: `Permit expires in 7 days (Nov 10, 2026).\n\n--\n${REMINDER_FOOTER}`, Charset: "UTF-8" } },
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
    await sendReminderMail();
    await sendReminderMail();
    expect(ses.calls).toHaveLength(1);

    const a = await queue(org, owner.email, { subject: "A" });
    const b = await queue(org, owner.email, { subject: "B" });
    await Promise.all([sendReminderMail(), sendReminderMail()]);
    expect(ses.calls.map((c) => c.Content?.Simple?.Subject?.Data).sort()).toEqual(["A", "B", "Permit expires in 7 days"]);
    expect([await row(a), await row(b), await row(id)].every((r) => r.sent && r.attempts === 1)).toBe(true);

    // Claimed and never marked sent: the outcome is unknown, so it isn't tried again.
    const lost = await queue(org, owner.email, { subject: "Lost" });
    await db.root((tx) => tx.query("update app.outbox set claimed_at = now(), attempts = 1 where id = $1", [lost]));
    await sendReminderMail();
    expect(ses.calls.map((c) => c.Content?.Simple?.Subject?.Data)).not.toContain("Lost");
  });

  it("records a failed send by the error's name, retries it on the next run, and gives up after MAX_ATTEMPTS", async () => {
    const owner = await account("retry");
    const org = await workspace(owner.id);
    const id = await queue(org, owner.email);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let ses = fakeSes(() => sesError("MessageRejected", `Email address is not verified: ${owner.email}`));
    expect(await sendReminderMail()).toEqual({ sent: 0, failed: 1, held: 0 });
    expect(await row(id)).toEqual({ sent: false, claimed: false, attempts: 1, last_error: "MessageRejected", ses_message_id: null });
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([`mail: ${id} not sent (MessageRejected)`]);

    ses = fakeSes();
    expect(await sendReminderMail()).toEqual({ sent: 1, failed: 0, held: 0 });
    expect(ses.calls).toHaveLength(1);
    expect(await row(id)).toEqual({ sent: true, claimed: true, attempts: 2, last_error: null, ses_message_id: "msg-1" });

    const stubborn = await queue(org, owner.email, { subject: "Stubborn" });
    ses = fakeSes(() => sesError("MessageRejected", "no"));
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await sendReminderMail();
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
    expect(await sendReminderMail()).toEqual({ sent: 0, failed: 1, held: 1 });
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
    expect(await sendReminderMail()).toEqual({ sent: ACCOUNT_DAILY_CAP + 1, failed: 0, held: 2 });
    expect(ses.to().filter((t) => t === owner.email)).toHaveLength(ACCOUNT_DAILY_CAP);
    expect(ses.to()).toContain(admin.email);
    // Later the same day: the owner's two still wait.
    ses = fakeSes();
    expect(await sendReminderMail()).toEqual({ sent: 0, failed: 0, held: 2 });

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
    expect(await sendReminderMail()).toEqual({ sent: 1, failed: 0, held: 1 });
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
    expect(await sendReminderMail()).toEqual({ sent: 1, failed: 0, held: 0 });
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
    // Exactly one "why you got this" line (Security F1): REMINDER_FOOTER's, which also says how to stop.
    const text = ses.calls[0].Content?.Simple?.Body?.Text?.Data ?? "";
    expect(text.endsWith(`\n\n--\n${REMINDER_FOOTER}`)).toBe(true);
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
    expect(await sendReminderMail(Date.now() - 1)).toEqual({ sent: 0, failed: 0, held: 2 });
    expect(ses.calls).toEqual([]);
    expect(await sendReminderMail()).toEqual({ sent: 2, failed: 0, held: 0 });
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
    expect(await sendReminderMail()).toEqual({ sent: 1, failed: 0, held: 2 });
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
});
