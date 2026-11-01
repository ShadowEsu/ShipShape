import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdminDeleteUserCommand, CognitoIdentityProviderClient, NotAuthorizedException, UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteAccount, deletionPending, finishDeletions } from "@/lib/server/account";
import { type CallbackParams, type CognitoConfig, cognitoAdmin, cognitoClient, cognitoConfig, completeSignIn, setSignInAdminForTests, startSignIn } from "@/lib/server/cognito";
import { asService, asUser } from "@/lib/server/db";
import { UserError } from "@/lib/server/errors";
import { authIsRecent, decodeSession, encodeSession } from "@/lib/server/session";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";

/** Account sign-in through Cognito (AWS step 4): what the callback accepts, and who it signs in. */

const legal = vi.hoisted(() => ({ version: "" }));
vi.mock("@/lib/legal", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/legal")>();
  legal.version = real.TERMS_VERSION;
  return {
    ...real,
    get TERMS_VERSION() {
      return legal.version;
    },
  };
});

const ENV = {
  COGNITO_DOMAIN: "https://auth.example.test",
  COGNITO_USER_POOL_ID: "us-east-1_Test1",
  COGNITO_CLIENT_ID: "client123",
  COGNITO_CLIENT_SECRET: "client-secret",
  SHIPSHAPE_APP_URL: "https://app.example.test",
};
const CODE = "6f1c9a52-0b7e-4c1d-9a2e-3f4b5c6d7e8f";
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

