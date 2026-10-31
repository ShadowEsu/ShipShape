import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type CallbackParams, type CognitoConfig, cognitoConfig, completeSignIn, startSignIn } from "@/lib/server/cognito";
import { authIsRecent, decodeSession, encodeSession } from "@/lib/server/session";
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

  it("the session's sign-in time is Cognito's, so an old Cognito sign-in doesn't count as recent", () => {
    const authAt = Math.floor(NOW / 1000) - 11 * 60;
    const session = decodeSession(encodeSession({ userId: randomUUID(), demo: false, authAt }, NOW), NOW);
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
    const session = encodeSession({ userId: randomUUID(), demo: false }, NOW);
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
