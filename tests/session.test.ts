import { afterEach, describe, expect, it, vi } from "vitest";
import { sameOrigin } from "@/lib/server/http";
import { decodeSession, encodeSession, localSignInAllowed } from "@/lib/server/session";

const USER = "11111111-1111-4111-8111-111111111111";

describe("session cookie", () => {
  it("round-trips", () => {
    expect(decodeSession(encodeSession({ userId: USER, demo: true }))).toEqual({ userId: USER, demo: true });
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
