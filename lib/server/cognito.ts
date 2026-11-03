import "server-only";
import { createHash, createHmac, createPublicKey, randomBytes, verify, type KeyObject } from "node:crypto";
import { AdminDeleteUserCommand, CognitoIdentityProviderClient, UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";
import { z } from "zod";
import { TERMS_VERSION } from "@/lib/legal";
import type { ReturnTo } from "@/lib/return-to";
import { productionAwsClient } from "./aws";
import { safeEqual } from "./crypto";
import { asService } from "./db";
import { sessionSecret } from "./session";

/**
 * Account sign-in through Amazon Cognito (AWS step 4, aws-plan.md): the OAuth 2.0 authorization
 * code grant with PKCE against the user pool's managed login; after it, the app's own session
 * cookie takes over (lib/server/session.ts).
 *
 * - The browser leaves with a random state, PKCE verifier and nonce kept in a 10-minute signed
 *   cookie (HttpOnly, only sent to /auth/callback). The callback refuses anything that doesn't match.
 * - The code is exchanged server to server with the app client's secret. The ID token is verified
 *   here: RS256 with a key from this pool's JWKS, issuer, audience, token_use, expiry, nonce, a
 *   verified email, and an authentication that happened during this sign-in (prompt=login).
 * - Its `sub` maps to one auth.users row (app.identities). The session's authAt is Cognito's
 *   auth_time, so the recent-sign-in gate measures a real sign-in.
 * The issuer and JWKS address come from the pool id alone; nothing overrides them (tests pass fetch).
 */

type Env = Record<string, string | undefined>;
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CognitoConfig {
  /** Managed login's origin, e.g. https://auth.example.com */
  domain: string;
  clientId: string;
  clientSecret: string;
  /** https://cognito-idp.<region>.amazonaws.com/<pool id>: the only issuer accepted. */
  issuer: string;
  /** <SHIPSHAPE_APP_URL>/auth/callback, registered on the app client exactly. */
  redirectUri: string;
  region: string;
  poolId: string;
}

export const CALLBACK_PATH = "/auth/callback";
export const SIGN_IN_COOKIE = "ss_signin";
export const SIGN_IN_SECONDS = 10 * 60;
const SKEW_SECONDS = 60;
const POOL_ID = /^([a-z]{2}(?:-[a-z]+)+-\d+)_[A-Za-z0-9]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Account sign-in's settings, or null where it isn't set up (the sign-in page then offers the sample only). */
export function cognitoConfig(env: Env): CognitoConfig | null {
  const { COGNITO_DOMAIN: domain, COGNITO_USER_POOL_ID: pool, COGNITO_CLIENT_ID: clientId, COGNITO_CLIENT_SECRET: clientSecret } = env;
  if (!domain && !pool && !clientId && !clientSecret) return null;
  const appUrl = env.SHIPSHAPE_APP_URL;
  if (!domain || !pool || !clientId || !clientSecret || !appUrl) {
    throw new Error("Account sign-in needs COGNITO_DOMAIN, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET and SHIPSHAPE_APP_URL");
  }
  const region = POOL_ID.exec(pool)?.[1];
  if (!region) throw new Error("COGNITO_USER_POOL_ID must look like us-east-1_AbC123");
  const login = new URL(domain);
  if (login.protocol !== "https:" || login.pathname !== "/" || login.search || login.hash || login.username || login.password) {
    throw new Error("COGNITO_DOMAIN must be an https:// origin");
  }
  const app = new URL(appUrl);
  if (env.NODE_ENV === "production" && app.protocol !== "https:") throw new Error("SHIPSHAPE_APP_URL must be https:// in production");
  return { domain: login.origin, clientId, clientSecret, issuer: `https://cognito-idp.${region}.amazonaws.com/${pool}`, redirectUri: `${app.origin}${CALLBACK_PATH}`, region, poolId: pool };
}

/** Why a sign-in didn't finish; the sign-in page shows a fixed message for each. */
export type SignInProblem = "expired" | "cancelled" | "failed" | "terms" | "taken" | "deleting" | "busy";

export class SignInFailed extends Error {
  readonly reason: SignInProblem;
  constructor(reason: SignInProblem, detail?: string) {
    super(detail ?? reason);
    this.reason = reason;
  }
}

// The sign-in cookie --------------------------------------------------------------------------------

// `r`: where to land after the sign-in (an allow-listed choice, lib/return-to.ts); absent means Home.
const Txn = z.object({ s: z.string(), v: z.string(), n: z.string(), t: z.string(), c: z.number().int(), r: z.enum(["export", "delete", "ein", "history"]).optional() });
type SignInTxn = z.infer<typeof Txn>;

const random = () => randomBytes(32).toString("base64url");
// A label of its own, so this cookie can never pass as a session cookie (same secret, different MAC input).
const macOf = (payload: string) => createHmac("sha256", sessionSecret()).update(`signin:${payload}`).digest("base64url");

/** Where to send the browser, and the cookie that must come back with it. */
export function startSignIn(cfg: CognitoConfig, { now = Date.now(), returnTo = null }: { now?: number; returnTo?: ReturnTo | null } = {}): { cookie: string; url: string } {
  const txn: SignInTxn = { s: random(), v: random(), n: random(), t: TERMS_VERSION, c: Math.floor(now / 1000), ...(returnTo ? { r: returnTo } : {}) };
  const payload = Buffer.from(JSON.stringify(txn)).toString("base64url");
  const url = new URL("/oauth2/authorize", cfg.domain);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid email",
    state: txn.s,
    nonce: txn.n,
    code_challenge: createHash("sha256").update(txn.v).digest("base64url"),
    code_challenge_method: "S256",
    // Always ask for the password (and MFA), even inside an existing Cognito session.
    prompt: "login",
  }).toString();
  return { cookie: `${payload}.${macOf(payload)}`, url: url.toString() };
}

