import "server-only";
import { verify } from "node:crypto";
import { SendEmailCommand, SESv2Client, type SendEmailCommandInput } from "@aws-sdk/client-sesv2";
import { z } from "zod";
import { productionAwsClient } from "./aws";
import { keyedHash } from "./crypto";
import { asService } from "./db";
import { PLANS } from "../plans";
import { appUrl, contactEmail } from "./flags";

/**
 * Email through Amazon SES (B12; Security 2026-11-04 0715, answer 5, and 1058, K1-K5). Off unless
 * SHIPSHAPE_EMAIL=1 and the sender's settings are valid (mailConfig); off, nothing here runs and the
 * outbox stays the only place reminders land. The kinds, each with its own recipient rule (QUEUE_SQL) and
 * each but reminders behind its own flag as well, off by default (K5):
 * - 'reminder' (SHIPSHAPE_EMAIL=1): to the account address of an owner or admin of the row's workspace.
 * - 'welcome' (SHIPSHAPE_EMAIL_WELCOME=1): once per person, to the account address of the sole owner of the
 *   new workspace their first sign-in made.
 * - 'waitlist_open' (SHIPSHAPE_EMAIL_WAITLIST=1): once per address, to a waitlist address with no Collect
 *   interest that belongs to no account, from a reviewed batch (scripts/waitlist-open-batch.sql).
 * - The deletion record (SHIPSHAPE_EMAIL_DELETION=1, sendDeletionRecord): sent directly from the delete
 *   action to the deleting person's verified address, held in memory only; never queued.
 * Signing codes ('esign_code') are not on the list and are never emailed. The account kinds need a Cognito
 * identity (whose ID token said email_verified) in a real workspace with no deletion pending; a vendor's,
 * signer's or sample visitor's address never qualifies for any kind.
 * - Plain text only: no HTML part, so no tracking pixel or rewritten link; the configuration set
 *   (infra/mail.yaml) has no open or click tracking either, and suppresses bounces and complaints.
 * - Caps per address and overall, per rolling 24 hours, shared by every kind; a suppression list the app
 *   fills from SES's bounce and complaint notifications (handleSesNotification) and from "stop" requests
 *   (suppressAddress, scripts/email-stop.ts), checked before every send of every kind.
 * - Each row is claimed before SES is called and marked sent after, so it goes out at most once
 *   (0049_email_sending.sql); a failed send is retried by the next daily run, up to MAX_ATTEMPTS.
 * The app role may call ses:SendEmail only (never SendBulkEmail), from the one sender, through the one
 * identity and configuration set (infra/app-role.yaml).
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

/** The kinds the sender takes from the outbox: the one allow-list (Security K1). Signing codes are not on it. */
export const QUEUED_KINDS = ["reminder", "welcome", "waitlist_open"] as const;
export type QueuedKind = (typeof QUEUED_KINDS)[number];

/** Each kind's own flag (Security K5): exactly "1" turns it on, and only with SHIPSHAPE_EMAIL=1 too. Reminders need SHIPSHAPE_EMAIL=1 alone (#35). */
export const KIND_FLAGS = { welcome: "SHIPSHAPE_EMAIL_WELCOME", waitlist_open: "SHIPSHAPE_EMAIL_WAITLIST", deletion: "SHIPSHAPE_EMAIL_DELETION" } as const;

export interface MailConfig {
  /** The verified sender, e.g. reminders@example.com (app-role.yaml's SenderAddress). */
  from: string;
  region: string;
  /** infra/mail.yaml's SNS topic for bounces and complaints: the only one whose notifications count. */
  topicArn: string;
  /** CONTACT_EMAIL, the support address: every footer says to write to it (Security K3). */
  support: string;
  /** The sender is the support address, so a reply reaches the monitored inbox: only then may a footer say "reply" (Security K3, F2). */
  replyReaches: boolean;
  /** The queued kinds that are on. */
  kinds: QueuedKind[];
  /** The deletion record (sendDeletionRecord) is on. */
  deletionRecord: boolean;
  /** SHIPSHAPE_APP_URL's origin: the welcome's and the waitlist note's link. Set whenever either is on. */
  appUrl: string | null;
  /** SHIPSHAPE_POSTAL_ADDRESS (P-E), in the waitlist note's footer. Set whenever that kind is on. */
  postalAddress: string | null;
}

const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;
const TOPIC_ARN = /^arn:aws:sns:([a-z]{2}(?:-[a-z]+)+-\d+):\d{12}:[A-Za-z0-9_-]{1,256}$/;

