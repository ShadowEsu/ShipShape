import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asService } from "@/lib/server/db";
import { sameOrigin } from "@/lib/server/http";
import {
  authIsRecent,
  createLocalUser,
  decodeSession,
  encodeSession,
  endAllSessions,
  endSession,
  finishSignIn,
  localSignInAllowed,
  RECENT_AUTH_SECONDS,
  requireWorkspace,
  sessionSecret,
  startSession,
} from "@/lib/server/session";
import { isoToday, todayIn } from "@/lib/today";
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

  it("takes a secret of exactly 32 characters and refuses 31", () => {
    vi.stubEnv("SHIPSHAPE_SESSION_SECRET", "s".repeat(31));
    expect(() => sessionSecret()).toThrow(/at least 32/);
    vi.stubEnv("SHIPSHAPE_SESSION_SECRET", "s".repeat(32));
    expect(sessionSecret()).toBe("s".repeat(32));
    vi.unstubAllEnvs();
  });

  it("lasts 12 hours: still valid the millisecond before, gone at the expiry itself", () => {
    const issued = Date.UTC(2026, 9, 31, 12, 0, 0);
    const value = encodeSession({ userId: USER, demo: false }, issued);
    const expiry = issued + 12 * 3600 * 1000;
    expect(decodeSession(value, expiry - 1)?.userId).toBe(USER);
    expect(decodeSession(value, expiry)).toBeNull();
  });

  it("counts a sign-in as recent for 10 minutes to the second, and not one second more", () => {
    const authAt = 1_800_000_000;
    const s = { userId: USER, demo: false, authAt };
    expect(authIsRecent(s, (authAt + RECENT_AUTH_SECONDS) * 1000)).toBe(true);
    expect(authIsRecent(s, (authAt + RECENT_AUTH_SECONDS + 1) * 1000)).toBe(false);
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

  it("takes the person's date from the time-zone cookie their browser set, and UTC when it is missing or junk", async () => {
    const userId = await createLocalUser("kiritimati@example.com", false);
    await finishSignIn(userId, { demo: false });
    // Kiritimati is UTC+14 and Pago Pago UTC-11: at least one of them is on a different date than UTC.
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      jar.set("ss_tz", { value: zone });
      expect((await requireWorkspace()).today, zone).toBe(todayIn(zone));
    }
    expect([todayIn("Pacific/Kiritimati"), todayIn("Pacific/Pago_Pago")]).not.toEqual([isoToday(), isoToday()]);
    for (const junk of ["Mars/Olympus_Mons", "", "x".repeat(70)]) {
      jar.set("ss_tz", { value: junk });
      expect((await requireWorkspace()).today, junk).toBe(isoToday());
    }
    jar.delete("ss_tz");
    expect((await requireWorkspace()).today).toBe(isoToday());
  });

  // Real Postgres only: PGlite has one connection, so two sign-ins never overlap there.
  it.skipIf(!process.env.SHIPSHAPE_PG_TEST_URL)("two sign-ins finishing at the same moment make one workspace, not two (review #26)", async () => {
    const userId = await createLocalUser("twice@example.com", false);
    await Promise.all([1, 2, 3].map(() => asService((tx) => tx.query("select pg_sleep(0.1)"))));
    await Promise.all([finishSignIn(userId, { demo: false }), finishSignIn(userId, { demo: false })]);
    expect(await rows("select 1 from app.members where user_id = $1", userId)).toBe(1);
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
