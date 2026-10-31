import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sameOrigin } from "@/lib/server/http";
import {
  createLocalUser,
  decodeSession,
  encodeSession,
  endAllSessions,
  endSession,
  finishSignIn,
  localSignInAllowed,
  requireWorkspace,
  sessionSecret,
  startSession,
} from "@/lib/server/session";
import { freshDb, type TestDb } from "./support/db";

// The request's cookies, as Next.js would hold them, with the options each was set with.
const jar = vi.hoisted(() => new Map<string, { value: string; options?: Record<string, unknown> }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  }),
}));
// Like Next.js, redirect() never returns.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const USER = "11111111-1111-4111-8111-111111111111";

describe("session cookie", () => {
  it("round-trips", () => {
    expect(decodeSession(encodeSession({ userId: USER, demo: true }))).toEqual({ userId: USER, demo: true, authAt: expect.any(Number), issuedAt: expect.any(Number) });
  });

  it("rejects a changed payload, a changed signature, junk and expiry", () => {
    const value = encodeSession({ userId: USER, demo: false });
    const [payload, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "22222222-2222-4222-8222-222222222222", d: false, e: 9e9 })).toString("base64url");
    expect(decodeSession(`${forged}.${mac}`)).toBeNull();
    expect(decodeSession(`${payload}.${mac.slice(0, -2)}xx`)).toBeNull();
    expect(decodeSession("junk")).toBeNull();
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession(value, Date.now() + 13 * 3600 * 1000)).toBeNull();
  });

  it("takes only its own MAC: the same payload MAC'd unlabelled or as a sign-in cookie is refused (CG-4)", () => {
    const [payload] = encodeSession({ userId: USER, demo: false }).split(".");
    const mac = (label: string) => createHmac("sha256", sessionSecret()).update(label + payload).digest("base64url");
    expect(decodeSession(`${payload}.${mac("session:")}`)).not.toBeNull();
    expect(decodeSession(`${payload}.${mac("")}`)).toBeNull();
    expect(decodeSession(`${payload}.${mac("signin:")}`)).toBeNull();
  });

  it("refuses a weak or missing secret", () => {
    vi.stubEnv("SHIPSHAPE_SESSION_SECRET", "short");
    expect(() => encodeSession({ userId: USER, demo: false })).toThrow(/at least 32/);
    vi.unstubAllEnvs();
  });
});

describe("unverified email sign-in", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is never allowed in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(localSignInAllowed()).toBe(false);
  });
});

describe("same-origin guard (CSRF)", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("accepts a same-site browser post", () => {
    expect(sameOrigin(h({ host: "shipshape.example", origin: "https://shipshape.example", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("refuses foreign, missing and null origins and cross-site fetches", () => {
    expect(sameOrigin(h({ host: "shipshape.example", origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(h({ host: "shipshape.example" }))).toBe(false);
    expect(sameOrigin(h({ host: "shipshape.example", origin: "null" }))).toBe(false);
    expect(sameOrigin(h({ host: "shipshape.example", origin: "https://shipshape.example", "sec-fetch-site": "cross-site" }))).toBe(false);
  });
});

describe("signing in and out", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterEach(() => {
    jar.clear();
    vi.unstubAllEnvs();
  });
  const rows = async (sql: string, userId: string) => (await db.root((tx) => tx.query(sql, [userId]))).length;

  it("records the agreement each time, makes one workspace, and keeps the session in a cookie scripts can't read", async () => {
    const userId = await createLocalUser("owner@example.com", false);
    expect(await createLocalUser("owner@example.com", false)).toBe(userId);

    await finishSignIn(userId, { demo: false });
    expect(jar.get("ss_session")?.options).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 });
    expect(await requireWorkspace()).toMatchObject({ userId, demo: false, name: "My business", role: "owner", orgId: expect.any(String) });

    await finishSignIn(userId, { demo: false });
    expect(await rows("select 1 from app.members where user_id = $1", userId)).toBe(1);
    expect(await rows("select 1 from app.consents where user_id = $1 and item = 'terms_privacy'", userId)).toBe(2);

    await endSession();
    expect(jar.has("ss_session")).toBe(false);
    await expect(requireWorkspace()).rejects.toThrow("redirect /signin");
  });

  it("sends the cookie only over HTTPS in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await startSession({ userId: USER, demo: false });
    expect(jar.get("ss_session")?.options).toMatchObject({ secure: true, httpOnly: true });
  });

  it("sends a valid session whose account is gone to sign-in, and a forged one too", async () => {
    await startSession({ userId: USER, demo: false }); // signed by us, but no such account
    await expect(requireWorkspace()).rejects.toThrow("redirect /signin");
    jar.set("ss_session", { value: `${Buffer.from(JSON.stringify({ u: USER, a: 0, e: 9e9 })).toString("base64url")}.forged` });
    await expect(requireWorkspace()).rejects.toThrow("redirect /signin");
  });

  it("signing out on every device ends that person's earlier sessions, copies included, and nobody else's (Security E9)", async () => {
    const use = async (value: string) => {
      jar.set("ss_session", { value });
      return requireWorkspace();
    };
    const me = await createLocalUser("everywhere@example.com", false);
    const someoneElse = await createLocalUser("bystander@example.com", false);
    await finishSignIn(me, { demo: false });
    await finishSignIn(someoneElse, { demo: false });
    // Sessions issued a minute ago: a laptop, a phone, and a copy someone took; and another person's.
    const earlier = Date.now() - 60_000;
    const laptop = encodeSession({ userId: me, demo: false }, earlier);
    const phone = encodeSession({ userId: me, demo: false }, earlier + 1);
    const theirs = encodeSession({ userId: someoneElse, demo: false }, earlier);
    expect(await use(laptop)).toMatchObject({ userId: me });

    await endAllSessions(me);
    expect(jar.has("ss_session")).toBe(false);
    await expect(use(laptop)).rejects.toThrow("redirect /signin");
    await expect(use(phone)).rejects.toThrow("redirect /signin");
    expect(await use(theirs)).toMatchObject({ userId: someoneElse });

    // Signing in again afterwards works; the old copies stay dead.
    expect(await use(encodeSession({ userId: me, demo: false }, Date.now() + 1_000))).toMatchObject({ userId: me });
    await expect(use(laptop)).rejects.toThrow("redirect /signin");
  });
});
