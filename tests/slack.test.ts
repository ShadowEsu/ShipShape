import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptField, encryptField } from "@/lib/server/crypto";
import { asService, asUser } from "@/lib/server/db";
import { runReminders } from "@/lib/server/deadlines";
import { migrate } from "@/lib/server/migrations";
import type { MigrationStep } from "@/lib/server/migrations";
import { GET as callbackGet } from "@/app/api/integrations/slack/callback/route";
import { GET as startGet } from "@/app/api/integrations/slack/start/route";
import { GET as cronGet } from "@/app/api/cron/reminders/route";
import {
  finishSlackConnect,
  sendSlackPosts,
  newSlackState,
  OAUTH_ACCESS_URL,
  REVOKE_URL,
  setSlackFetchForTests,
  slackAuthorizeUrl,
  slackConfig,
  slackErrorName,
  slackWebhookUrl,
  takeSlackState,
} from "@/lib/server/slack";
import type { SlackConfig } from "@/lib/server/slack";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import type { SignedIn } from "@/lib/server/session";
import { freshDb } from "./support/db";
import type { TestDb } from "./support/db";

/** Slack (lib/server/slack.ts, 0052): deadline reminders posted to one channel an owner or admin connects. */

// The request's cookies, as Next.js would hold them.
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.set(name, { value, options }),
    delete: (c: string | { name: string }) => void jar.delete(typeof c === "string" ? c : c.name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.41" }),
}));
// Like Next.js, redirect() and notFound() never return.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  RedirectType: { push: "push", replace: "replace" },
  usePathname: () => "/app/settings",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Made-up values, put together at run time so no secret scanner mistakes them for real ones.
const CLIENT_ID = "1234567890.9876543210";
const CLIENT_SECRET = "f".repeat(32);
const APP = "https://app.shipshape.example";
const HOOK = ["https://hooks.slack.com/services", "T0TEST", "B0TEST", "s3cr3tPathPart"].join("/");
const TOKEN = ["xoxb", "test", "SecretTokenValue"].join("-");

let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
});

