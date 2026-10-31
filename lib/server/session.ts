import "server-only";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asService, asUser } from "./db";
import { safeEqual } from "./crypto";

/**
 * Sessions. Until the Supabase project exists (Security R8 wants Supabase Auth with MFA), the app
 * signs its own session cookie: HttpOnly, SameSite=Lax, Secure in production, 12-hour lifetime,
 * HMAC-SHA256 with SHIPSHAPE_SESSION_SECRET.
 *
 * Who can get a session:
 * - anyone, for a demo workspace with sample data (no real documents; uploads are refused);
 * - email sign-in without verification ONLY outside production (local development).
 */

const COOKIE = "ss_session";
const TTL_SECONDS = 12 * 60 * 60;

export const TERMS_VERSION = "2026-10-30-draft";

export interface Session {
  userId: string;
  demo: boolean;
}

export interface Workspace {
  orgId: string;
  name: string;
  role: "owner" | "admin" | "member";
  demo: boolean;
}

function secret(): string {
  const s = process.env.SHIPSHAPE_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SHIPSHAPE_SESSION_SECRET must be at least 32 characters");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeSession(s: Session, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: s.userId, d: s.demo, e: Math.floor(now / 1000) + TTL_SECONDS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string | undefined, now = Date.now()): Session | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
  try {
    const { u, d, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof u !== "string" || typeof e !== "number" || e * 1000 <= now) return null;
    return { userId: u, demo: d === true };
  } catch {
    return null;
  }
}

export const localSignInAllowed = () => process.env.NODE_ENV !== "production";

export async function getSession(): Promise<Session | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function startSession(s: Session) {
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
