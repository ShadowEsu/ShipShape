import "server-only";
import { verify } from "node:crypto";
import { SendEmailCommand, SESv2Client, type SendEmailCommandInput } from "@aws-sdk/client-sesv2";
import { z } from "zod";
import { productionAwsClient } from "./aws";
import { keyedHash } from "./crypto";
import { asService } from "./db";

/**
 * Reminder email through Amazon SES (B12; Security 2026-11-04 0715, answer 5). Off unless
 * SHIPSHAPE_EMAIL=1 and the sender's settings are valid (mailConfig); off, nothing here runs and the
 * outbox stays the only place reminders land.
 *
 * - Only reminders (never signing codes), only to the account address of an owner or admin of the
 *   row's workspace who signed in through Cognito (whose ID token said email_verified), in a real
 *   workspace, with no deletion pending. A vendor's or signer's address is never sent to.
 * - Plain text only: no HTML part, so no tracking pixel or rewritten link; the configuration set
 *   (infra/mail.yaml) has no open or click tracking either, and suppresses bounces and complaints.
 * - Caps per account address and overall, per rolling 24 hours; a suppression list the app fills from
 *   SES's bounce and complaint notifications (handleSesNotification) and checks before every send.
 * - Each row is claimed before SES is called and marked sent after, so it goes out at most once
 *   (0049_email_sending.sql); a failed send is retried by the next daily run, up to MAX_ATTEMPTS.
 * The app role may call ses:SendEmail only, from the one sender, through the one identity and
 * configuration set (infra/app-role.yaml).
 */

type Env = Record<string, string | undefined>;
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** infra/mail.yaml names it; app-role.yaml allows SendEmail through it only. */
export const CONFIGURATION_SET = "shipshape-mail";
// One account gets at most a few reminders a day even with many documents due at once: past this the
// rest wait a day rather than flood an inbox (and a flood is what makes people press "spam").
export const ACCOUNT_DAILY_CAP = 10;
// Everything the app sends in 24 hours: SES's sandbox allows 200 a day, and a bug that loops can't
// send more than this before someone notices. Raise it with the SES quota, on purpose.
export const DAILY_CAP = 200;
// One try per daily run: a reminder that failed three days running is stale by then. For the same
// reason QUEUE_SQL never sends a row over 3 days old: the outbox keeps 90 days of reminders, and
// turning email on mustn't mail out weeks-old "expires in 7 days".
export const MAX_ATTEMPTS = 3;

// SES says to stop for now: the rest of the run would fail the same way, so they wait for tomorrow.
const STOP_ERRORS: Record<string, true> = { TooManyRequestsException: true, LimitExceededException: true, SendingPausedException: true, AccountSuspendedException: true };

export interface MailConfig {
  /** The verified sender, e.g. reminders@example.com (app-role.yaml's SenderAddress). */
  from: string;
  region: string;
  /** infra/mail.yaml's SNS topic for bounces and complaints: the only one whose notifications count. */
  topicArn: string;
}

const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;
const TOPIC_ARN = /^arn:aws:sns:([a-z]{2}(?:-[a-z]+)+-\d+):\d{12}:[A-Za-z0-9_-]{1,256}$/;

/** Email sending's settings, or null while it's off (SHIPSHAPE_EMAIL isn't exactly "1"). On with a setting missing or invalid throws. */
export function mailConfig(env: Env): MailConfig | null {
  if (env.SHIPSHAPE_EMAIL !== "1") return null;
  const from = env.SHIPSHAPE_EMAIL_FROM?.trim() ?? "";
  const region = env.AWS_REGION ?? "";
  const topicArn = env.SHIPSHAPE_SES_EVENTS_TOPIC_ARN?.trim() ?? "";
  if (!z.email().safeParse(from).success || from.length > 254) throw new Error("Email sending (SHIPSHAPE_EMAIL=1) needs SHIPSHAPE_EMAIL_FROM, the SES-verified sender address");
  if (!REGION.test(region)) throw new Error("Email sending (SHIPSHAPE_EMAIL=1) needs AWS_REGION");
  const topicRegion = TOPIC_ARN.exec(topicArn)?.[1];
  if (topicRegion !== region) throw new Error("Email sending (SHIPSHAPE_EMAIL=1) needs SHIPSHAPE_SES_EVENTS_TOPIC_ARN, an SNS topic ARN in AWS_REGION (infra/mail.yaml's EventsTopicArn)");
  return { from, region, topicArn };
}

