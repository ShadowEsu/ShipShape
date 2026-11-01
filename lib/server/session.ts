import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TERMS_VERSION } from "@/lib/legal";
import { isTimeZone, todayIn, TZ_COOKIE } from "@/lib/today";
import { asService, asUser } from "./db";
import { safeEqual } from "./crypto";
import { uaFamily } from "./ua";

/**
 * Sessions. The app signs its own session cookie: HttpOnly, SameSite=Lax, Secure in production,
 * 12-hour lifetime, HMAC-SHA256 with SHIPSHAPE_SESSION_SECRET. The cookie names a row in
 * app.sessions (migration 0036), so Settings can list each browser and sign any one of them out.
 *
 * Who can get a session:
 * - anyone, for a demo workspace with sample data (no real documents; uploads are refused);
 * - an account holder, after signing in with Cognito (lib/server/cognito.ts), where it's set up;
 * - email sign-in without verification ONLY outside production (local development).
 */

const COOKIE = "ss_session";
const TTL_SECONDS = 12 * 60 * 60;

export interface Session {
  userId: string;
  demo: boolean;
  /** When the person last proved who they are (seconds since epoch); gates sensitive actions. */
  authAt: number;
}

/** Sensitive actions (revealing a tax id, export, deleting the account) need a sign-in this recent. */
export const RECENT_AUTH_SECONDS = 10 * 60;

export interface Workspace {
  orgId: string;
  name: string;
  role: "owner" | "admin" | "member";
  demo: boolean;
}

/** What this request knows about the person's surroundings. */
export interface Viewer {
  /** The person's calendar date (YYYY-MM-DD) in the zone their browser reported; UTC when unknown. */
  today: string;
}

/** The viewer's date from the time-zone cookie (components/time-zone-cookie.tsx). Junk or no cookie: UTC. */
export async function viewerToday(): Promise<string> {
  const zone = (await cookies()).get(TZ_COOKIE)?.value ?? "UTC";
  return todayIn(isTimeZone(zone) ? zone : "UTC");
}

export function sessionSecret(): string {
  const s = process.env.SHIPSHAPE_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SHIPSHAPE_SESSION_SECRET must be at least 32 characters");
  return s;
}

// Labelled, so no other MAC made with this secret (the sign-in cookie's is `signin:`) can pass as a session (Security CG-4).
const sign = (payload: string) => createHmac("sha256", sessionSecret()).update(`session:${payload}`).digest("base64url");

/**
 * A session as read from its cookie: when it was issued (ms since epoch), which "Sign out on every
 * device" compares against, and the id of its row in app.sessions, which must be live (Design row 34).
 */
export interface IssuedSession extends Session {
  issuedAt: number;
  sessionId: string;
}

/** Any 32 hex digits in uuid form: a session id is 128 random bits, with no version or variant bits set aside. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A new session's id: 128 random bits (Security condition 1), written as a uuid for its row. */
export function newSessionId(): string {
  const h = randomBytes(16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type NewSession = Pick<Session, "userId" | "demo"> & { sessionId: string; authAt?: number };

/** `authAt` defaults to now; account sign-in passes the moment Cognito says the person authenticated. */
export function encodeSession(s: NewSession, now = Date.now()): string {
  const at = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ u: s.userId, d: s.demo, a: s.authAt ?? at, e: at + TTL_SECONDS, i: now, s: s.sessionId })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The session in a cookie, or null: a bad signature, past its 12 hours, or with no session id (cookies made before Design row 34). */
export function decodeSession(value: string | undefined, now = Date.now()): IssuedSession | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
  try {
    const { u, d, a, e, i, s } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof u !== "string" || typeof a !== "number" || typeof e !== "number" || typeof i !== "number" || e * 1000 <= now) return null;
    if (typeof s !== "string" || !SESSION_ID.test(s)) return null;
    return { userId: u, demo: d === true, authAt: a, issuedAt: i, sessionId: s };
  } catch {
    return null;
  }
}

export const authIsRecent = (s: Session, now = Date.now()) => now / 1000 - s.authAt <= RECENT_AUTH_SECONDS;
/** Sensitive actions need a recent sign-in, except in a sample workspace: made-up data, and its visitor has no password to re-enter. */
export const recentEnough = (s: Session, now = Date.now()) => s.demo || authIsRecent(s, now);

export const localSignInAllowed = () => process.env.NODE_ENV !== "production";