const keyA = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyB = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (pair: { publicKey: KeyObject }, kid: string) => ({ ...pair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" });

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function mint(claims: Record<string, unknown>, { kid = "a", key = keyA.privateKey, header = { alg: "RS256", kid } }: { kid?: string; key?: KeyObject; header?: Record<string, unknown> } = {}) {
  const signed = `${b64(header)}.${b64(claims)}`;
  return `${signed}.${sign("sha256", Buffer.from(signed), key).toString("base64url")}`;
}

interface Flow {
  cfg?: CognitoConfig;
  sub?: string;
  email?: string;
  /** Changes to the claims Cognito would put in the ID token (undefined removes one). */
  claims?: Record<string, unknown>;
  /** How the fake Cognito turns claims into a token (default: signed with key "a"). */
  token?: (claims: Record<string, unknown>) => string;
  keys?: () => unknown[];
  params?: Partial<CallbackParams>;
  cookie?: (cookie: string) => string | undefined;
  startedAt?: number;
  now?: number;
}

/** One trip through Cognito: startSignIn, a fake Cognito that checks what the real one checks, the callback. */
function signInWith(flow: Flow = {}) {
  const cfg = flow.cfg ?? config;
  const startedAt = flow.startedAt ?? NOW;
  const { cookie, url } = startSignIn(cfg, startedAt);
  const sent = new URL(url).searchParams;
  const calls: string[] = [];
  const t = Math.floor(startedAt / 1000) + 5;
  const fetchFn = async (input: string | URL, init?: RequestInit) => {
    const at = String(input);
    calls.push(at);
    if (at === `${cfg.issuer}/.well-known/jwks.json`) return Response.json({ keys: flow.keys ? flow.keys() : [jwk(keyA, "a")] });
    if (at !== `${ENV.COGNITO_DOMAIN}/oauth2/token` || init?.method !== "POST") return new Response("not found", { status: 404 });
    const body = new URLSearchParams(String(init.body));
    const basic = `Basic ${Buffer.from(`${ENV.COGNITO_CLIENT_ID}:${ENV.COGNITO_CLIENT_SECRET}`).toString("base64")}`;
    const verifier = body.get("code_verifier") ?? "";
    const pkce = createHash("sha256").update(verifier).digest("base64url") === sent.get("code_challenge");
    if (new Headers(init.headers).get("authorization") !== basic || body.get("code") !== CODE || !pkce || body.get("redirect_uri") !== sent.get("redirect_uri")) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    const claims = {
      iss: cfg.issuer,
      aud: cfg.clientId,
      token_use: "id",
      sub: flow.sub ?? randomUUID(),
      email: flow.email ?? `owner-${randomUUID().slice(0, 8)}@example.test`,
      email_verified: true,
      nonce: sent.get("nonce"),
      iat: t,
      auth_time: t,
      exp: t + 3600,
      ...flow.claims,
    };
    return Response.json({ id_token: (flow.token ?? mint)(claims), access_token: "not-used", token_type: "Bearer" });
  };
  const params: CallbackParams = { code: CODE, state: sent.get("state"), error: null, ...flow.params };
  const result = completeSignIn(cfg, params, flow.cookie ? flow.cookie(cookie) : cookie, { now: flow.now ?? startedAt + 10_000, fetchFn });
  return { result, calls, sent, cookie };
}

let db: TestDb;
let config: CognitoConfig;
const users = async () => (await db.root((tx) => tx.query<{ n: number }>("select count(*)::int as n from auth.users")))[0].n;

beforeAll(async () => {
  db = await freshDb();
  const cfg = cognitoConfig(ENV);
  if (!cfg) throw new Error("test config missing");
  config = cfg;
});

describe("settings", () => {
  it("is off with nothing set, refuses a half-set or unsafe setup, and trusts only the pool's own issuer", () => {
    expect(cognitoConfig({})).toBeNull();
    expect(() => cognitoConfig({ ...ENV, COGNITO_CLIENT_SECRET: undefined })).toThrow("needs");
    expect(() => cognitoConfig({ ...ENV, SHIPSHAPE_APP_URL: undefined })).toThrow("needs");
    expect(() => cognitoConfig({ ...ENV, COGNITO_DOMAIN: "http://auth.example.test" })).toThrow("https:// origin");
    expect(() => cognitoConfig({ ...ENV, COGNITO_DOMAIN: "https://auth.example.test/oauth2" })).toThrow("https:// origin");
    expect(() => cognitoConfig({ ...ENV, COGNITO_USER_POOL_ID: "Test1" })).toThrow("must look like");
    expect(() => cognitoConfig({ ...ENV, NODE_ENV: "production", SHIPSHAPE_APP_URL: "http://app.example.test" })).toThrow("https://");
    expect(cognitoConfig({ ...ENV, COGNITO_USER_POOL_ID: "eu-west-2_Ab9" })).toMatchObject({
      issuer: "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Ab9",
      redirectUri: "https://app.example.test/auth/callback",
    });
  });
});

describe("a sign-in", () => {
  it("asks for a fresh password sign-in with PKCE, creates the user once, and keeps the same user on the next sign-in", async () => {
    const sub = randomUUID();
    const first = signInWith({ sub, email: "Owner@Example.test" });
    expect(Object.fromEntries(first.sent)).toMatchObject({
      response_type: "code",
      client_id: "client123",
      redirect_uri: "https://app.example.test/auth/callback",
      scope: "openid email",
      code_challenge_method: "S256",
      prompt: "login",
    });
    const before = await users();
    const { userId, authAt } = await first.result;
    expect(authAt).toBe(Math.floor(NOW / 1000) + 5);
    const [row] = await db.root((tx) => tx.query<{ email: string; is_anonymous: boolean }>("select email, is_anonymous from auth.users where id = $1", [userId]));
    expect(row).toEqual({ email: "owner@example.test", is_anonymous: false });

    const again = await signInWith({ sub, email: "owner@example.test", startedAt: NOW + 3_600_000 }).result;
    expect(again.userId).toBe(userId);
    expect(await users()).toBe(before + 1);
  });

  it("an email that already belongs to another user is refused, not joined to it", async () => {
    const existing = await db.user("taken@example.test");
    const sub = randomUUID();
    await expect(signInWith({ sub, email: "Taken@example.test" }).result).rejects.toMatchObject({ reason: "taken" });
    const linked = await db.root((tx) => tx.query("select 1 from app.identities where subject = $1 or user_id = $2", [sub, existing]));
    expect(linked).toEqual([]);
  });

  it("after the user is deleted, the same Cognito user starts over as a new user", async () => {
    const sub = randomUUID();
    const { userId } = await signInWith({ sub }).result;
    await db.root((tx) => tx.query("delete from auth.users where id = $1", [userId]));
    expect(await db.root((tx) => tx.query("select 1 from app.identities where subject = $1", [sub]))).toEqual([]);
    const next = await signInWith({ sub }).result;
    expect(next.userId).not.toBe(userId);
  });

  // Real Postgres only: PGlite has one connection, so two callbacks never overlap there.
  it.skipIf(!process.env.SHIPSHAPE_PG_TEST_URL)("two callbacks for the same new account at the same moment make one user, not a failed sign-in (review #26)", async () => {
    const sub = randomUUID();
    // Opens the pool's connections first, so the two callbacks really overlap.
    await Promise.all([1, 2, 3].map(() => asService((tx) => tx.query("select pg_sleep(0.1)"))));
    const [a, b] = await Promise.all([signInWith({ sub, email: "race@example.test" }).result, signInWith({ sub, email: "race@example.test" }).result]);
    expect(a.userId).toBe(b.userId);
    expect(await db.root((tx) => tx.query("select 1 from auth.users where email = 'race@example.test'"))).toHaveLength(1);
  });

  it("the session's sign-in time is Cognito's, so an old Cognito sign-in doesn't count as recent", () => {
    const authAt = Math.floor(NOW / 1000) - 11 * 60;
    const session = decodeSession(encodeSession({ userId: randomUUID(), demo: false, authAt, sessionId: randomUUID() }, NOW), NOW);
    expect(session?.authAt).toBe(authAt);
    expect(session && authIsRecent(session, NOW)).toBe(false);
  });
});

describe("the callback refuses", () => {
  const claimCases: [string, Record<string, unknown>][] = [
    ["another issuer", { iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Other" }],
    ["another app client", { aud: "other-client" }],
    ["an access token", { token_use: "access" }],
    ["an expired token", { exp: Math.floor(NOW / 1000) - 1 }],
    ["another sign-in's nonce", { nonce: "replayed-nonce" }],
    ["an unverified email", { email_verified: false }],
    ["no email_verified claim", { email_verified: undefined }],
    ["a Cognito sign-in from before this one (prompt=login ignored)", { auth_time: Math.floor(NOW / 1000) - 3600 }],
    ["a token issued in the future", { iat: Math.floor(NOW / 1000) + 3600 }],
    ["a subject that isn't a Cognito id", { sub: "admin" }],
  ];
  it.each(claimCases)("%s", async (_, claims) => {
    const before = await users();
    await expect(signInWith({ claims }).result).rejects.toMatchObject({ reason: "failed" });
    expect(await users()).toBe(before);
  });

  const tokenCases: [string, (claims: Record<string, unknown>) => string][] = [
    ["a token signed by another key under the pool's key id", (c) => mint(c, { key: keyB.privateKey })],
    ["a changed payload", (c) => {
      const [h, , s] = mint(c).split(".");
      return `${h}.${b64({ ...c, email: "attacker@example.test" })}.${s}`;
    }],
    ["HS256 (the public key used as a secret)", (c) => mint(c, { header: { alg: "HS256", kid: "a" } })],
    ["alg none", (c) => `${b64({ alg: "none", kid: "a" })}.${b64(c)}.`],
    ["a key id the pool doesn't have", (c) => mint(c, { kid: "unknown", key: keyB.privateKey })],
  ];
  it.each(tokenCases)("%s", async (_, token) => {
    const before = await users();
    await expect(signInWith({ token }).result).rejects.toMatchObject({ reason: "failed" });
    expect(await users()).toBe(before);
  });

  it("a callback that doesn't belong to this browser's sign-in", async () => {
    await expect(signInWith({ params: { state: "someone-elses-state" } }).result).rejects.toMatchObject({ reason: "failed" });
    await expect(signInWith({ cookie: () => undefined }).result).rejects.toMatchObject({ reason: "expired" });
    await expect(signInWith({ cookie: (c) => `${c.slice(0, -2)}xx` }).result).rejects.toMatchObject({ reason: "expired" });
    await expect(signInWith({ now: NOW + 11 * 60_000 }).result).rejects.toMatchObject({ reason: "expired" });
    // A session cookie isn't a sign-in cookie, and the other way round.
    const session = encodeSession({ userId: randomUUID(), demo: false, sessionId: randomUUID() }, NOW);
    await expect(signInWith({ cookie: () => session }).result).rejects.toMatchObject({ reason: "expired" });
    expect(decodeSession(signInWith().cookie, NOW)).toBeNull();
  });

  it("Cognito's own errors: cancelled, or failed", async () => {
    await expect(signInWith({ params: { error: "access_denied", code: null } }).result).rejects.toMatchObject({ reason: "cancelled" });
    await expect(signInWith({ params: { error: "server_error\nforged log line", code: null } }).result).rejects.toMatchObject({
      reason: "failed",
      message: "managed login: server_errorforgedlogline",
    });
  });

  it("a code Cognito wouldn't exchange (the wrong verifier or code)", async () => {
    await expect(signInWith({ params: { code: "another-code" } }).result).rejects.toMatchObject({ reason: "failed" });
  });

  it("when the Terms changed while the person was away, so their tick was for the old ones", async () => {
    const current = legal.version;
    const { cookie, sent } = signInWith();
    legal.version = `${current}-next`;
    try {
      await expect(completeSignIn(config, { code: CODE, state: sent.get("state"), error: null }, cookie, { now: NOW + 10_000 })).rejects.toMatchObject({ reason: "terms" });
    } finally {
      legal.version = current;
    }
  });
});

describe("the pool's keys", () => {
  it("a rotated key is fetched, but an unknown key id refetches at most every 5 minutes", async () => {
    const cfg = cognitoConfig({ ...ENV, COGNITO_USER_POOL_ID: "us-east-1_Rotate" });
    if (!cfg) throw new Error("config");
    let published = [jwk(keyA, "a")];
    const keys = () => published;
    const first = signInWith({ cfg, keys });
    await first.result;
    expect(first.calls.filter((c) => c.endsWith("jwks.json"))).toHaveLength(1);

    published = [jwk(keyA, "a"), jwk(keyB, "b")];
    const byB = (c: Record<string, unknown>) => mint(c, { kid: "b", key: keyB.privateKey });
    const soon = signInWith({ cfg, keys, token: byB, startedAt: NOW + 60_000 });
    await expect(soon.result).rejects.toMatchObject({ reason: "failed" });
    expect(soon.calls.filter((c) => c.endsWith("jwks.json"))).toHaveLength(0);

    const later = signInWith({ cfg, keys, token: byB, startedAt: NOW + 6 * 60_000 });
    await later.result;
    expect(later.calls.filter((c) => c.endsWith("jwks.json"))).toHaveLength(1);
  });
});

describe("deleting the account", () => {
  afterEach(() => {
    setSignInAdminForTests(undefined);
    vi.unstubAllEnvs();
  });

  /** A person who signed in through Cognito and made a workspace, signed in just now. */
  async function cognitoOwner() {
    const sub = randomUUID();
    const { userId } = await signInWith({ sub }).result;
    const [org] = await asUser(userId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Cognito Co') as id"));
    return { sub, userId, ctx: { userId, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Cognito Co", role: "owner" as const, today: isoToday() } };
  }
  const exists = async (userId: string) => (await db.root((tx) => tx.query("select 1 from auth.users where id = $1", [userId]))).length === 1;
  const recorded = async (userId: string) => (await db.root((tx) => tx.query("select 1 from app.deletion_requests where user_id = $1", [userId]))).length === 1;

  it("deletes the person's Cognito user while their data is still there, then the data; people without one aren't sent to Cognito", async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const owner = await cognitoOwner();
    const deleted: { sub: string; dataStillThere: boolean }[] = [];
    setSignInAdminForTests({ deleteUser: async (sub) => void deleted.push({ sub, dataStillThere: await exists(owner.userId) }) });
    await deleteAccount(owner.ctx);
    expect(deleted).toEqual([{ sub: owner.sub, dataStillThere: true }]);
    expect(await exists(owner.userId)).toBe(false);

    const plain = await db.user(`plain-${randomUUID().slice(0, 8)}@example.test`);
    const [org] = await asUser(plain, (tx) => tx.query<{ id: string }>("select app.create_workspace('Plain Co') as id"));
    await deleteAccount({ userId: plain, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Plain Co", role: "owner", today: isoToday() });
    expect(deleted).toHaveLength(1);
    expect(await exists(plain)).toBe(false);
  });

  it("if Cognito can't delete the user, nothing is deleted, and trying again finishes", async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const owner = await cognitoOwner();
    let down = true;
    setSignInAdminForTests({
      deleteUser: async () => {
        if (down) throw new Error("Cognito unavailable");
      },
    });
    const error = await deleteAccount(owner.ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserError);
    expect(await exists(owner.userId)).toBe(true);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [owner.ctx.orgId]))).toHaveLength(1);
    down = false;
    await deleteAccount(owner.ctx);
    expect(await exists(owner.userId)).toBe(false);
  });

  it("a Cognito user whose sign-in isn't set up here can't be half-deleted", async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const owner = await cognitoOwner();
    for (const key of Object.keys(ENV)) vi.stubEnv(key, undefined);
    await expect(deleteAccount(owner.ctx)).rejects.toBeInstanceOf(UserError);
    expect(await exists(owner.userId)).toBe(true);
  });

  it("if the data can't be deleted after the Cognito user was, the deletion stays recorded, and pressing Delete again finishes it", async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const owner = await cognitoOwner();
    const pool = new Set<string>([owner.sub]);
    const asked: string[] = [];
    // Like Cognito: deleting a user that's already gone counts as deleted (cognitoAdmin).
    setSignInAdminForTests({ deleteUser: async (sub) => void (asked.push(sub), pool.delete(sub)) });
    await db.root((tx) => tx.query("alter function app.delete_my_account(uuid[]) rename to delete_my_account_unavailable"));
    let error: unknown;
    try {
      error = await deleteAccount(owner.ctx).catch((e: unknown) => e);
    } finally {
      await db.root((tx) => tx.query("alter function app.delete_my_account_unavailable(uuid[]) rename to delete_my_account"));
    }
    expect(error).toBeInstanceOf(UserError);
    expect(pool.has(owner.sub)).toBe(false);
    expect(await exists(owner.userId)).toBe(true);
    expect(await recorded(owner.userId)).toBe(true);
    await deleteAccount(owner.ctx);
    expect(asked).toEqual([owner.sub, owner.sub]);
    expect(await exists(owner.userId)).toBe(false);
    expect(await recorded(owner.userId)).toBe(false);
  });

  it("a deletion that didn't finish is finished by the daily run once it's 15 minutes old, without the person (CG-3)", async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const owner = await cognitoOwner();
    let down = true;
    const asked: string[] = [];
    setSignInAdminForTests({
      deleteUser: async (sub) => {
        if (down) throw new Error("Cognito unavailable");
        asked.push(sub);
      },
    });
    await expect(deleteAccount(owner.ctx)).rejects.toBeInstanceOf(UserError);
    expect(await recorded(owner.userId)).toBe(true);
    // Every app page says so (CG-I1), and a new sign-up with the same email is told why it's refused (CG-I2).
    expect(await deletionPending(owner.userId)).toBe(true);
    const [{ email }] = await db.root((tx) => tx.query<{ email: string }>("select email from auth.users where id = $1", [owner.userId]));
    await expect(signInWith({ sub: randomUUID(), email }).result).rejects.toMatchObject({ reason: "deleting" });
    down = false;
    await finishDeletions(); // under 15 minutes old: possibly still finishing in the person's own request
    expect(await exists(owner.userId)).toBe(true);
    await db.root((tx) => tx.query("update app.deletion_requests set requested_at = now() - interval '16 minutes' where user_id = $1", [owner.userId]));
    await finishDeletions();
    expect(asked).toContain(owner.sub);
    expect(await exists(owner.userId)).toBe(false);
    expect(await recorded(owner.userId)).toBe(false);
    expect(await deletionPending(owner.userId)).toBe(false);
    const fresh = await signInWith({ sub: randomUUID(), email }).result;
    expect(fresh.userId).not.toBe(owner.userId);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [owner.ctx.orgId]))).toHaveLength(0);
  });

  it("one deletion the daily run can't finish doesn't hold up the others; it is counted, logged without who, and finished next time", async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const stuck = await cognitoOwner();
    const fine = await cognitoOwner();
    let refuse: string | null = stuck.sub;
    setSignInAdminForTests({
      deleteUser: async (sub) => {
        if (sub === refuse) throw new Error(`Cognito refused ${sub}`);
      },
    });
    await db.root((tx) =>
      tx.query("insert into app.deletion_requests (user_id, requested_at) values ($1, now() - interval '1 hour'), ($2, now() - interval '1 hour')", [stuck.userId, fine.userId]),
    );
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a.join(" ")));
    expect(await finishDeletions()).toEqual({ finished: 1, failed: 1 });
    expect(await exists(fine.userId)).toBe(false);
    expect(await exists(stuck.userId)).toBe(true);
    expect(await recorded(stuck.userId)).toBe(true);
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(stuck.sub);
    expect(logged[0]).not.toContain(stuck.userId);
    refuse = null;
    expect(await finishDeletions()).toEqual({ finished: 1, failed: 0 });
    expect(await exists(stuck.userId)).toBe(false);
    vi.mocked(console.error).mockRestore();
  });

  describe("through the AWS SDK", () => {
    /** A real Cognito client whose requests are answered here, never sent. */
    function offline(answer: () => never | undefined) {
      const client = new CognitoIdentityProviderClient({ region: "us-east-1", credentials: { accessKeyId: "test", secretAccessKey: "test" } });
      const sent: unknown[] = [];
      client.middlewareStack.add(
        () => async (args) => {
          sent.push(args.input);
          answer();
          return { output: { $metadata: {} }, response: {} };
        },
        { step: "initialize" },
      );
      return { admin: cognitoAdmin(client, "us-east-1_Test1"), sent };
    }

    it("asks for AdminDeleteUser on this pool by sub; a user that's already gone counts as deleted, other refusals don't", async () => {
      const ok = offline(() => undefined);
      await ok.admin.deleteUser("1f2e3d4c-sub");
      expect(ok.sent).toEqual([{ UserPoolId: "us-east-1_Test1", Username: "1f2e3d4c-sub" }]);

      const gone = offline(() => {
        throw new UserNotFoundException({ message: "User does not exist.", $metadata: {} });
      });
      await expect(gone.admin.deleteUser("1f2e3d4c-sub")).resolves.toBeUndefined();

      const denied = offline(() => {
        throw new NotAuthorizedException({ message: "not allowed", $metadata: {} });
      });
      await expect(denied.admin.deleteUser("1f2e3d4c-sub")).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    it("in production, the client reaches AWS's own endpoint only: AWS_ENDPOINT_URL* is refused, a config file's endpoint_url ignored (CG-1)", async () => {
      const production = { NODE_ENV: "production", AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/shipshape-prod-app" };
      expect(() => cognitoClient(config, { ...production, AWS_ROLE_ARN: undefined })).toThrow("needs AWS_ROLE_ARN");
      expect(() => cognitoClient(config, { ...production, AWS_ENDPOINT_URL_COGNITO_IDENTITY_PROVIDER: "https://elsewhere.example" })).toThrow("refuses AWS_ENDPOINT_URL_COGNITO_IDENTITY_PROVIDER");
      const dir = await mkdtemp(path.join(os.tmpdir(), "aws-config-"));
      await writeFile(path.join(dir, "config"), "[default]\nendpoint_url = http://127.0.0.1:9\n");
      vi.stubEnv("AWS_CONFIG_FILE", path.join(dir, "config"));
      vi.stubEnv("AWS_PROFILE", "default");
      try {
        const client = cognitoClient(config, production);
        // Production's client, signing with test keys instead of the OIDC token (there is none here).
        client.config.credentials = async () => ({ accessKeyId: "test", secretAccessKey: "test" });
        let host: string | undefined;
        client.middlewareStack.add(
          (_next, context) => async () => {
            host = context.endpointV2?.url.hostname;
            return { output: { $metadata: {} }, response: {} };
          },
          { step: "build" },
        );
        await client.send(new AdminDeleteUserCommand({ UserPoolId: config.poolId, Username: "1f2e3d4c-sub" }));
        expect(host).toBe("cognito-idp.us-east-1.amazonaws.com");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});