/** Slack fully configured, as Production would be. */
function configure() {
  vi.stubEnv("SLACK_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("SLACK_CLIENT_SECRET", CLIENT_SECRET);
  vi.stubEnv("SHIPSHAPE_APP_URL", APP);
}

beforeEach(() => {
  vi.stubEnv("SHIPSHAPE_UI", "v2");
  configure();
});
afterEach(() => {
  jar.clear();
  setSlackFetchForTests(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface Call {
  url: string;
  body: string;
  auth: string | null;
  redirect: RequestRedirect | undefined;
  timed: boolean;
}

/** oauth.v2.access's answer for an incoming-webhook install (https://api.slack.com/methods/oauth.v2.access). */
const ACCESS = {
  ok: true,
  access_token: TOKEN,
  token_type: "bot",
  scope: "incoming-webhook",
  team: { id: "T0123ABC", name: "Acme Team" },
  incoming_webhook: { channel: "#deadlines", channel_id: "C0123", configuration_url: "https://acme.slack.com/services/B0456DEF", url: HOOK },
};

interface FakeSlack {
  calls: Call[];
  access: Record<string, unknown>;
  revoke: Record<string, unknown>;
  hook: (signal: AbortSignal | undefined) => Response | Promise<Response>;
  posts: () => Call[];
}

/** A stand-in for Slack: the token exchange, revoke and the webhook, each answer changeable; every call recorded. */
function fakeSlack(): FakeSlack {
  const calls: Call[] = [];
  const fake: FakeSlack = {
    calls,
    access: ACCESS,
    revoke: { ok: true, revoked: true },
    hook: () => new Response("ok", { status: 200 }),
    posts: () => calls.filter((c) => c.url.startsWith("https://hooks.slack.com/")),
  };
  setSlackFetchForTests(async (input, init) => {
    const url = String(input);
    fake.calls.push({
      url,
      body: typeof init?.body === "string" ? init.body : "",
      auth: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
      timed: init?.signal instanceof AbortSignal,
    });
    if (url === OAUTH_ACCESS_URL) return Response.json(fake.access);
    if (url === REVOKE_URL) return Response.json(fake.revoke);
    if (url.startsWith("https://hooks.slack.com/")) return fake.hook(init?.signal ?? undefined);
    throw new Error(`unexpected address ${url}`);
  });
  return fake;
}

/** Signs a new person in to a new (Free) workspace of their own, the way the sign-in page does. */
async function signIn(email: string): Promise<SignedIn> {
  await finishSignIn(await createLocalUser(email, false), { demo: false });
  return requireWorkspace();
}

/** Adds someone to the workspace with this role and signs them in (their cookie replaces the jar's). */
async function teammate(ctx: SignedIn, email: string, role: "member" | "admin"): Promise<SignedIn> {
  const userId = await db.user(email);
  await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, $3)", [ctx.orgId, userId, role]));
  await finishSignIn(userId, { demo: false });
  return requireWorkspace();
}

const cfg = (): SlackConfig => {
  const c = slackConfig();
  if (!c) throw new Error("Slack isn't configured in this test");
  return c;
};

/** Connects the workspace through the callback's own steps, against the fake Slack. */
async function connect(ctx: SignedIn) {
  expect(await finishSlackConnect(cfg(), ctx, { code: "code-1", state: newSlackState(ctx), error: null })).toBe("connected");
}

const connection = async (orgId: string) =>
  (await db.root((tx) => tx.query<{ webhook_url_enc: string; access_token_enc: string; channel: string; team_name: string; broken_at: string | null }>("select * from app.slack_connections where org_id = $1", [orgId])))[0];

const logged = () => {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
  return lines;
};

describe("configuration", () => {
  const base = () => ({
    SLACK_CLIENT_ID: CLIENT_ID,
    SLACK_CLIENT_SECRET: CLIENT_SECRET,
    SHIPSHAPE_APP_URL: APP,
    SHIPSHAPE_FIELD_KEY: process.env.SHIPSHAPE_FIELD_KEY,
    SHIPSHAPE_SESSION_SECRET: process.env.SHIPSHAPE_SESSION_SECRET,
  });

  it("is on only with the client id, the secret, an https app address and both keys", () => {
    expect(slackConfig(base())).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, appUrl: APP, redirectUri: `${APP}/api/integrations/slack/callback` });
    for (const off of [
      { SLACK_CLIENT_ID: undefined },
      { SLACK_CLIENT_ID: "not-an-id" },
      { SLACK_CLIENT_SECRET: undefined },
      { SLACK_CLIENT_SECRET: "short" },
      { SHIPSHAPE_APP_URL: undefined },
      { SHIPSHAPE_APP_URL: "http://app.shipshape.example" },
      { SHIPSHAPE_FIELD_KEY: undefined },
      { SHIPSHAPE_SESSION_SECRET: undefined },
    ]) {
      expect(slackConfig({ ...base(), ...off }), JSON.stringify(off)).toBeNull();
    }
  });

  it("sends people to Slack's consent screen with the one scope, the registered return address and the state", () => {
    const url = new URL(slackAuthorizeUrl(cfg(), "state-1"));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: CLIENT_ID, scope: "incoming-webhook", redirect_uri: `${APP}/api/integrations/slack/callback`, state: "state-1" });
  });
});