function kindOn(env: Env, name: string): boolean {
  const value = env[name] ?? "";
  if (value !== "" && value !== "1") throw new Error(`${name} must be 1 or unset`);
  return value === "1";
}

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
  const support = contactEmail(env);
  if (!support) throw new Error("Email sending (SHIPSHAPE_EMAIL=1) needs CONTACT_EMAIL, the support address every email's footer names");
  const welcome = kindOn(env, KIND_FLAGS.welcome);
  const waitlist = kindOn(env, KIND_FLAGS.waitlist_open);
  const deletionRecord = kindOn(env, KIND_FLAGS.deletion);
  const url = appUrl(env)?.origin ?? null;
  if ((welcome || waitlist) && !url) throw new Error(`${welcome ? KIND_FLAGS.welcome : KIND_FLAGS.waitlist_open}=1 needs SHIPSHAPE_APP_URL, the address the email links to`);
  const postal = env.SHIPSHAPE_POSTAL_ADDRESS?.trim() ?? "";
  // Security B: the waitlist note refuses to send while the postal address is empty.
  if (waitlist && (!postal || postal.length > 200 || /\p{Cc}/u.test(postal))) throw new Error(`${KIND_FLAGS.waitlist_open}=1 needs SHIPSHAPE_POSTAL_ADDRESS, the postal address its footer carries (one line)`);
  return {
    from,
    region,
    topicArn,
    support,
    replyReaches: from.toLowerCase() === support.toLowerCase(),
    kinds: QUEUED_KINDS.filter((k) => k === "reminder" || (k === "welcome" ? welcome : waitlist)),
    deletionRecord,
    appUrl: url,
    postalAddress: waitlist ? postal : null,
  };
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

// The texts ----------------------------------------------------------------------------------------------
// Plan 2026-11-04 §3, Drafts B, C and D, with Security 1058's footers. Plain text; {app_url} is filled in at
// sending (the outbox keeps the reviewed text as it is, so a batch's body sha256 is the text's own).

export interface MailText {
  subject: string;
  body: string;
}

const free = PLANS.free;

/** Draft C: the welcome, once, after the first sign-in made the person's workspace (session.ts finishSignIn). */
export const WELCOME: MailText = {
  subject: "Your ShipShape workspace is ready",
  body: [
    `You created a ShipShape account, and your workspace is ready. It's called "My business" until you rename it; people you share with see that name on your links.`,
    "Home lists your next steps. 3 of them:",
    "- Name your workspace in Settings.\n- Confirm your business facts: name, address, EIN. Typed once, used everywhere.\n- Fill a W-9. ShipShape fills the official IRS form from those facts.",
    `Free holds ${free.documents} active documents and ${free.passports} open passport link. Settings has an export of everything as one ZIP file, and account deletion.`,
    "Open your workspace: {app_url}/app",
    "The ShipShape team",
  ].join("\n\n"),
};

/** Draft B: the waitlist's "accounts are open" note, once per address (scripts/waitlist-open-batch.sql holds the same text). */
export const WAITLIST_OPEN: MailText = {
  subject: "ShipShape accounts are open",
  body: [
    "You joined the ShipShape waitlist to hear when real accounts open. They're open now.",
    "With an account you can keep your W-9, insurance certificates, licenses and agreements in one place, fill the official IRS W-9 from business facts you confirm once, and share the documents you pick through one link that lasts 7, 30 or 90 days.",
    `Free holds ${free.documents} active documents and ${free.passports} open link. Pro is $${PLANS.pro.price} a month.`,
    "To sign up you need an email address, a password and an authenticator app on your phone for the two-step code.",
    "Create your account: {app_url}/signin",
    "This is the only email the waitlist gets about accounts opening.",
    "The ShipShape team",
  ].join("\n\n"),
};

/**
 * Why the person gets the email and how to stop it (Security #35 SHOULD; 1058 K3), at the end of every email.
 * "Reply" only when a reply reaches the support inbox (the sender is CONTACT_EMAIL); otherwise "write to" it.
 * A reminder stops when its document is archived or loses its dates (deadlines.ts); a "stop" puts the address
 * on the suppression list (scripts/email-stop.ts), which every kind checks before sending.
 */
export function footer(cfg: MailConfig, kind: QueuedKind): string {
  const s = cfg.support;
  const reply = cfg.replyReaches;
  switch (kind) {
    case "reminder":
      return `You're getting this because you're an owner or admin of this workspace on ShipShape. To stop reminders about this document, archive it or clear its dates in ShipShape. Questions: ${reply ? "reply to this email" : `write to ${s}`}.`;
    case "welcome":
      return `You're getting this once, because this address created a ShipShape account. We don't send a welcome series. ${
        reply ? `Questions: write to ${s}. To get no more email from ShipShape, reply "stop" or write to that address.` : `Questions, or to get no more email from ShipShape: write to ${s}.`
      }`;
    case "waitlist_open":
      return `You're getting this because this address joined the waitlist on ShipShape's home page. We don't check addresses when people join, so if that wasn't you, ${
        reply ? `reply and we'll delete it. To come off the list, reply "stop" or write to ${s}.` : `write to ${s} and we'll delete it. To come off the list, write to that address.`
      }\nShipShape is operated by Unvibe, ${cfg.postalAddress ?? ""}`;
  }
}

/** One plain-text message through the configuration set: the text, then the footer. Nothing else: no HTML part, no headers, no tracking. */
function textEmail(cfg: MailConfig, to: string, subject: string, body: string, foot: string): SendEmailCommandInput {
  return {
    FromEmailAddress: cfg.from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: `${body}\n\n--\n${foot}`, Charset: "UTF-8" } } } },
    ConfigurationSetName: CONFIGURATION_SET,
  };
}

