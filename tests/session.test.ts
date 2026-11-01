import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asService, asUser } from "@/lib/server/db";
import { sameOrigin } from "@/lib/server/http";
import {
  authIsRecent,
  createLocalUser,
  decodeSession,
  encodeSession,
  endAllSessions,
  endOneSession,
  endSession,
  finishSignIn,
  liveSessions,
  localSignInAllowed,
  newSessionId,
  purgeSessions,
  RECENT_AUTH_SECONDS,
  requireWorkspace,
  sessionSecret,
  signOutHere,
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
const SID = "33333333-3333-4333-8333-333333333333";

describe("session cookie", () => {
  it("round-trips", () => {
    expect(decodeSession(encodeSession({ userId: USER, demo: true, sessionId: SID }))).toEqual({
      userId: USER,
      demo: true,
      authAt: expect.any(Number),
      issuedAt: expect.any(Number),
      sessionId: SID,
    });
  });

  it("refuses a well-signed cookie with no session id, or one that isn't 32 hex digits in uuid form (Design row 34)", () => {
    const signed = (fields: Record<string, unknown>) => {
      const payload = Buffer.from(JSON.stringify({ u: USER, d: false, a: 0, e: 9e9, i: Date.now(), ...fields })).toString("base64url");
      return `${payload}.${createHmac("sha256", sessionSecret()).update(`session:${payload}`).digest("base64url")}`;
    };
    expect(decodeSession(signed({ s: SID }))?.sessionId).toBe(SID);
    expect(decodeSession(signed({}))).toBeNull();
    expect(decodeSession(signed({ s: "" }))).toBeNull();
    expect(decodeSession(signed({ s: "not-a-session" }))).toBeNull();
    expect(decodeSession(signed({ s: 7 }))).toBeNull();
  });

  it("gives each session 128 random bits: no two alike, and no digit set aside for a uuid version (Security condition 1)", () => {
    const ids = Array.from({ length: 64 }, () => newSessionId());
    expect(new Set(ids).size).toBe(64);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // A uuid v4 fixes the first digit of the third group to 4; these vary there like everywhere else.
    expect(new Set(ids.map((id) => id[14])).size).toBeGreaterThan(1);
  });

  it("rejects a changed payload, a changed signature, junk and expiry", () => {
    const value = encodeSession({ userId: USER, demo: false, sessionId: SID });
    const [payload, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "22222222-2222-4222-8222-222222222222", d: false, e: 9e9 })).toString("base64url");
    expect(decodeSession(`${forged}.${mac}`)).toBeNull();
    expect(decodeSession(`${payload}.${mac.slice(0, -2)}xx`)).toBeNull();
    expect(decodeSession("junk")).toBeNull();
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession(value, Date.now() + 13 * 3600 * 1000)).toBeNull();
  });

  it("takes only its own MAC: the same payload MAC'd unlabelled or as a sign-in cookie is refused (CG-4)", () => {
    const [payload] = encodeSession({ userId: USER, demo: false, sessionId: SID }).split(".");
    const mac = (label: string) => createHmac("sha256", sessionSecret()).update(label + payload).digest("base64url");
    expect(decodeSession(`${payload}.${mac("session:")}`)).not.toBeNull();
    expect(decodeSession(`${payload}.${mac("")}`)).toBeNull();
    expect(decodeSession(`${payload}.${mac("signin:")}`)).toBeNull();
  });

  it("refuses a weak or missing secret", () => {
    vi.stubEnv("SHIPSHAPE_SESSION_SECRET", "short");
    expect(() => encodeSession({ userId: USER, demo: false, sessionId: SID })).toThrow(/at least 32/);
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
    const value = encodeSession({ userId: USER, demo: false, sessionId: SID }, issued);
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

// One database for every test below that signs people in.
let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
});
const use = async (value: string) => {
  jar.set("ss_session", { value });
  return requireWorkspace();
};
/** Signs `userId` in as a browser would; returns that browser's cookie and its session id. */
const signInOn = async (userId: string, userAgent?: string) => {
  await finishSignIn(userId, { demo: false, userAgent });
  const cookie = jar.get("ss_session")?.value ?? "";
  return { cookie, id: decodeSession(cookie)?.sessionId ?? "" };
};
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1";