/** For pages: whether reminders are emailed. A broken setting counts as off (the launch check refuses it in production). */
export function mailOn(env: Env = process.env): boolean {
  try {
    return mailConfig(env) !== null;
  } catch {
    return false;
  }
}

// SES -------------------------------------------------------------------------------------------------

/** What sending needs from SES: SendEmail, returning its message id. */
export interface MailSender {
  send(input: SendEmailCommandInput): Promise<string | undefined>;
}

export function sesSender(client: SESv2Client): MailSender {
  return {
    async send(input) {
      return (await client.send(new SendEmailCommand(input))).MessageId;
    },
  };
}

/**
 * Production signs with credentials for AWS_ROLE_ARN from Vercel's OIDC token and reaches AWS's own
 * endpoint only (productionAwsClient, Security CG-1); the role allows ses:SendEmail and nothing else.
 */
export function sesClient(cfg: MailConfig, env: Env): SESv2Client {
  if (env.NODE_ENV === "production") return new SESv2Client({ region: cfg.region, ...productionAwsClient(env, "Sending email") });
  return new SESv2Client({ region: cfg.region });
}

let mailSender: MailSender | undefined;

/** Tests stand in for SES. */
export function setMailSenderForTests(s: MailSender | undefined) {
  mailSender = s;
}

/**
 * Why the person gets the email and how to stop it (Security 2026-11-04 #35, SHOULD), in every reminder's
 * text. Both ways are real today: a reminder is about one document's date, and an archived document or one
 * with no dates gets none (deadlines.ts); a reply reaches the sender address, which is the support inbox.
 */
export const REMINDER_FOOTER =
  "You're getting this because you're an owner or admin of this workspace on ShipShape. To stop reminders about this document, archive it or clear its dates in ShipShape. Questions: reply to this email.";

/** The request for one reminder: a plain-text body only (the reminder, then REMINDER_FOOTER), through the configuration set. */
export function reminderEmail(cfg: MailConfig, m: { to_email: string; subject: string; body: string }): SendEmailCommandInput {
  return {
    FromEmailAddress: cfg.from,
    Destination: { ToAddresses: [m.to_email] },
    Content: { Simple: { Subject: { Data: m.subject, Charset: "UTF-8" }, Body: { Text: { Data: `${m.body}\n\n--\n${REMINDER_FOOTER}`, Charset: "UTF-8" } } } },
    ConfigurationSetName: CONFIGURATION_SET,
  };
}

// Sending ---------------------------------------------------------------------------------------------

const suppressionHash = (address: string) => keyedHash(address.trim().toLowerCase(), "email-suppression");

/**
 * Reminders that may be emailed: unsent, unclaimed, under the attempt limit and recent; in a real
 * workspace; addressed to the account address of one of its owners or admins who signs in through
 * Cognito (verified email; a sample visitor never has a Cognito identity) and isn't being deleted.
 */
const QUEUE_SQL = `
  select m.id, m.to_email, m.subject, m.body
  from app.outbox m
  join app.organizations o on o.id = m.org_id
  where m.kind = 'reminder' and m.sent_at is null and m.claimed_at is null and m.attempts < $1
    and m.created_at > now() - interval '3 days'
    and not o.is_demo
    and exists (
      select 1
      from auth.users u
      join app.identities i on i.user_id = u.id and i.provider = 'cognito'
      join app.members mb on mb.user_id = u.id and mb.org_id = m.org_id and mb.role in ('owner', 'admin')
      where lower(u.email) = lower(m.to_email)
        and not exists (select 1 from app.deletion_requests r where r.user_id = u.id)
    )
  order by m.created_at, m.id
  limit $2`;