const REVIEWED: Record<Exclude<QueuedKind, "reminder">, MailText> = { welcome: WELCOME, waitlist_open: WAITLIST_OPEN };

/**
 * The request for one queued row. A reminder is its own text (deadlines.ts writes it); a welcome or waitlist
 * note must be exactly its reviewed text, or it isn't sent at all (null).
 */
export function queuedEmail(cfg: MailConfig, m: { kind: QueuedKind; to_email: string; subject: string; body: string }): SendEmailCommandInput | null {
  if (m.kind === "reminder") return textEmail(cfg, m.to_email, m.subject, m.body, footer(cfg, m.kind));
  const text = REVIEWED[m.kind];
  if (m.subject !== text.subject || m.body !== text.body || !cfg.appUrl || (m.kind === "waitlist_open" && !cfg.postalAddress)) return null;
  return textEmail(cfg, m.to_email, text.subject, text.body.replaceAll("{app_url}", cfg.appUrl), footer(cfg, m.kind));
}

// Sending ---------------------------------------------------------------------------------------------

const suppressionHash = (address: string) => keyedHash(address.trim().toLowerCase(), "email-suppression");

/**
 * What may be emailed: unsent, unclaimed, under the attempt limit and recent (3 days: a kind turned on
 * later never mails out a backlog), of a kind on the allow-list and turned on ($3), and meeting that
 * kind's own recipient rule (Security K1):
 * - reminder: the account address of an owner or admin of the row's real workspace;
 * - welcome: the account address of the row's own person, owner of the row's real workspace;
 * - waitlist_open: an address still on the waitlist with no Collect interest, that belongs to no account
 *   and is no workspace's vendor, contact or signer, nor a sample's made-up address (@sample.example, deadlines.ts).
 * Account addresses must sign in through Cognito (a verified email; a sample visitor never has a Cognito
 * identity, nor an address) and not be being deleted.
 */
const QUEUE_SQL = `
  select m.id, m.kind, m.to_email, m.subject, m.body
  from app.outbox m
  left join app.organizations o on o.id = m.org_id
  where m.kind in ('reminder', 'welcome', 'waitlist_open') and m.kind = any($3::text[])
    and m.sent_at is null and m.claimed_at is null and m.attempts < $1
    and m.created_at > now() - interval '3 days'
    and (
      (m.kind = 'reminder' and not o.is_demo and exists (
        select 1
        from auth.users u
        join app.identities i on i.user_id = u.id and i.provider = 'cognito'
        join app.members mb on mb.user_id = u.id and mb.org_id = m.org_id and mb.role in ('owner', 'admin')
        where lower(u.email) = lower(m.to_email)
          and not exists (select 1 from app.deletion_requests r where r.user_id = u.id)
      ))
      or (m.kind = 'welcome' and not o.is_demo and exists (
        select 1
        from auth.users u
        join app.identities i on i.user_id = u.id and i.provider = 'cognito'
        join app.members mb on mb.user_id = u.id and mb.org_id = m.org_id and mb.role = 'owner'
        where u.id = m.user_id and lower(u.email) = lower(m.to_email)
          and not exists (select 1 from app.deletion_requests r where r.user_id = u.id)
      ))
      or (m.kind = 'waitlist_open' and m.org_id is null
        and exists (select 1 from app.waitlist w where w.email = m.waitlist_email and w.email = lower(m.to_email) and not ('collect' = any(w.interests)))
        and split_part(lower(m.to_email), '@', 2) <> 'sample.example'
        and not exists (select 1 from auth.users u where lower(u.email) = lower(m.to_email))
        and not exists (select 1 from app.vendors v where lower(v.email) = lower(m.to_email))
        and not exists (select 1 from app.contacts c where lower(c.email) = lower(m.to_email))
        and not exists (select 1 from app.signature_requests s where lower(s.signer_email) = lower(m.to_email)))
    )
  order by m.created_at, m.id
  limit $2`;

interface Queued {
  id: string;
  kind: QueuedKind;
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
 * Emails what waits in the outbox (the daily run, after runReminders): every kind that is on, under the
 * same caps. Null while email is off. Stops at `until` (the daily run's budget); what's left waits for
 * the next run.
 */
export async function sendQueuedMail(until = Number.POSITIVE_INFINITY): Promise<MailRun | null> {
  const cfg = mailConfig(process.env);
  if (!cfg) return null;
  mailSender ??= sesSender(sesClient(cfg, process.env));
  const ses = mailSender;
  const queue = await asService((tx) => tx.query<Queued>(QUEUE_SQL, [MAX_ATTEMPTS, DAILY_CAP, cfg.kinds]));
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
    const request = queuedEmail(cfg, m);
    if (!request) {
      run.failed++;
      console.error(`mail: ${m.id} not sent (not the reviewed text)`);
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
      messageId = await ses.send(request);
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