function openSignIn(value: string | undefined, now: number): SignInTxn | null {
  if (!value) return null;
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra !== undefined || !safeEqual(mac, macOf(payload))) return null;
  const txn = Txn.safeParse(parseJson(payload));
  if (!txn.success) return null;
  const age = now / 1000 - txn.data.c;
  return age >= -SKEW_SECONDS && age <= SIGN_IN_SECONDS ? txn.data : null;
}

function parseJson(base64url: string): unknown {
  try {
    return JSON.parse(Buffer.from(base64url, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// The callback ---------------------------------------------------------------------------------------

export interface CallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
}

interface Deps {
  now?: number;
  fetchFn?: Fetch;
}

/** Checks everything the callback brought back; returns the ShipShape user and when they authenticated. */
export async function completeSignIn(
  cfg: CognitoConfig,
  params: CallbackParams,
  cookie: string | undefined,
  { now = Date.now(), fetchFn = fetch }: Deps = {},
): Promise<{ userId: string; authAt: number; returnTo: ReturnTo | null }> {
  const txn = openSignIn(cookie, now);
  if (!txn) throw new SignInFailed("expired", "no valid sign-in cookie");
  if (!params.state || !safeEqual(params.state, txn.s)) throw new SignInFailed("failed", "state doesn't match");
  if (params.error) {
    // OAuth error codes are lowercase words; nothing else from the address reaches the log.
    throw new SignInFailed(params.error === "access_denied" ? "cancelled" : "failed", `managed login: ${params.error.replace(/[^a-z_]/g, "").slice(0, 40)}`);
  }
  if (!params.code || params.code.length > 512) throw new SignInFailed("failed", "no code");
  // The box ticked before leaving was for these Terms; if they changed meanwhile, ask again.
  if (txn.t !== TERMS_VERSION) throw new SignInFailed("terms");
  const idToken = await exchangeCode(cfg, params.code, txn.v, fetchFn);
  const id = await verifyIdToken(cfg, idToken, { nonce: txn.n, authenticatedSince: txn.c - SKEW_SECONDS, now, fetchFn });
  return { userId: await userForIdentity(id), authAt: id.authTime, returnTo: txn.r ?? null };
}

const TokenResponse = z.object({ id_token: z.string().min(1).max(16_384) });

async function exchangeCode(cfg: CognitoConfig, code: string, verifier: string, fetchFn: Fetch): Promise<string> {
  const basic = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64");
  const res = await fetchFn(new URL("/oauth2/token", cfg.domain), {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: cfg.clientId, code, redirect_uri: cfg.redirectUri, code_verifier: verifier }),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new SignInFailed("failed", `token endpoint answered ${res.status}`);
  const body = TokenResponse.safeParse(await res.json().catch(() => null));
  if (!body.success) throw new SignInFailed("failed", "token endpoint sent no ID token");
  return body.data.id_token;
}

// The ID token -----------------------------------------------------------------------------------------

const Jwk = z.object({ kid: z.string(), kty: z.literal("RSA"), n: z.string(), e: z.string(), alg: z.string().optional(), use: z.string().optional() });
const Jwks = z.object({ keys: z.array(z.unknown()).max(20) });
const JWKS_REFRESH_MS = 5 * 60_000;
const jwks = new Map<string, { keys: Map<string, KeyObject>; at: number }>();

/** The pool's key with this id. An unknown id refetches the set (keys rotate), at most every 5 minutes. */
async function signingKey(issuer: string, kid: string, now: number, fetchFn: Fetch): Promise<KeyObject | null> {
  const cached = jwks.get(issuer);
  const known = cached?.keys.get(kid);
  if (known) return known;
  if (cached && now - cached.at < JWKS_REFRESH_MS) return null;
  const res = await fetchFn(`${issuer}/.well-known/jwks.json`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new SignInFailed("failed", `JWKS answered ${res.status}`);
  const set = Jwks.safeParse(await res.json().catch(() => null));
  if (!set.success) throw new SignInFailed("failed", "JWKS unreadable");
  const keys = new Map<string, KeyObject>();
  for (const entry of set.data.keys) {
    const jwk = Jwk.safeParse(entry);
    if (!jwk.success || (jwk.data.alg ?? "RS256") !== "RS256" || (jwk.data.use ?? "sig") !== "sig") continue;
    const key = createPublicKey({ key: { kty: "RSA", n: jwk.data.n, e: jwk.data.e }, format: "jwk" });
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048) keys.set(jwk.data.kid, key);
  }
  jwks.set(issuer, { keys, at: now });
  return keys.get(kid) ?? null;
}

const Header = z.object({ alg: z.literal("RS256"), kid: z.string().min(1).max(200) });
const Claims = z.object({
  iss: z.string(),
  aud: z.string(),
  token_use: z.string(),
  sub: z.string(),
  exp: z.number(),
  iat: z.number(),
  auth_time: z.number(),
  nonce: z.string(),
  email: z.email().max(254),
  email_verified: z.literal(true),
});
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export interface VerifiedIdentity {
  sub: string;
  email: string;
  /** When the person authenticated (seconds since epoch). */
  authTime: number;
}

export async function verifyIdToken(
  cfg: CognitoConfig,
  token: string,
  { nonce, authenticatedSince, now, fetchFn }: { nonce: string; authenticatedSince: number; now: number; fetchFn: Fetch },
): Promise<VerifiedIdentity> {
  const refuse = (why: string) => new SignInFailed("failed", `ID token refused: ${why}`);
  const [h, p, s, extra] = token.split(".");
  if (!h || !p || !s || extra !== undefined || ![h, p, s].every((part) => SEGMENT.test(part))) throw refuse("malformed");
  const header = Header.safeParse(parseJson(h));
  if (!header.success) throw refuse("header (RS256 only)");
  const key = await signingKey(cfg.issuer, header.data.kid, now, fetchFn);
  if (!key) throw refuse("unknown key");
  if (!verify("sha256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"))) throw refuse("signature");
  const parsed = Claims.safeParse(parseJson(p));
  if (!parsed.success) throw refuse("claims missing, or email not verified");
  const c = parsed.data;
  const t = now / 1000;
  if (c.iss !== cfg.issuer) throw refuse("issuer");
  if (c.aud !== cfg.clientId) throw refuse("audience");
  if (c.token_use !== "id") throw refuse("not an ID token");
  if (c.exp <= t) throw refuse("expired");
  if (c.iat > t + SKEW_SECONDS || c.auth_time > t + SKEW_SECONDS) throw refuse("issued in the future");
  if (c.auth_time < authenticatedSince) throw refuse("no fresh sign-in");
  if (!safeEqual(c.nonce, nonce)) throw refuse("nonce");
  if (!UUID.test(c.sub)) throw refuse("subject");
  return { sub: c.sub, email: c.email.trim().toLowerCase(), authTime: Math.floor(c.auth_time) };
}

// The ShipShape user ------------------------------------------------------------------------------------

/**
 * The user this Cognito identity signs in as; the first sign-in creates it. An email that already
 * belongs to a user without this identity is refused rather than joined to it.
 */
export async function userForIdentity(id: Pick<VerifiedIdentity, "sub" | "email">): Promise<string> {
  return asService(async (tx) => {
    // Two callbacks for the same new account at once: the second waits here and then finds the user (review #26).
    await tx.query("select pg_advisory_xact_lock(hashtextextended('signin:' || $1, 0))", [id.sub]);
    const [known] = await tx.query<{ user_id: string }>("select user_id from app.identities where provider = 'cognito' and subject = $1", [id.sub]);
    if (known) return known.user_id;
    const [taken] = await tx.query<{ deleting: boolean }>(
      "select exists (select 1 from app.deletion_requests r where r.user_id = u.id) as deleting from auth.users u where u.email = $1",
      [id.email],
    );
    // An account with this email that is still being deleted gets its own message (Security CG-I2).
    if (taken) throw new SignInFailed(taken.deleting ? "deleting" : "taken");
    const [user] = await tx.query<{ id: string }>("insert into auth.users (email, is_anonymous) values ($1, false) returning id", [id.email]);
    await tx.query("insert into app.identities (provider, subject, user_id) values ('cognito', $1, $2)", [id.sub, user.id]);
    return user.id;
  });
}

// Deleting the Cognito user ---------------------------------------------------------------------------

/** What account deletion needs from Cognito. */
export interface SignInAdmin {
  /** Deletes the pool's user with this sub; a user that's already gone counts as deleted. */
  deleteUser(sub: string): Promise<void>;
}

/** AdminDeleteUser on `poolId` through `client` (with a pool that signs in by email, the username is the sub). */
export function cognitoAdmin(client: CognitoIdentityProviderClient, poolId: string): SignInAdmin {
  return {
    async deleteUser(sub) {
      try {
        await client.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: sub }));
      } catch (e) {
        if (!(e instanceof UserNotFoundException)) throw e;
      }
    },
  };
}