describe("the webhook address check", () => {
  it("takes Slack's own webhook address", () => {
    expect(slackWebhookUrl(HOOK)).toBe(HOOK);
  });

  it("refuses look-alikes and anything else", () => {
    for (const bad of [
      HOOK.replace("hooks.slack.com", "hooks.slack.com.evil.example"),
      HOOK.replace("https:", "http:"),
      HOOK.replace("https://", "https://user@"),
      HOOK.replace("https://", "https://user:pw@"),
      HOOK.replace("hooks.slack.com", "hooks.slack.com:8443"),
      HOOK.replace("hooks.slack.com", "hooks.slack.com:443"),
      HOOK.replace("/services/", "/workflows/"),
      HOOK.replace("/services/", "/services/x/../"),
      HOOK.replace("hooks.slack.com", "slack.com"),
      HOOK.replace("hooks.slack.com", "evil.example/hooks.slack.com"),
      `${HOOK}?x=1`,
      `${HOOK}#x`,
      `${HOOK}/more`,
      "https://hooks.slack.com/services/",
      "not a url",
      42,
    ]) {
      expect(slackWebhookUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("the state", () => {
  it("works once, for the session, person and workspace that started it, for 10 minutes", async () => {
    const ctx = await signIn("state@example.com");
    const state = newSlackState(ctx);
    expect(await takeSlackState(state, ctx)).toBe(true);
    // Replayed.
    expect(await takeSlackState(state, ctx)).toBe(false);
    // 9 minutes old is fine; 11 isn't.
    expect(await takeSlackState(newSlackState(ctx, Date.now() - 9 * 60_000), ctx)).toBe(true);
    expect(await takeSlackState(newSlackState(ctx, Date.now() - 11 * 60_000), ctx)).toBe(false);
  });

  it("is refused from another session, another person or another workspace, or changed", async () => {
    const ctx = await signIn("state-bound@example.com");
    const other = await signIn("state-other@example.com");
    expect(await takeSlackState(newSlackState({ ...ctx, sessionId: other.sessionId }), ctx)).toBe(false);
    expect(await takeSlackState(newSlackState({ ...ctx, userId: other.userId }), ctx)).toBe(false);
    expect(await takeSlackState(newSlackState({ ...ctx, orgId: other.orgId }), ctx)).toBe(false);
    const [payload, mac] = newSlackState(ctx).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), o: ctx.orgId })).toString("base64url");
    expect(await takeSlackState(`${forged}.${mac.slice(0, -2)}xx`, ctx)).toBe(false);
    expect(await takeSlackState(null, ctx)).toBe(false);
    // None of those used anything up: the right state still works.
    expect(await takeSlackState(newSlackState(ctx), ctx)).toBe(true);
  });
});

describe("connecting", () => {
  it("trades the code server to server and stores the webhook and token encrypted only", async () => {
    const slack = fakeSlack();
    const ctx = await signIn("connect@example.com");
    await connect(ctx);

    const [exchange] = slack.calls;
    expect(exchange.url).toBe(OAUTH_ACCESS_URL);
    expect(exchange.auth).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({ code: "code-1", redirect_uri: `${APP}/api/integrations/slack/callback` });
    expect(exchange.redirect).toBe("error");
    expect(exchange.timed).toBe(true);

    const row = await connection(ctx.orgId);
    expect(row).toMatchObject({ channel: "#deadlines", team_name: "Acme Team", broken_at: null });
    const everything = JSON.stringify(await db.root((tx) => tx.query("select * from app.slack_connections where org_id = $1", [ctx.orgId])));
    expect(everything).not.toContain("s3cr3tPathPart");
    expect(everything).not.toContain("SecretTokenValue");
    expect(decryptField(row.webhook_url_enc, ctx.orgId, "slack_webhook_url")).toBe(HOOK);
    expect(decryptField(row.access_token_enc, ctx.orgId, "slack_access_token")).toBe(TOKEN);
    // Each opens only for its own workspace and field.
    expect(() => decryptField(row.webhook_url_enc, ctx.orgId, "slack_access_token")).toThrow();

    // Signed in, even the owner can't read either secret column; the rest, yes.
    await expect(asUser(ctx.userId, (tx) => tx.query("select webhook_url_enc from app.slack_connections"))).rejects.toThrow(/permission denied/);
    await expect(asUser(ctx.userId, (tx) => tx.query("select access_token_enc from app.slack_connections"))).rejects.toThrow(/permission denied/);
    expect(await asUser(ctx.userId, (tx) => tx.query("select channel, team_name from app.slack_connections"))).toEqual([{ channel: "#deadlines", team_name: "Acme Team" }]);
  });

  it("refuses an answer with more than the one scope, or a webhook that isn't Slack's", async () => {
    const slack = fakeSlack();
    const ctx = await signIn("connect-scope@example.com");
    const quiet = logged();
    slack.access = { ...ACCESS, scope: "incoming-webhook,chat:write" };
    expect(await finishSlackConnect(cfg(), ctx, { code: "c", state: newSlackState(ctx), error: null })).toBe("failed");
    slack.access = { ...ACCESS, incoming_webhook: { ...ACCESS.incoming_webhook, url: HOOK.replace("hooks.slack.com", "hooks.slack.com.evil.example") } };
    expect(await finishSlackConnect(cfg(), ctx, { code: "c", state: newSlackState(ctx), error: null })).toBe("failed");
    expect(await connection(ctx.orgId)).toBeUndefined();
    expect(quiet.join("\n")).toMatch(/unexpected_answer[\s\S]*webhook_refused/);
  });

  it("never calls Slack for a refused state, and stores nothing", async () => {
    const slack = fakeSlack();
    const ctx = await signIn("connect-state@example.com");
    expect(await finishSlackConnect(cfg(), ctx, { code: "c", state: "nope", error: null })).toBe("failed");
    expect(slack.calls).toEqual([]);
    expect(await connection(ctx.orgId)).toBeUndefined();
  });

  it("logs a failure by the error's name and Slack's error word only", async () => {
    const ctx = await signIn("connect-log@example.com");
    const lines = logged();
    setSlackFetchForTests(async () => {
      throw new Error(`fetch failed for ${HOOK} with ${TOKEN}`);
    });
    expect(await finishSlackConnect(cfg(), ctx, { code: "c", state: newSlackState(ctx), error: null })).toBe("failed");
    const slack = fakeSlack();
    slack.access = { ok: false, error: "invalid_code" };
    expect(await finishSlackConnect(cfg(), ctx, { code: "c", state: newSlackState(ctx), error: null })).toBe("failed");
    slack.access = { ok: false, error: `<${TOKEN}>` };
    expect(await finishSlackConnect(cfg(), ctx, { code: "c", state: newSlackState(ctx), error: null })).toBe("failed");
    expect(lines).toEqual(["slack: connect failed (SlackError unreachable)", "slack: connect failed (SlackError invalid_code)", "slack: connect failed (SlackError error)"]);
    // Any other error (the database's, decryption's) by its name alone.
    expect(slackErrorName(new TypeError(`bad ${HOOK} ${TOKEN}`))).toBe("TypeError");
  });

  it("the database refuses a member's row and a sample's, and anyone reading the secrets or the queue", async () => {
    const owner = await signIn("connect-db@example.com");
    const member = await teammate(owner, "connect-db-member@example.com", "member");
    const row = (orgId: string, by: string) =>
      asUser(by, (tx) =>
        tx.query("insert into app.slack_connections (org_id, webhook_url_enc, access_token_enc, channel, team_id, team_name, connected_by) values ($1, 'v1.a', 'v1.b', '#x', 'T123', 'X', $2)", [orgId, by]),
      );
    await expect(row(owner.orgId, member.userId)).rejects.toThrow(/row-level security/);
    const sampleUser = await createLocalUser(null, true);
    const [sample] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample (sample)') as id", [sampleUser]));
    await expect(row(sample.id, sampleUser)).rejects.toThrow(/row-level security/);
    await expect(asUser(owner.userId, (tx) => tx.query("select 1 from app.slack_posts"))).rejects.toThrow(/permission denied/);
    await expect(asUser(owner.userId, (tx) => tx.query("select 1 from app.slack_states_used"))).rejects.toThrow(/permission denied/);
    // The owner's own row goes in; nobody signed in changes it afterwards.
    await row(owner.orgId, owner.userId);
    await expect(asUser(owner.userId, (tx) => tx.query("update app.slack_connections set broken_at = null where org_id = $1", [owner.orgId]))).rejects.toThrow(/permission denied/);
  });
});

/** A sample visitor, signed in to a fresh sample workspace. */
async function signInSample(): Promise<SignedIn> {
  const userId = await createLocalUser(null, true);
  await asService((tx) => tx.query("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)')", [userId]));
  await finishSignIn(userId, { demo: true });
  return requireWorkspace();
}

const startRequest = (headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) => new Request(`${APP}/api/integrations/slack/start`, { headers });
const callbackRequest = (params: Record<string, string>) => new Request(`${APP}/api/integrations/slack/callback?${new URLSearchParams(params)}`);

/** "Connect" as the browser follows it: the state from Slack's consent address. */
async function start(): Promise<string> {
  const res = await startGet(startRequest());
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get("location") ?? "");
  expect(to.origin + to.pathname).toBe("https://slack.com/oauth/v2/authorize");
  return to.searchParams.get("state") ?? "";
}

describe("the routes", () => {
  it("don't exist while Slack isn't configured", async () => {
    await signIn("routes-off@example.com");
    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    expect((await startGet(startRequest())).status).toBe(404);
    expect((await callbackGet(callbackRequest({ code: "c", state: "s" }))).status).toBe(404);
  });

  it("start: an owner or admin following the link on this site goes to Slack; another site's link, a member and a sample don't", async () => {
    const owner = await signIn("routes-start@example.com");
    expect(await takeSlackState(await start(), owner)).toBe(true);
    for (const headers of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "none" }, {}, { origin: "https://evil.example", host: "app.shipshape.example" }]) {
      expect((await startGet(startRequest(headers))).status, JSON.stringify(headers)).toBe(403);
    }
    const admin = await teammate(owner, "routes-start-admin@example.com", "admin");
    expect(await takeSlackState(await start(), admin)).toBe(true);
    await teammate(owner, "routes-start-member@example.com", "member");
    const refused = await startGet(startRequest());
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe("/app/settings?slack=refused#slack");
    await signInSample();
    expect((await startGet(startRequest())).headers.get("location")).toBe("/app/settings?slack=refused#slack");
    jar.clear();
    await expect(startGet(startRequest())).rejects.toThrow("redirect /signin");
  });

  it("callback: connects for the owner who started it", async () => {
    const slack = fakeSlack();
    const owner = await signIn("routes-callback@example.com");
    const res = await callbackGet(callbackRequest({ code: "code-1", state: await start() }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/app/settings?slack=connected#slack");
    expect(slack.calls.map((c) => c.url)).toEqual([OAUTH_ACCESS_URL]);
    expect(await connection(owner.orgId)).toMatchObject({ channel: "#deadlines", team_name: "Acme Team" });
  });

  it("callback: a wrong state stores nothing and never calls Slack", async () => {
    const slack = fakeSlack();
    const owner = await signIn("routes-wrong@example.com");
    const state = await start();
    for (const bad of [`${state}x`, newSlackState({ ...owner, sessionId: "00000000-0000-0000-0000-000000000000" }), ""]) {
      expect((await callbackGet(callbackRequest({ code: "code-1", state: bad }))).headers.get("location")).toBe("/app/settings?slack=failed#slack");
    }
    // Started by someone else, in their browser.
    const other = await signIn("routes-wrong-other@example.com");
    const theirs = await start();
    await finishSignIn(owner.userId, { demo: false });
    expect((await callbackGet(callbackRequest({ code: "code-1", state: theirs }))).headers.get("location")).toBe("/app/settings?slack=failed#slack");
    expect(slack.calls).toEqual([]);
    expect(await connection(owner.orgId)).toBeUndefined();
    expect(await connection(other.orgId)).toBeUndefined();
  });

  it("callback: Slack's access_denied is a cancel, uses up the state, and calls nothing", async () => {
    const slack = fakeSlack();
    const owner = await signIn("routes-denied@example.com");
    const state = await start();
    expect((await callbackGet(callbackRequest({ error: "access_denied", state }))).headers.get("location")).toBe("/app/settings?slack=cancelled#slack");
    expect((await callbackGet(callbackRequest({ code: "code-1", state }))).headers.get("location")).toBe("/app/settings?slack=failed#slack");
    expect((await callbackGet(callbackRequest({ error: "invalid_scope", state: await start() }))).headers.get("location")).toBe("/app/settings?slack=failed#slack");
    expect(slack.calls).toEqual([]);
    expect(await connection(owner.orgId)).toBeUndefined();
  });

  it("callback: a member or a sample is refused, even with a state of their own", async () => {
    const slack = fakeSlack();
    const owner = await signIn("routes-member@example.com");
    const member = await teammate(owner, "routes-member-member@example.com", "member");
    expect((await callbackGet(callbackRequest({ code: "code-1", state: newSlackState(member) }))).headers.get("location")).toBe("/app/settings?slack=refused#slack");
    const sample = await signInSample();
    expect((await callbackGet(callbackRequest({ code: "code-1", state: newSlackState(sample) }))).headers.get("location")).toBe("/app/settings?slack=refused#slack");
    expect(slack.calls).toEqual([]);
    expect(await connection(owner.orgId)).toBeUndefined();
    expect(await connection(sample.orgId)).toBeUndefined();
  });

  it("start and callback each take 20 tries an hour per person", async () => {
    fakeSlack();
    await signIn("routes-busy@example.com");
    for (let i = 0; i < 20; i++) await start();
    expect((await startGet(startRequest())).headers.get("location")).toBe("/app/settings?slack=busy#slack");
    for (let i = 0; i < 20; i++) await callbackGet(callbackRequest({ error: "access_denied", state: "x" }));
    expect((await callbackGet(callbackRequest({ error: "access_denied", state: "x" }))).headers.get("location")).toBe("/app/settings?slack=busy#slack");
  });
});

const pro = (ctx: SignedIn) =>
  db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, $2, 'active', 'pro')", [ctx.orgId, `cus_${ctx.orgId.slice(0, 8)}`]));
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
async function addDoc(ctx: SignedIn, title: string, days: number): Promise<string> {
  const [d] = await db.root((tx) =>
    tx.query<{ id: string }>("insert into app.documents (org_id, title, kind, created_by, expires_on) values ($1, $2, 'other', $3, $4) returning id", [ctx.orgId, title, ctx.userId, inDays(days)]),
  );
  return d.id;
}
const textOf = (c: Call): string => JSON.parse(c.body).text;
const waiting = async (orgId: string) =>
  db.root((tx) => tx.query<{ attempts: number; claimed: boolean; last_error: string | null }>("select attempts, claimed_at is not null as claimed, last_error from app.slack_posts where org_id = $1", [orgId]));

