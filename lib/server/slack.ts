import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { decryptField, encryptField, fieldKey, safeEqual, sha256Hex } from "./crypto";
import { asService, asUser } from "./db";
import { appUrl } from "./flags";
import { rateLimited } from "./http";
import { scrub } from "./log";
import { sessionSecret } from "./session";
import type { SignedIn } from "./session";

/**
 * Slack: deadline reminders posted to one channel per workspace (migration 0052).
 *
 * - "Add to Slack" is Slack's OAuth v2 with the single scope incoming-webhook. The person picks the channel on Slack's
 *   own consent screen; what comes back is a webhook address for that channel and a token, both stored encrypted.
 *   ShipShape can post to that channel and can't read anything in Slack.
 * - Off unless fully configured (slackConfig): SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in their forms, an https
 *   SHIPSHAPE_APP_URL, and the field and session keys. Off, nothing here is offered or called.
 * - Only owners and admins of a real (not sample) workspace connect, test or disconnect; the database refuses
 *   anyone else's row too (0052).
 * - The state that goes to Slack and back is signed, bound to this browser's session, person and workspace, valid
 *   10 minutes and taken once (app.slack_states_used).
 * - Outbound calls go to three addresses only, all through `call`: Slack's oauth.v2.access and auth.revoke (fixed
 *   constants), and a webhook on https://hooks.slack.com/services/ (slackWebhookUrl, checked before it's stored and
 *   again before every post). Every call has a timeout and follows no redirect.
 * - A message is short plain text: the workspace's name, the document's title, what's due and when, and a link to
 *   Deadlines. Anything shaped like a tax number is blanked (scrub) and Slack's control characters are escaped.
 * - Failures are logged by the error's name and Slack's error word only: never an address, a token or a title.
 */

type Env = Record<string, string | undefined>;
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const START_PATH = "/api/integrations/slack/start";
export const CALLBACK_PATH = "/api/integrations/slack/callback";
const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
export const REVOKE_URL = "https://slack.com/api/auth.revoke";
export const SLACK_SCOPE = "incoming-webhook";

/** Field names for encryptField: each ciphertext opens only for its own workspace and field. */
const WEBHOOK_FIELD = "slack_webhook_url";
const TOKEN_FIELD = "slack_access_token";

export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  /** The app's https origin. */
  appUrl: string;
  /** <SHIPSHAPE_APP_URL>/api/integrations/slack/callback, registered on the Slack app exactly. */
  redirectUri: string;
}

// Slack's forms: a client id is two dot-joined numbers, a secret 32 hex digits (allowing for a longer one).
const CLIENT_ID = /^\d{4,20}\.\d{4,20}$/;
const CLIENT_SECRET = /^[A-Za-z0-9]{20,64}$/;

/** Slack's settings, or null: then nothing about Slack shows anywhere and nothing is called. */
export function slackConfig(env: Env = process.env): SlackConfig | null {
  const clientId = env.SLACK_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.SLACK_CLIENT_SECRET?.trim() ?? "";
  if (!CLIENT_ID.test(clientId) || !CLIENT_SECRET.test(clientSecret)) return null;
  const app = appUrl(env);
  if (!app || app.protocol !== "https:") return null;
  // Connecting stores the secrets encrypted and signs the state: without either key it could never finish.
  try {
    fieldKey(env);
    sessionSecret(env);
  } catch {
    return null;
  }
  return { clientId, clientSecret, appUrl: app.origin, redirectUri: `${app.origin}${CALLBACK_PATH}` };
}

// Destinations ------------------------------------------------------------------------------------------

const WEBHOOK_PATH = /^\/services\/[A-Za-z0-9]{1,40}\/[A-Za-z0-9]{1,40}\/[A-Za-z0-9]{1,100}$/;

/**
 * A Slack incoming webhook's address as Slack gives it, or null: https, the host exactly hooks.slack.com, no port,
 * no credentials, a path of /services/<team>/<hook>/<secret> and nothing after it, written the one way a URL
 * serializes (so no ":443", no dot segments, no case games).
 */
export function slackWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300 || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "hooks.slack.com") return null;
  if (url.port !== "") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (!WEBHOOK_PATH.test(url.pathname)) return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.href !== raw) return null;
  return url.href;
}