let admin: SignInAdmin | undefined;

/** Tests stand in for Cognito. */
export function setSignInAdminForTests(a: SignInAdmin | undefined) {
  admin = a;
}

/**
 * The Cognito client account deletion uses. Production signs with credentials for AWS_ROLE_ARN from
 * Vercel's OIDC token (the role allows AdminDeleteUser on this pool only; aws-plan.md) and reaches
 * AWS's own endpoint only (productionAwsClient, Security CG-1).
 */
export function cognitoClient(cfg: CognitoConfig, env: Env): CognitoIdentityProviderClient {
  if (env.NODE_ENV === "production") return new CognitoIdentityProviderClient({ region: cfg.region, ...productionAwsClient(env, "Deleting Cognito users") });
  return new CognitoIdentityProviderClient({ region: cfg.region });
}

function signInAdmin(cfg: CognitoConfig, env: Env): SignInAdmin {
  admin ??= cognitoAdmin(cognitoClient(cfg, env), cfg.poolId);
  return admin;
}

/**
 * Account deletion's step before the rows: the person's Cognito user, so they can't sign back in to
 * an account whose data is gone. True if there was one (it's gone now); users without a Cognito
 * identity (sample workspaces) have none.
 */
export async function deleteSignIn(userId: string): Promise<boolean> {
  const [identity] = await asService((tx) => tx.query<{ subject: string }>("select subject from app.identities where provider = 'cognito' and user_id = $1", [userId]));
  if (!identity) return false;
  const cfg = cognitoConfig(process.env);
  if (!cfg) throw new Error("This account signs in with Cognito, which isn't set up here");
  await signInAdmin(cfg, process.env).deleteUser(identity.subject);
  return true;
}

/**
 * How a person signs in, for the Settings card (Design row 35). An account with a Cognito identity signs in
 * with a password and an authenticator app: the pool is built with `MfaConfiguration: ON` and TOTP as the
 * only method (infra/signin.yaml), so there is no per-account switch to read or to offer. Local accounts
 * (development, tests) have no second step.
 */
export async function signInMethod(userId: string): Promise<"cognito" | "local"> {
  const [identity] = await asService((tx) => tx.query<{ subject: string }>("select subject from app.identities where provider = 'cognito' and user_id = $1", [userId]));
  return identity ? "cognito" : "local";
}