/** A connected Pro workspace with one document expiring in 5 days. */
async function connectedPro(email: string, title = "Liability certificate") {
  const slack = fakeSlack();
  const ctx = await signIn(email);
  await pro(ctx);
  await connect(ctx);
  const doc = await addDoc(ctx, title, 5);
  slack.calls.length = 0;
  return { slack, ctx, doc };
}

describe("reminders to Slack (the daily run)", () => {
  afterEach(async () => {
    await db.root((tx) => tx.query("delete from app.slack_posts"));
  });

  it("posts each reminder once: the workspace, the title, what's due and when, and a link; no tax number, Slack's markup escaped", async () => {
    const { slack, ctx } = await connectedPro("run-once@example.com", "W-9 Jordan Lee 123-45-6789 <!channel> & co");
    await runReminders(undefined, ctx.orgId);
    expect(await sendSlackPosts()).toEqual({ sent: 1, failed: 0, held: 0, broken: 0 });
    const [post] = slack.posts();
    expect(post.url).toBe(HOOK);
    expect(post.redirect).toBe("error");
    expect(post.timed).toBe(true);
    const text = textOf(post);
    expect(text).toContain("My business");
    expect(text).toContain("expires in 5 days");
    expect(text).toContain(`<${APP}/app/deadlines|`);
    expect(text).not.toContain("123-45-6789");
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt; &amp; co");
    // Again, and again: nothing more.
    await runReminders(undefined, ctx.orgId);
    expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 0, held: 0, broken: 0 });
    expect(slack.posts()).toHaveLength(1);
    expect(await waiting(ctx.orgId)).toEqual([]);
  });

  it("the daily run's answer says what it posted", async () => {
    const { slack, ctx } = await connectedPro("run-cron@example.com");
    vi.stubEnv("CRON_SECRET", "c".repeat(40));
    const res = await cronGet(new Request(`${APP}/api/cron/reminders`, { headers: { authorization: `Bearer ${"c".repeat(40)}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slack.sent).toBeGreaterThanOrEqual(1);
    expect(slack.posts().some((c) => textOf(c).includes("Liability certificate"))).toBe(true);
    expect(await waiting(ctx.orgId)).toEqual([]);
  });

  it("retries a failed post on the next runs, 3 tries in all, logging only the error's name", async () => {
    const { slack, ctx } = await connectedPro("run-retry@example.com");
    const lines = logged();
    slack.hook = () => new Response("rollup_error", { status: 500 });
    await runReminders(undefined, ctx.orgId);
    for (const attempts of [1, 2, 3]) {
      expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 1, held: 0, broken: 0 });
      expect(await waiting(ctx.orgId)).toEqual([{ attempts, claimed: false, last_error: "SlackError rollup_error" }]);
    }
    expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 0, held: 0, broken: 0 });
    expect(slack.posts()).toHaveLength(3);
    // Out of tries: gone.
    expect(await waiting(ctx.orgId)).toEqual([]);
    expect(lines.join("\n")).not.toMatch(/Liability|s3cr3t|hooks\.slack/);
    expect(lines).toHaveLength(3);
  });

  it("two runs at once post a reminder once: each post is claimed before it's sent", async () => {
    const { slack, ctx } = await connectedPro("run-twice@example.com");
    await runReminders(undefined, ctx.orgId);
    const runs = await Promise.all([sendSlackPosts(), sendSlackPosts()]);
    expect(runs.map((r) => r?.sent).sort()).toEqual([0, 1]);
    expect(slack.posts()).toHaveLength(1);
  });

  it("a post that failed once goes on the next run", async () => {
    const { slack, ctx } = await connectedPro("run-retry-ok@example.com");
    logged();
    slack.hook = () => new Response("", { status: 503 });
    await runReminders(undefined, ctx.orgId);
    expect((await sendSlackPosts())?.failed).toBe(1);
    slack.hook = () => new Response("ok", { status: 200 });
    expect((await sendSlackPosts())?.sent).toBe(1);
    expect(await waiting(ctx.orgId)).toEqual([]);
  });

  it("Slack saying the channel is gone marks the connection broken and stops posting there", async () => {
    const a = await connectedPro("run-broken-a@example.com");
    await addDoc(a.ctx, "Business license", 6);
    logged();
    // A 404 with no word, as a removed webhook can answer.
    a.slack.hook = () => new Response("", { status: 404 });
    await runReminders(undefined, a.ctx.orgId);
    expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 0, held: 0, broken: 1 });
    // One try only: the second reminder for that workspace wasn't attempted.
    expect(a.slack.posts()).toHaveLength(1);
    expect((await connection(a.ctx.orgId)).broken_at).not.toBeNull();
    expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 0, held: 0, broken: 0 });
    expect(a.slack.posts()).toHaveLength(1);
    // A new reminder isn't even queued while it's broken.
    await db.root((tx) => tx.query("delete from app.slack_posts where org_id = $1", [a.ctx.orgId]));
    await addDoc(a.ctx, "Permit", 7);
    await runReminders(undefined, a.ctx.orgId);
    expect(await waiting(a.ctx.orgId)).toEqual([]);

    // Slack's word alone says so too.
    const b = await connectedPro("run-broken-b@example.com");
    b.slack.hook = () => new Response("no_service", { status: 400 });
    await runReminders(undefined, b.ctx.orgId);
    expect((await sendSlackPosts())?.broken).toBe(1);
    expect((await connection(b.ctx.orgId)).broken_at).not.toBeNull();
  });

  it("checks the stored webhook address again before every post", async () => {
    const { slack, ctx } = await connectedPro("run-recheck@example.com");
    await db.root((tx) =>
      tx.query("update app.slack_connections set webhook_url_enc = $2 where org_id = $1", [ctx.orgId, encryptField(HOOK.replace("hooks.slack.com", "hooks.slack.com.evil.example"), ctx.orgId, "slack_webhook_url")]),
    );
    logged();
    await runReminders(undefined, ctx.orgId);
    expect((await sendSlackPosts())?.broken).toBe(1);
    expect(slack.calls).toEqual([]);
  });

  it("stays inside the time budget: nothing starts after it, and no post waits past it", async () => {
    const { slack, ctx } = await connectedPro("run-budget@example.com");
    logged();
    await runReminders(undefined, ctx.orgId);
    expect(await sendSlackPosts(Date.now() - 1)).toEqual({ sent: 0, failed: 0, held: 1, broken: 0 });
    expect(slack.posts()).toEqual([]);
    // Slack never answers: the post gives up at the budget, not at its own 5 seconds.
    slack.hook = (signal) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      signal?.addEventListener("abort", () => reject(signal.reason));
      return promise;
    };
    const began = Date.now();
    expect(await sendSlackPosts(Date.now() + 300)).toEqual({ sent: 0, failed: 1, held: 0, broken: 0 });
    expect(Date.now() - began).toBeLessThan(2000);
    expect(await waiting(ctx.orgId)).toEqual([{ attempts: 1, claimed: false, last_error: "SlackError timeout" }]);
  });

  it("drops a post over 3 days old instead of posting a stale reminder", async () => {
    const { slack, ctx } = await connectedPro("run-stale@example.com");
    await runReminders(undefined, ctx.orgId);
    await db.root((tx) => tx.query("update app.slack_posts set created_at = now() - interval '3 days 1 minute' where org_id = $1", [ctx.orgId]));
    expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 0, held: 0, broken: 0 });
    expect(slack.posts()).toEqual([]);
    expect(await waiting(ctx.orgId)).toEqual([]);
  });

  it("never posts for a sample workspace, even one with a connection row put there by hand", async () => {
    const slack = fakeSlack();
    const sample = await signInSample();
    const doc = await addDoc(sample, "Sample certificate", 5);
    await db.root((tx) =>
      tx.query("insert into app.slack_connections (org_id, webhook_url_enc, access_token_enc, channel, team_id, team_name) values ($1, $2, 'v1.x', '#x', 'T123', 'X')", [
        sample.orgId,
        encryptField(HOOK, sample.orgId, "slack_webhook_url"),
      ]),
    );
    await runReminders(undefined, sample.orgId);
    expect(await waiting(sample.orgId)).toEqual([]);
    await db.root((tx) => tx.query("insert into app.slack_posts (org_id, document_id, body) values ($1, $2, 'x')", [sample.orgId, doc]));
    expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 0, held: 0, broken: 0 });
    expect(slack.posts()).toEqual([]);
  });

  it("posts nothing for a workspace that isn't on Pro, isn't connected, or while Slack isn't configured", async () => {
    const slack = fakeSlack();
    const free = await signIn("run-free@example.com");
    await connect(free);
    await addDoc(free, "Free plan certificate", 5);
    await runReminders(undefined, free.orgId);
    expect(await waiting(free.orgId)).toEqual([]);
    // Queued while on Pro, then the plan lapsed: not posted.
    const doc = await addDoc(free, "Lapsed plan certificate", 5);
    await db.root((tx) => tx.query("insert into app.slack_posts (org_id, document_id, body) values ($1, $2, 'x')", [free.orgId, doc]));
    expect(await sendSlackPosts()).toEqual({ sent: 0, failed: 0, held: 0, broken: 0 });

    const unconnected = await signIn("run-unconnected@example.com");
    await pro(unconnected);
    await addDoc(unconnected, "Unconnected certificate", 5);
    await runReminders(undefined, unconnected.orgId);
    expect(await waiting(unconnected.orgId)).toEqual([]);

    const c = await connectedPro("run-unconfigured@example.com");
    await runReminders(undefined, c.ctx.orgId);
    vi.stubEnv("SLACK_CLIENT_ID", "");
    expect(await sendSlackPosts()).toBeNull();
    expect(slack.posts()).toEqual([]);
    expect(c.slack.posts()).toEqual([]);
  });
});

describe("rollback", () => {
  it("0052 goes down with its down file and comes back up with npm run migrate's runner (PGlite)", async () => {
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
        (await pg.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'app' order by 1")).rows.map((r) => r.t);

      const upTo51 = files.filter((f) => f.name <= "0051_waitlist_tally.sql");
      expect(upTo51.at(-1)?.name).toBe("0051_waitlist_tally.sql");
      await migrate(conn, setup, upTo51);
      const before = await shape();
      const upTo52 = files.filter((f) => f.name <= "0052_slack.sql");
      expect(await migrate(conn, setup, upTo52)).toEqual(["0052_slack.sql"]);
      const after = await shape();
      expect(after.filter((t) => !before.includes(t))).toEqual(["slack_connections", "slack_posts", "slack_states_used"]);

      const down = await readFile("supabase/rollback/0052_slack.down.sql", "utf8");
      await pg.transaction(async (t) => {
        await t.exec("set local role shipshape_owner");
        await t.exec(down);
        await t.query("delete from meta.migrations where name = $1", ["0052_slack.sql"]);
      });
      expect(await shape()).toEqual(before);

      expect(await migrate(conn, setup, upTo52)).toEqual(["0052_slack.sql"]);
      expect(await shape()).toEqual(after);
      expect(await migrate(conn, setup, upTo52)).toEqual([]);
    } finally {
      await pg.close();
    }
  });
});