/** Why a Slack call didn't work: `code` is Slack's own error word, or ours (timeout, unreachable, http_500...). Never holds an address or a token. */
export class SlackError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Slack: ${code}`);
    this.name = "SlackError";
    this.code = code;
  }
}

/** Slack's error words are lowercase with underscores; anything else is reported as "error". */
const word = (s: unknown) => (typeof s === "string" && /^[a-z_]{1,40}$/.test(s) ? s : "error");

/** What a log line may say about an error: its name, and Slack's error word for ours. */
export function slackErrorName(e: unknown): string {
  if (e instanceof SlackError) return `SlackError ${e.code}`;
  return e instanceof Error ? e.name.slice(0, 60) : "error";
}

const defaultFetch: Fetch = (input, init) => fetch(input, init);
let slackFetch: Fetch = defaultFetch;

/** Tests stand in for Slack. */
export function setSlackFetchForTests(f: Fetch | undefined) {
  slackFetch = f ?? defaultFetch;
}

/** The one way out to Slack: no redirects, a timeout. A network failure says only that it failed. */
async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await slackFetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(Math.max(1, timeoutMs)) });
  } catch (e) {
    throw new SlackError(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "unreachable");
  }
}

const CALL_MS = 10_000;
const POST_MS = 5_000;

// The state ------------------------------------------------------------------------------------------------

export const STATE_SECONDS = 10 * 60;
const SKEW_SECONDS = 60;

const State = z.object({ o: z.string(), u: z.string(), s: z.string(), n: z.string().min(32).max(64), c: z.number().int() });
// A label of its own, so no other MAC made with the session secret can pass as this state.
const stateMac = (payload: string) => createHmac("sha256", sessionSecret()).update(`slack-state:${payload}`).digest("base64url");

/** Whose "Add to Slack" this is: the state is bound to all three. */
export type StateOwner = Pick<SignedIn, "orgId" | "userId" | "sessionId">;

export function newSlackState(who: StateOwner, now = Date.now()): string {
  const state = { o: who.orgId, u: who.userId, s: who.sessionId, n: randomBytes(32).toString("base64url"), c: Math.floor(now / 1000) };
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${stateMac(payload)}`;
}