interface Queued {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

export interface MailRun {
  sent: number;
  failed: number;
  /** Left for a later run: over a cap, suppressed, or after SES said to stop. */
  held: number;
}

/**
 * Emails the reminders waiting in the outbox (the daily run, after runReminders). Null while email is
 * off. Stops at `until` (the daily run's budget); what's left waits for the next run.
 */
export async function sendReminderMail(until = Number.POSITIVE_INFINITY): Promise<MailRun | null> {
  const cfg = mailConfig(process.env);
  if (!cfg) return null;
  mailSender ??= sesSender(sesClient(cfg, process.env));
  const ses = mailSender;
  const queue = await asService((tx) => tx.query<Queued>(QUEUE_SQL, [MAX_ATTEMPTS, DAILY_CAP]));
  const run: MailRun = { sent: 0, failed: 0, held: 0 };
  if (!queue.length) return run;
  const hashes = queue.map((m) => suppressionHash(m.to_email));
  const suppressed = new Set(
    (await asService((tx) => tx.query<{ address_hash: string }>("select address_hash from app.email_suppressions where address_hash = any($1::text[])", [hashes]))).map(
      (r) => r.address_hash,
    ),
  );
  for (const [i, m] of queue.entries()) {
    if (Date.now() > until) {
      run.held += queue.length - i;
      break;
    }
    if (suppressed.has(hashes[i])) {
      run.held++;
      continue;
    }
    const claim = await claimRow(m);
    if (claim === "over_daily_cap") {
      run.held += queue.length - i;
      break;
    }
    if (claim !== "claimed") {
      if (claim === "over_account_cap") run.held++;
      continue;
    }
    let messageId: string | undefined;
    try {
      messageId = await ses.send(reminderEmail(cfg, m));
    } catch (e) {
      const name = e instanceof Error ? e.name.slice(0, 100) : "error";
      run.failed++;
      // The row's id and the error's name only: SES's message may quote the address.
      console.error(`mail: ${m.id} not sent (${name})`);
      await asService((tx) => tx.query("update app.outbox set claimed_at = null, last_error = $2 where id = $1 and sent_at is null", [m.id, name]));
      if (Object.hasOwn(STOP_ERRORS, name)) {
        run.held += queue.length - i - 1;
        break;
      }
      continue;
    }
    await asService((tx) => tx.query("update app.outbox set sent_at = now(), ses_message_id = $2, last_error = null where id = $1", [m.id, messageId?.slice(0, 200) ?? null]));
    run.sent++;
  }
  return run;
}

/**
 * Claims one row for sending, under the caps. One run at a time counts and claims (the advisory lock),
 * so two runs can't both take the last place under a cap; the update's own conditions make sure a row
 * already claimed or sent by anyone is left alone.
 */
async function claimRow(m: Queued): Promise<"claimed" | "taken" | "over_account_cap" | "over_daily_cap"> {
  return asService(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtextextended('mail:claim', 0))");
    const [counts] = await tx.query<{ total: number; mine: number }>(
      "select count(*)::int as total, (count(*) filter (where lower(to_email) = lower($1)))::int as mine from app.outbox where claimed_at > now() - interval '1 day'",
      [m.to_email],
    );
    if (counts.total >= DAILY_CAP) return "over_daily_cap";
    if (counts.mine >= ACCOUNT_DAILY_CAP) return "over_account_cap";
    const claimed = await tx.query(
      "update app.outbox set claimed_at = now(), attempts = attempts + 1 where id = $1 and sent_at is null and claimed_at is null and attempts < $2 returning 1",
      [m.id, MAX_ATTEMPTS],
    );
    return claimed.length ? "claimed" : "taken";
  });
}

// Bounces and complaints ------------------------------------------------------------------------------

/** SNS's envelope (https://docs.aws.amazon.com/sns/latest/dg/sns-message-and-json-formats.html). infra/mail.yaml sets SignatureVersion 2 (SHA256). */
const Envelope = z.object({
  Type: z.enum(["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"]),
  MessageId: z.string().min(1).max(100),
  TopicArn: z.string().min(1).max(300),
  Message: z.string().max(262_144),
  Timestamp: z.string().min(1).max(40),
  SignatureVersion: z.literal("2"),
  Signature: z.string().min(1).max(2048),
  SigningCertURL: z.string().min(1).max(500),
  Subject: z.string().max(200).optional(),
  SubscribeURL: z.string().max(2000).optional(),
  Token: z.string().max(2000).optional(),
});
type Envelope = z.infer<typeof Envelope>;

const Recipients = z.array(z.object({ emailAddress: z.string().min(3).max(320) })).max(100);
/** The configuration set's event (https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html). */
const SesEvent = z.object({
  eventType: z.string().max(40),
  bounce: z.object({ bounceType: z.string().max(40), bouncedRecipients: Recipients }).optional(),
  complaint: z.object({ complainedRecipients: Recipients }).optional(),
});

/** SNS's string to sign: these keys, in this order, each "key\nvalue\n" (absent optional keys left out). */
const NOTIFICATION_KEYS: readonly (keyof Envelope)[] = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
const CONFIRMATION_KEYS: readonly (keyof Envelope)[] = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];

