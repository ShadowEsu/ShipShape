import "server-only";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TERMS_VERSION } from "@/lib/legal";
import { asService, asUser } from "./db";
import { safeEqual } from "./crypto";

/**
 * Sessions. The app signs its own session cookie: HttpOnly, SameSite=Lax, Secure in production,
 * 12-hour lifetime, HMAC-SHA256 with SHIPSHAPE_SESSION_SECRET.
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

export function sessionSecret(): string {
  const s = process.env.SHIPSHAPE_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SHIPSHAPE_SESSION_SECRET must be at least 32 characters");
  return s;
}

// Labelled, so no other MAC made with this secret (the sign-in cookie's is `signin:`) can pass as a session (Security CG-4).
const sign = (payload: string) => createHmac("sha256", sessionSecret()).update(`session:${payload}`).digest("base64url");

/** `authAt` defaults to now; account sign-in passes the moment Cognito says the person authenticated. */
export function encodeSession(s: Pick<Session, "userId" | "demo"> & { authAt?: number }, now = Date.now()): string {
  const at = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ u: s.userId, d: s.demo, a: s.authAt ?? at, e: at + TTL_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined, now = Date.now()): Session | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
  try {
    const { u, d, a, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof u !== "string" || typeof a !== "number" || typeof e !== "number" || e * 1000 <= now) return null;
    return { userId: u, demo: d === true, authAt: a };
  } catch {
    return null;
  }
}

export const authIsRecent = (s: Session, now = Date.now()) => now / 1000 - s.authAt <= RECENT_AUTH_SECONDS;

export const localSignInAllowed = () => process.env.NODE_ENV !== "production";

export async function getSession(): Promise<Session | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function startSession(s: Pick<Session, "userId" | "demo"> & { authAt?: number }) {
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

/** The signed-in user's workspace, or a redirect to sign-in. */
export async function requireWorkspace(): Promise<Session & Workspace> {
  const session = await getSession();
  if (!session) redirect("/signin");
  const [ws] = await asUser(session.userId, (tx) =>
    tx.query<{ org_id: string; name: string; role: Workspace["role"]; is_demo: boolean }>(
      "select m.org_id, o.name, m.role, o.is_demo from app.members m join app.organizations o on o.id = m.org_id where m.user_id = $1 order by m.created_at limit 1",
      [session.userId],
    ),
  );
  if (!ws) redirect("/signin");
  return { ...session, orgId: ws.org_id, name: ws.name, role: ws.role, demo: ws.is_demo };
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

/** The last step of every sign-in: records the Terms and Privacy agreement, makes sure there's a workspace, starts the session. */
export async function finishSignIn(userId: string, { demo, authAt }: { demo: boolean; authAt?: number }) {
  await asUser(userId, async (tx) => {
    await tx.query("insert into app.consents (user_id, item, policy_version) values ($1, 'terms_privacy', $2)", [userId, TERMS_VERSION]);
    const [has] = await tx.query("select 1 from app.members where user_id = $1", [userId]);
    if (!has) await tx.query("select app.create_workspace('My business')");
  });
  await startSession({ userId, demo, authAt });
}