function parseJson(base64url: string): unknown {
  try {
    return JSON.parse(Buffer.from(base64url, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Whether the state that came back is one this session started for this workspace in the last 10 minutes, and not
 * used before. Taking it uses it up, whatever happens next.
 */
export async function takeSlackState(state: string | null, who: StateOwner, now = Date.now()): Promise<boolean> {
  if (!state || state.length > 1000) return false;
  const [payload, mac, extra] = state.split(".");
  if (!payload || !mac || extra !== undefined || !safeEqual(mac, stateMac(payload))) return false;
  const parsed = State.safeParse(parseJson(payload));
  if (!parsed.success) return false;
  const { o, u, s, n, c } = parsed.data;
  const age = now / 1000 - c;
  if (age < -SKEW_SECONDS || age > STATE_SECONDS) return false;
  if (s !== who.sessionId) return false;
  if (u !== who.userId) return false;
  if (o !== who.orgId) return false;
  const taken = await asService(async (tx) => {
    await tx.query("delete from app.slack_states_used where expires_at < now()");
    return tx.query("insert into app.slack_states_used (nonce_sha256, expires_at) values ($1, now() + interval '15 minutes') on conflict do nothing returning 1", [sha256Hex(n)]);
  });
  return taken.length === 1;
}

/** Slack's consent screen for this state: the one scope, the registered return address. */
export function slackAuthorizeUrl(cfg: SlackConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({ client_id: cfg.clientId, scope: SLACK_SCOPE, redirect_uri: cfg.redirectUri, state }).toString();
  return url.toString();
}

// The exchange ---------------------------------------------------------------------------------------------

const Access = z.object({
  ok: z.literal(true),
  access_token: z.string().regex(/^xox[a-z]-[A-Za-z0-9-]{10,250}$/),
  scope: z.literal(SLACK_SCOPE),
  team: z.object({ id: z.string().regex(/^[TE][A-Z0-9]{2,30}$/), name: z.string().min(1).max(200) }),
  incoming_webhook: z.object({ channel: z.string().min(1).max(200), url: z.string() }),
});
const SlackAnswer = z.object({ ok: z.boolean(), error: z.string().optional() });

export interface SlackInstall {
  webhookUrl: string;
  accessToken: string;
  channel: string;
  teamId: string;
  teamName: string;
}

// Control characters (a newline in a channel or team name would break Settings' one line and the message).
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Trades the code for the webhook and token (oauth.v2.access, the client's id and secret as HTTP Basic). Throws SlackError. */
export async function exchangeSlackCode(cfg: SlackConfig, code: string): Promise<SlackInstall> {
  const basic = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64");
  const res = await call(
    OAUTH_ACCESS_URL,
    {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ code, redirect_uri: cfg.redirectUri }).toString(),
    },
    CALL_MS,
  );
  const json: unknown = await res.json().catch(() => null);
  const answer = SlackAnswer.safeParse(json);
  if (!answer.success) throw new SlackError(`http_${res.status}`);
  if (!answer.data.ok) throw new SlackError(word(answer.data.error));
  const got = Access.safeParse(json);
  if (!got.success) throw new SlackError("unexpected_answer");
  const webhookUrl = slackWebhookUrl(got.data.incoming_webhook.url);
  if (!webhookUrl) throw new SlackError("webhook_refused");
  const channel = got.data.incoming_webhook.channel.replace(CONTROLS, "").trim();
  const teamName = got.data.team.name.replace(CONTROLS, "").trim();
  if (!channel || !teamName) throw new SlackError("unexpected_answer");
  return { webhookUrl, accessToken: got.data.access_token, channel, teamId: got.data.team.id, teamName };
}

// Revoke words that mean the token is already no good: nothing left to revoke.
const GONE: Record<string, true> = { invalid_auth: true, token_revoked: true, account_inactive: true, not_authed: true, token_expired: true };

/** Revokes the token (auth.revoke): Slack then removes the install and its webhook. A token already gone counts as revoked. Throws SlackError. */
export async function revokeSlackToken(token: string): Promise<void> {
  const res = await call(
    REVOKE_URL,
    { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: "" },
    CALL_MS,
  );
  const answer = SlackAnswer.safeParse(await res.json().catch(() => null));
  if (!answer.success) throw new SlackError(`http_${res.status}`);
  if (answer.data.ok || Object.hasOwn(GONE, word(answer.data.error))) return;
  throw new SlackError(word(answer.data.error));
}

// Posting ----------------------------------------------------------------------------------------------------

// Slack's answers that mean this webhook will never work again (https://api.slack.com/messaging/webhooks#handling_errors):
// the channel or the install is gone. A post then marks the connection broken and Settings offers Reconnect.
const BROKEN_STATUS: Record<number, true> = { 404: true, 410: true };
const BROKEN_WORDS: Record<string, true> = { no_service: true, channel_not_found: true, channel_is_archived: true, team_disabled: true, no_team: true, invalid_token: true };

/** Posts plain text to the webhook. "broken": Slack says it's gone (or the stored address fails the check). Throws SlackError otherwise. */
export async function postToSlack(webhookUrl: string, text: string, timeoutMs = POST_MS): Promise<"ok" | "broken"> {
  const url = slackWebhookUrl(webhookUrl);
  if (!url) return "broken";
  const res = await call(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }, Math.min(POST_MS, timeoutMs));
  if (res.ok) return "ok";
  const answer = (await res.text().catch(() => "")).trim().slice(0, 60);
  if (Object.hasOwn(BROKEN_STATUS, res.status) || Object.hasOwn(BROKEN_WORDS, answer)) return "broken";
  throw new SlackError(answer && word(answer) !== "error" ? answer : `http_${res.status}`);
}

/** Slack reads <, > and & as markup: escaped, so a title can't make a link or a mention. */
export const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A reminder's text as queued: the workspace and the reminder's own line, tax-number shapes blanked. */
export function slackReminderBody(workspace: string, line: string): string {
  return `ShipShape reminder for ${slackEscape(scrub(workspace))}: ${slackEscape(scrub(line))}`.slice(0, 1500);
}

/** The text as posted: the body, then a link to Deadlines. */
export const slackMessage = (body: string, origin: string) => `${body}\n<${origin}/app/deadlines|Open Deadlines in ShipShape>`;

// Who may do what -----------------------------------------------------------------------------------------------

export type SlackWho = Pick<SignedIn, "userId" | "orgId" | "role" | "demo" | "name">;

/** The secrets, for an owner or admin of the workspace only (asked of the database, not just the session). */
const SECRETS_SQL = `
  select c.webhook_url_enc, c.access_token_enc, c.team_id
  from app.slack_connections c
  where c.org_id = $1
    and exists (select 1 from app.members m where m.org_id = c.org_id and m.user_id = $2 and m.role in ('owner', 'admin'))`;

interface Secrets {
  webhook_url_enc: string;
  access_token_enc: string;
  team_id: string;
}

const secretsFor = async (who: SlackWho) => (await asService((tx) => tx.query<Secrets>(SECRETS_SQL, [who.orgId, who.userId])))[0];

/** What the Settings page says after an action: one fixed message each (app/app/settings/v2.tsx). */
export type SlackOutcome = "connected" | "cancelled" | "failed" | "refused" | "busy" | "tested" | "test_failed" | "broken" | "disconnected" | "disconnect_failed";
export const SLACK_OUTCOMES: readonly SlackOutcome[] = ["connected", "cancelled", "failed", "refused", "busy", "tested", "test_failed", "broken", "disconnected", "disconnect_failed"];

/** Back to Settings' Slack row, saying how it went (the routes; the actions use redirect()). */
export function backToSettings(outcome: SlackOutcome): Response {
  return new Response(null, { status: 303, headers: { Location: `/app/settings?slack=${outcome}#slack`, "Cache-Control": "no-store" } });
}

const canManage = (who: SlackWho) => !who.demo && who.role !== "member";

/** Revokes a token we no longer keep, logging a failure by name only. */
async function revokeQuietly(token: string, what: string): Promise<void> {
  try {
    await revokeSlackToken(token);
  } catch (e) {
    console.error(`slack: ${what}: token not revoked (${slackErrorName(e)})`);
  }
}

export interface CallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
}

/**
 * The callback's work: the state first (taken whatever follows), then Slack's answer, then the exchange, then the
 * row, replacing the workspace's earlier connection. A new install in another Slack team revokes the old team's
 * token; in the same team Slack hands back the same app install, so revoking would undo the new one.
 */
export async function finishSlackConnect(cfg: SlackConfig, who: SlackWho & StateOwner, params: CallbackParams): Promise<SlackOutcome> {
  if (!canManage(who)) return "refused";
  if (!(await takeSlackState(params.state, who))) return "failed";
  if (params.error) return params.error === "access_denied" ? "cancelled" : "failed";
  if (!params.code || params.code.length > 512) return "failed";
  let got: SlackInstall;
  try {
    got = await exchangeSlackCode(cfg, params.code);
  } catch (e) {
    console.error(`slack: connect failed (${slackErrorName(e)})`);
    return "failed";
  }
  const old = await secretsFor(who);
  try {
    await asUser(who.userId, async (tx) => {
      await tx.query("delete from app.slack_connections where org_id = $1", [who.orgId]);
      await tx.query(
        "insert into app.slack_connections (org_id, webhook_url_enc, access_token_enc, channel, team_id, team_name, connected_by) values ($1, $2, $3, $4, $5, $6, $7)",
        [who.orgId, encryptField(got.webhookUrl, who.orgId, WEBHOOK_FIELD), encryptField(got.accessToken, who.orgId, TOKEN_FIELD), got.channel, got.teamId, got.teamName, who.userId],
      );
    });
  } catch (e) {
    console.error(`slack: connect not stored (${slackErrorName(e)})`);
    // Kept nowhere, so it mustn't stay live in Slack either.
    await revokeQuietly(got.accessToken, "connect not stored");
    return "failed";
  }
  if (old && old.team_id !== got.teamId) {
    try {
      await revokeQuietly(decryptField(old.access_token_enc, who.orgId, TOKEN_FIELD), "replaced connection");
    } catch (e) {
      console.error(`slack: replaced connection unreadable (${slackErrorName(e)})`);
    }
  }
  return "connected";
}

/** Marks this exact connection (not a newer one made meanwhile) broken: posting stops and Settings offers Reconnect. */
const MARK_BROKEN_SQL = "update app.slack_connections set broken_at = now() where org_id = $1 and webhook_url_enc = $2 and broken_at is null";

/** "Send a test message": owners and admins of a connected real workspace, 10 an hour. */
export async function sendSlackTest(who: SlackWho): Promise<SlackOutcome> {
  const cfg = slackConfig();
  if (!cfg || !canManage(who)) return "refused";
  if (await rateLimited("slack-test", who.orgId, 10, 3600)) return "busy";
  const c = await secretsFor(who);
  if (!c) return "refused";
  try {
    const text = `ShipShape test message for ${slackEscape(scrub(who.name))}: deadline reminders will post in this channel.`;
    const result = await postToSlack(decryptField(c.webhook_url_enc, who.orgId, WEBHOOK_FIELD), slackMessage(text, cfg.appUrl));
    if (result === "ok") return "tested";
    await asService((tx) => tx.query(MARK_BROKEN_SQL, [who.orgId, c.webhook_url_enc]));
    return "broken";
  } catch (e) {
    console.error(`slack: test message not sent (${slackErrorName(e)})`);
    return "test_failed";
  }
}

/**
 * "Disconnect": revokes the token, then deletes the row. If Slack can't be reached the row stays, so the token isn't
 * forgotten while still live; a token we can't decrypt can't be revoked, so its row goes regardless.
 */
export async function disconnectSlack(who: SlackWho): Promise<SlackOutcome> {
  if (!canManage(who)) return "refused";
  const c = await secretsFor(who);
  if (c) {
    let token: string | null = null;
    try {
      token = decryptField(c.access_token_enc, who.orgId, TOKEN_FIELD);
    } catch (e) {
      console.error(`slack: disconnect: token unreadable (${slackErrorName(e)})`);
    }
    if (token !== null) {
      try {
        await revokeSlackToken(token);
      } catch (e) {
        console.error(`slack: disconnect failed (${slackErrorName(e)})`);
        return "disconnect_failed";
      }
    }
  }
  await asUser(who.userId, (tx) => tx.query("delete from app.slack_connections where org_id = $1", [who.orgId]));
  return "disconnected";
}

/**
 * Account deletion (lib/server/account.ts), before the rows go: every workspace the person is the only owner of is
 * about to be deleted, so its token is revoked and its row deleted. A token Slack won't revoke right now is logged
 * and its row deleted anyway: the account's deletion doesn't wait on Slack, and nothing of it stays with us.
 */
export async function disconnectSlackBeforeDeletion(userId: string): Promise<void> {
  const rows = await asService((tx) =>
    tx.query<{ org_id: string; access_token_enc: string }>(
      `select c.org_id, c.access_token_enc from app.slack_connections c
       join app.members m on m.org_id = c.org_id and m.user_id = $1 and m.role = 'owner'
       where not exists (select 1 from app.members o where o.org_id = c.org_id and o.role = 'owner' and o.user_id <> $1)`,
      [userId],
    ),
  );
  for (const r of rows) {
    try {
      await revokeQuietly(decryptField(r.access_token_enc, r.org_id, TOKEN_FIELD), "account deletion");
    } catch (e) {
      console.error(`slack: account deletion: token unreadable (${slackErrorName(e)})`);
    }
    await asService((tx) => tx.query("delete from app.slack_connections where org_id = $1", [r.org_id]));
  }
}

// Settings and export --------------------------------------------------------------------------------------------

export interface SlackRow {
  connection: { channel: string; team: string; broken: boolean } | null;
  canManage: boolean;
}

/** Settings' Slack row, or null where it isn't shown at all: Slack not configured, or a sample workspace. */
export async function slackRow(who: SlackWho): Promise<SlackRow | null> {
  if (!slackConfig() || who.demo) return null;
  const [c] = await asUser(who.userId, (tx) =>
    tx.query<{ channel: string; team_name: string; broken: boolean }>("select channel, team_name, broken_at is not null as broken from app.slack_connections where org_id = $1", [who.orgId]),
  );
  return { connection: c ? { channel: c.channel, team: c.team_name, broken: c.broken } : null, canManage: canManage(who) };
}

// The daily run ------------------------------------------------------------------------------------------------

export const SLACK_MAX_ATTEMPTS = 3;

/**
 * What may be posted: unclaimed, under the tries, at most 3 days old, for a workspace that is connected, not broken,
 * real and on Pro (reminders are part of Pro).
 */
const QUEUE_SQL = `
  select p.id, p.org_id, p.body, c.webhook_url_enc
  from app.slack_posts p
  join app.slack_connections c on c.org_id = p.org_id
  join app.organizations o on o.id = p.org_id
  where p.claimed_at is null and p.attempts < $1 and p.created_at > now() - interval '3 days'
    and c.broken_at is null and not o.is_demo and app.org_plan(p.org_id) = 'pro'
  order by p.created_at, p.id
  limit 500`;

interface QueuedPost {
  id: string;
  org_id: string;
  body: string;
  webhook_url_enc: string;
}

export interface SlackRun {
  sent: number;
  failed: number;
  /** Left for the next run: past the time budget. */
  held: number;
  /** Workspaces whose channel Slack said is gone (marked broken this run). */
  broken: number;
}

/**
 * Posts the reminders runReminders queued (the daily run, after it). Each is claimed before the post and deleted once
 * Slack took it, so it goes at most once; a failure puts it back for the next run, up to 3 tries. Stops at `until`
 * (the daily run's budget), and no post waits past it. Rows over 3 days old or out of tries are deleted first,
 * whether or not Slack is configured. Null while Slack isn't configured.
 */
export async function sendSlackPosts(until = Number.POSITIVE_INFINITY): Promise<SlackRun | null> {
  await asService((tx) =>
    tx.query("delete from app.slack_posts where created_at <= now() - interval '3 days' or (attempts >= $1 and claimed_at is null)", [SLACK_MAX_ATTEMPTS]),
  );
  const cfg = slackConfig();
  if (!cfg) return null;
  const queue = await asService((tx) => tx.query<QueuedPost>(QUEUE_SQL, [SLACK_MAX_ATTEMPTS]));
  const run: SlackRun = { sent: 0, failed: 0, held: 0, broken: 0 };
  const brokenOrgs = new Set<string>();
  for (const [i, p] of queue.entries()) {
    const left = until - Date.now();
    if (left <= 0) {
      run.held += queue.length - i;
      break;
    }
    if (brokenOrgs.has(p.org_id)) continue;
    const claimed = await asService((tx) =>
      tx.query("update app.slack_posts set claimed_at = now(), attempts = attempts + 1 where id = $1 and claimed_at is null and attempts < $2 returning 1", [p.id, SLACK_MAX_ATTEMPTS]),
    );
    if (!claimed.length) continue;
    let result: "ok" | "broken";
    try {
      result = await postToSlack(decryptField(p.webhook_url_enc, p.org_id, WEBHOOK_FIELD), slackMessage(p.body, cfg.appUrl), left);
    } catch (e) {
      const name = slackErrorName(e).slice(0, 100);
      run.failed++;
      // The row's id and the error's name only: never the address, the token or the text.
      console.error(`slack: ${p.id} not posted (${name})`);
      await asService((tx) => tx.query("update app.slack_posts set claimed_at = null, last_error = $2 where id = $1", [p.id, name]));
      continue;
    }
    if (result === "broken") {
      brokenOrgs.add(p.org_id);
      run.broken++;
      console.error(`slack: ${p.org_id}'s channel is gone; marked broken`);
      await asService((tx) => tx.query(MARK_BROKEN_SQL, [p.org_id, p.webhook_url_enc]));
      await asService((tx) => tx.query("update app.slack_posts set claimed_at = null, last_error = 'broken' where id = $1", [p.id]));
      continue;
    }
    await asService((tx) => tx.query("delete from app.slack_posts where id = $1", [p.id]));
    run.sent++;
  }
  return run;
}