function stringToSign(e: Envelope): string {
  const keys = e.Type === "Notification" ? NOTIFICATION_KEYS : CONFIRMATION_KEYS;
  return keys
    .filter((k) => e[k] !== undefined)
    .map((k) => `${k}\n${e[k]}\n`)
    .join("");
}

/** An https URL on SNS's own host in this region, and nothing else: no port, credentials or other host. */
function snsUrl(raw: string | undefined, region: string): URL | null {
  if (!raw || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  const ok = url.protocol === "https:" && url.hostname === `sns.${region}.amazonaws.com` && !url.port && !url.username && !url.password && !url.hash;
  return ok ? url : null;
}

// SNS's signing certificates by URL, each kept once it has verified a message (so an error page from a
// bad moment is never kept). SNS rotates them rarely; a handful is all a deployment ever sees.
const certs = new Map<string, string>();

/** Whether SNS signed this message, with a certificate from its own host in this region. */
async function snsSigned(e: Envelope, region: string, fetchFn: Fetch): Promise<boolean> {
  const url = snsUrl(e.SigningCertURL, region);
  if (!url || !url.pathname.endsWith(".pem") || url.search) return false;
  const known = certs.get(url.href);
  const cert =
    known ??
    (await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(5000) })
      .then((res) => res.text())
      .catch(() => ""));
  let signed = false;
  try {
    signed = verify("sha256", Buffer.from(stringToSign(e)), cert, Buffer.from(e.Signature, "base64"));
  } catch {
    signed = false;
  }
  if (signed && !known) {
    if (certs.size >= 8) certs.clear();
    certs.set(url.href, cert);
  }
  return signed;
}

/**
 * The SNS notification infra/mail.yaml's topic posts for each bounce and complaint. Only a message from
 * that topic with a valid SNS signature (certificate from sns.<region>.amazonaws.com) counts. A
 * permanent bounce or a complaint puts each recipient's address hash on the suppression list; a
 * transient bounce doesn't (SES has already retried; the address may work tomorrow). The subscription's
 * confirmation is answered by fetching its SubscribeURL, SNS's own host only.
 */
export async function handleSesNotification(raw: string, { fetchFn = fetch }: { fetchFn?: Fetch } = {}): Promise<{ status: number; message: string }> {
  let cfg: MailConfig | null;
  try {
    cfg = mailConfig(process.env);
  } catch {
    return { status: 503, message: "email misconfigured" };
  }
  if (!cfg) return { status: 404, message: "email off" };
  if (raw.length > 300_000) return { status: 413, message: "too large" };
  let envelope: Envelope;
  try {
    envelope = Envelope.parse(JSON.parse(raw));
  } catch {
    return { status: 400, message: "not an SNS message" };
  }
  if (envelope.TopicArn !== cfg.topicArn) return { status: 403, message: "another topic" };
  if (!(await snsSigned(envelope, cfg.region, fetchFn))) return { status: 403, message: "bad signature" };

  if (envelope.Type === "SubscriptionConfirmation") {
    const subscribe = snsUrl(envelope.SubscribeURL, cfg.region);
    if (!subscribe) return { status: 400, message: "bad subscribe URL" };
    const res = await fetchFn(subscribe, { redirect: "error", signal: AbortSignal.timeout(5000) });
    return res.ok ? { status: 200, message: "subscribed" } : { status: 502, message: "subscribe failed" };
  }
  if (envelope.Type === "UnsubscribeConfirmation") return { status: 200, message: "ignored" };

  let event: z.infer<typeof SesEvent>;
  try {
    event = SesEvent.parse(JSON.parse(envelope.Message));
  } catch {
    return { status: 400, message: "not an SES event" };
  }
  const suppress =
    event.eventType === "Bounce" && event.bounce?.bounceType === "Permanent"
      ? { reason: "bounce", recipients: event.bounce.bouncedRecipients }
      : event.eventType === "Complaint" && event.complaint
        ? { reason: "complaint", recipients: event.complaint.complainedRecipients }
        : null;
  if (!suppress) return { status: 200, message: "ignored" };
  const hashes = suppress.recipients.map((r) => suppressionHash(r.emailAddress));
  await asService((tx) =>
    tx.query("insert into app.email_suppressions (address_hash, reason) select h, $2 from unnest($1::text[]) as h on conflict (address_hash) do nothing", [hashes, suppress.reason]),
  );
  return { status: 200, message: "suppressed" };
}