export async function getSession(): Promise<IssuedSession | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function startSession(s: NewSession) {
  (await cookies()).set(COOKIE, encodeSession(s), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in person, their workspace, and this browser's session id. */
export type SignedIn = Session & Workspace & Viewer & { sessionId: string };

/**
 * The signed-in user's workspace, or a redirect to sign-in. All in one query (Security E9, and
 * Design row 34's condition 4): the cookie's session row must be this person's, not signed out and
 * not expired; a session issued before the person last chose "Sign out on every device" is refused;
 * and the row's last_seen_at moves to now if it is over 10 minutes old, so most requests write
 * nothing and none waits on a second round trip.
 */
export async function requireWorkspace(): Promise<SignedIn> {
  const session = await getSession();
  if (!session) redirect("/signin");
  const [ws] = await asUser(session.userId, (tx) =>
    tx.query<{ org_id: string; name: string; role: Workspace["role"]; is_demo: boolean }>(
      `with live as (
         select s.id from app.sessions s
         where s.id = $3 and s.user_id = $1 and s.revoked_at is null and s.expires_at > now()
       ), seen as (
         update app.sessions s set last_seen_at = now()
         from live where s.id = live.id and s.last_seen_at < now() - interval '10 minutes'
       )
       select m.org_id, o.name, m.role, o.is_demo from app.members m join app.organizations o on o.id = m.org_id
       where m.user_id = $1
         and exists (select 1 from live)
         and not exists (select 1 from app.session_revocations r where r.user_id = $1 and r.valid_after > to_timestamp($2::double precision / 1000))
       order by m.created_at limit 1`,
      [session.userId, session.issuedAt, session.sessionId],
    ),
  );
  if (!ws) redirect("/signin");
  return {
    userId: session.userId,
    authAt: session.authAt,
    sessionId: session.sessionId,
    orgId: ws.org_id,
    name: ws.name,
    role: ws.role,
    demo: ws.is_demo,
    today: await viewerToday(),
  };
}

/** Ends every session this person has, on every device, this one included (Security E9). */
export async function endAllSessions(userId: string): Promise<void> {
  await asUser(userId, (tx) => tx.query("select app.end_my_sessions()"));
  await endSession();
}

/** A browser this person is signed in on, as Settings lists it. */
export interface LiveSession {
  id: string;
  /** "Safari on a Mac" (lib/server/ua.ts). */
  family: string;
  /** The browser this request came from. */
  current: boolean;
  /** Seconds since the session was last used, to the 10 minutes requireWorkspace notes it in. */
  idleSeconds: number;
}

/** This person's live sessions: this browser first, then the most recently used. */
export async function liveSessions(ctx: Pick<SignedIn, "userId" | "sessionId">): Promise<LiveSession[]> {
  const rows = await asUser(ctx.userId, (tx) =>
    tx.query<{ id: string; ua_family: string; idle: number }>(
      `select s.id, s.ua_family, extract(epoch from now() - s.last_seen_at)::int as idle from app.sessions s
       where s.user_id = $1 and s.revoked_at is null and s.expires_at > now()
       order by s.id = $2 desc, s.last_seen_at desc, s.created_at desc`,
      [ctx.userId, ctx.sessionId],
    ),
  );
  return rows.map((r) => ({ id: r.id, family: r.ua_family, current: r.id === ctx.sessionId, idleSeconds: r.idle }));
}

/**
 * Signs one of this person's browsers out (app.end_session refuses anyone else's). Its cookie, and
 * every copy of it, is refused from the next request. This browser's own cookie goes too.
 */
export async function endOneSession(ctx: Pick<SignedIn, "userId" | "sessionId">, sessionId: string): Promise<void> {
  await asUser(ctx.userId, (tx) => tx.query("select app.end_session($1)", [sessionId]));
  if (sessionId === ctx.sessionId) await endSession();
}

/**
 * Sign out in this browser: its row is marked signed out, so a copy of the cookie stops working too,
 * and the cookie goes. A cookie whose row is already gone (the account was deleted) just goes.
 */
export async function signOutHere(): Promise<void> {
  const session = await getSession();
  if (session) {
    await asUser(session.userId, (tx) => tx.query("select app.end_session(s.id) from app.sessions s where s.id = $1", [session.sessionId]));
  }
  await endSession();
}

/** Deletes sessions that ended over 30 days ago, for everyone (the daily cron). Returns how many. */
export async function purgeSessions(): Promise<number> {
  const [row] = await asService((tx) => tx.query<{ n: number }>("select app.purge_sessions() as n"));
  return row.n;
}

/** Creates the auth user (local mode) and records the Terms and Privacy agreement. */
export async function createLocalUser(email: string | null, demo: boolean): Promise<string> {
  return asService(async (tx) => {
    if (email) {
      const [existing] = await tx.query<{ id: string }>("select id from auth.users where email = $1", [email]);
      if (existing) return existing.id;
    }
    const [row] = await tx.query<{ id: string }>("insert into auth.users (email, is_anonymous) values ($1, $2) returning id", [email, demo]);
    return row.id;
  });
}

/** A new account's workspace, until its owner names it (Settings; the first step on Home). */
export const DEFAULT_WORKSPACE_NAME = "My business";

/**
 * The last step of every sign-in: records the Terms and Privacy agreement, makes sure there's a
 * workspace, makes the session's row (named by the browser's User-Agent, which isn't kept) and
 * starts the session with its id.
 */
export async function finishSignIn(userId: string, { demo, authAt, userAgent }: { demo: boolean; authAt?: number; userAgent?: string | null }) {
  const sessionId = newSessionId();
  await asUser(userId, async (tx) => {
    await tx.query("insert into app.consents (user_id, item, policy_version) values ($1, 'terms_privacy', $2)", [userId, TERMS_VERSION]);
    // Two sign-ins finishing at once must not make two workspaces: the second waits for the first's commit (review #26).
    await tx.query("select pg_advisory_xact_lock(hashtextextended('workspace:' || $1, 0))", [userId]);
    const [has] = await tx.query("select 1 from app.members where user_id = $1", [userId]);
    if (!has) await tx.query("select app.create_workspace($1)", [DEFAULT_WORKSPACE_NAME]);
    await tx.query("select app.start_session($1, $2)", [sessionId, uaFamily(userAgent)]);
  });
  await startSession({ userId, demo, authAt, sessionId });
}