describe("signing in and out", () => {
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
    await startSession({ userId: USER, demo: false, sessionId: SID });
    expect(jar.get("ss_session")?.options).toMatchObject({ secure: true, httpOnly: true });
  });

  it("sends a valid session whose account is gone to sign-in, and a forged one too", async () => {
    await startSession({ userId: USER, demo: false, sessionId: SID }); // signed by us, but no such account
    await expect(requireWorkspace()).rejects.toThrow("redirect /signin");
    jar.set("ss_session", { value: `${Buffer.from(JSON.stringify({ u: USER, a: 0, e: 9e9 })).toString("base64url")}.forged` });
    await expect(requireWorkspace()).rejects.toThrow("redirect /signin");
  });

  it("signing out on every device ends all that person's sessions, copies included, and nobody else's (Security E9)", async () => {
    const me = await createLocalUser("everywhere@example.com", false);
    const someoneElse = await createLocalUser("bystander@example.com", false);
    // A laptop, a phone (and any copy someone took of their cookies), and another person's.
    const laptop = await signInOn(me);
    const phone = await signInOn(me);
    const theirs = await signInOn(someoneElse);
    expect(await use(laptop.cookie)).toMatchObject({ userId: me });

    await endAllSessions(me);
    expect(jar.has("ss_session")).toBe(false);
    await expect(use(laptop.cookie)).rejects.toThrow("redirect /signin");
    await expect(use(phone.cookie)).rejects.toThrow("redirect /signin");
    expect(await use(theirs.cookie)).toMatchObject({ userId: someoneElse });
    expect(await liveSessions({ userId: me, sessionId: laptop.id })).toEqual([]);
    // The watermark refuses an older cookie by itself, whatever its row says.
    await db.root((tx) => tx.query("update app.sessions set revoked_at = null where id = $1", [phone.id]));
    await expect(use(phone.cookie)).rejects.toThrow("redirect /signin");

    // Signing in again afterwards works (issued a second later: the watermark is compared to the millisecond); the old copies stay dead.
    const again = await signInOn(me);
    expect(await use(encodeSession({ userId: me, demo: false, sessionId: again.id }, Date.now() + 1_000))).toMatchObject({ userId: me });
    await expect(use(laptop.cookie)).rejects.toThrow("redirect /signin");
  });
});

describe("where you're signed in (Design row 34)", () => {
  afterEach(() => {
    jar.clear();
  });
  const row = async (id: string) =>
    (
      await db.root((tx) =>
        tx.query<{ user_id: string; ua_family: string; revoked_at: string | null; ttl: number }>(
          "select user_id, ua_family, revoked_at::text as revoked_at, extract(epoch from expires_at - created_at)::int as ttl from app.sessions where id = $1",
          [id],
        ),
      )
    )[0];

  it("each sign-in makes its own row, named by browser and system only, and puts its id in the cookie", async () => {
    const me = await createLocalUser("rows@example.com", false);
    const mac = await signInOn(me, MAC_SAFARI);
    const phone = await signInOn(me, IPHONE_CHROME);
    const unknown = await signInOn(me);
    expect(new Set([mac.id, phone.id, unknown.id]).size).toBe(3);
    expect(await row(mac.id)).toEqual({ user_id: me, ua_family: "Safari on a Mac", revoked_at: null, ttl: 12 * 3600 });
    expect((await row(phone.id)).ua_family).toBe("Chrome on an iPhone");
    expect((await row(unknown.id)).ua_family).toBe("a browser");
    expect((await use(mac.cookie)).sessionId).toBe(mac.id);
    // Nothing of the User-Agent beyond the two names is kept anywhere in the row.
    const [stored] = await db.root((tx) => tx.query<{ text: string }>("select s::text as text from app.sessions s where id = $1", [mac.id]));
    expect(stored.text).not.toMatch(/Mozilla|AppleWebKit|605\.1\.15|10_15_7/);
  });

  it("a browser signed out from Settings is refused on its next request, copies included; the person's other browsers keep working", async () => {
    const me = await createLocalUser("one-browser@example.com", false);
    const laptop = await signInOn(me, MAC_SAFARI);
    const phone = await signInOn(me, IPHONE_CHROME);
    const here = await use(laptop.cookie);

    await endOneSession(here, phone.id);
    expect(jar.get("ss_session")?.value).toBe(laptop.cookie);
    await expect(use(phone.cookie)).rejects.toThrow("redirect /signin");
    expect(await use(laptop.cookie)).toMatchObject({ userId: me });
    expect((await liveSessions(here)).map((s) => s.id)).toEqual([laptop.id]);

    // Signing out this browser's own row signs out here: the cookie goes, and a copy of it is refused.
    await endOneSession(here, laptop.id);
    expect(jar.has("ss_session")).toBe(false);
    await expect(use(laptop.cookie)).rejects.toThrow("redirect /signin");
  });

  it("a cookie whose row is gone or past its 12 hours is refused, however well signed", async () => {
    const me = await createLocalUser("rowless@example.com", false);
    const expired = await signInOn(me);
    const deleted = await signInOn(me);
    expect(await use(expired.cookie)).toMatchObject({ userId: me });
    await db.root((tx) => tx.query("update app.sessions set expires_at = now() - interval '1 second' where id = $1", [expired.id]));
    await expect(use(expired.cookie)).rejects.toThrow("redirect /signin");
    await db.root((tx) => tx.query("delete from app.sessions where id = $1", [deleted.id]));
    await expect(use(deleted.cookie)).rejects.toThrow("redirect /signin");
    // Another person's live row doesn't stand in for a missing one of mine.
    const someoneElse = await signInOn(await createLocalUser("rowless-other@example.com", false));
    await expect(use(encodeSession({ userId: me, demo: false, sessionId: someoneElse.id }))).rejects.toThrow("redirect /signin");
  });

  it("notes when a session was last used at most every 10 minutes, in the request's own query", async () => {
    const me = await createLocalUser("last-seen@example.com", false);
    const { cookie, id } = await signInOn(me);
    const setAge = (minutes: number) => db.root((tx) => tx.query("update app.sessions set last_seen_at = now() - make_interval(mins => $2::int) where id = $1", [id, minutes]));
    const age = async () =>
      (await db.root((tx) => tx.query<{ s: number }>("select extract(epoch from now() - last_seen_at)::int as s from app.sessions where id = $1", [id])))[0].s;

    await setAge(11);
    await use(cookie);
    expect(await age()).toBeLessThan(60);

    await setAge(9);
    await use(cookie);
    expect(await age()).toBeGreaterThanOrEqual(9 * 60);
  });

  it("Sign out in this browser marks its row signed out too, so a copy of the cookie stops working", async () => {
    const me = await createLocalUser("sign-out-here@example.com", false);
    const here = await signInOn(me);
    const elsewhere = await signInOn(me);
    jar.set("ss_session", { value: here.cookie });
    await signOutHere();
    expect(jar.has("ss_session")).toBe(false);
    expect((await row(here.id)).revoked_at).not.toBeNull();
    await expect(use(here.cookie)).rejects.toThrow("redirect /signin");
    expect(await use(elsewhere.cookie)).toMatchObject({ userId: me });

    // A cookie whose account (and so its row) is gone just goes.
    await startSession({ userId: USER, demo: false, sessionId: SID });
    await signOutHere();
    expect(jar.has("ss_session")).toBe(false);
  });

  it("deletes a session's row 30 days after it ended (signed out, or past its 12 hours), and not before", async () => {
    const me = await createLocalUser("purge-sessions@example.com", false);
    const [signedOutLongAgo, signedOutRecently, expiredLongAgo, live] = [await signInOn(me), await signInOn(me), await signInOn(me), await signInOn(me)];
    await db.root(async (tx) => {
      await tx.query("update app.sessions set revoked_at = now() - interval '31 days' where id = $1", [signedOutLongAgo.id]);
      await tx.query("update app.sessions set revoked_at = now() - interval '29 days' where id = $1", [signedOutRecently.id]);
      await tx.query("update app.sessions set expires_at = now() - interval '31 days' where id = $1", [expiredLongAgo.id]);
    });
    expect(await purgeSessions()).toBeGreaterThanOrEqual(2);
    const left = await db.root((tx) => tx.query<{ id: string }>("select id from app.sessions where user_id = $1", [me]));
    expect(left.map((r) => r.id).sort()).toEqual([signedOutRecently.id, live.id].sort());
    await expect(asUser(me, (tx) => tx.query("select app.purge_sessions()"))).rejects.toThrow(/permission denied/);
  });
});
