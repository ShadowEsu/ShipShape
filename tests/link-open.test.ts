import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as openCollect } from "@/app/c/[id]/open/route";
import { POST as openPassport } from "@/app/p/[id]/open/route";
import { POST as openSign } from "@/app/s/[id]/open/route";
import { freshDb } from "./support/db";

/**
 * Passport, signing and upload links hand their token over once, from the URL fragment, and get it
 * back as a cookie (Security E1). That cookie is the link's whole secret, so what it may carry and
 * where it goes is tested on the real routes.
 */

const ID = "0d9c1a52-6d3e-4f6a-9a51-2b7c8e1f4a30";
const TOKEN = "t".repeat(43); // the length and alphabet of a real token (43 base64url characters)
let ip = 0;

beforeAll(async () => {
  await freshDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function open(
  handler: typeof openPassport,
  base: string,
  { id = ID, token = TOKEN as unknown, headers = {} as Record<string, string>, from = `203.0.113.${++ip}` } = {},
) {
  return handler(
    new Request(`http://shipshape.test/${base}/${id}/open`, {
      method: "POST",
      headers: { origin: "http://shipshape.test", host: "shipshape.test", "sec-fetch-site": "same-origin", "x-forwarded-for": from, ...headers },
      body: JSON.stringify({ token }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("opening a shared link", () => {
  it.each([
    ["p", openPassport, "ss_passport"],
    ["s", openSign, "ss_sign"],
    ["c", openCollect, "ss_collect"],
  ] as const)("/%s: the token comes back as an HttpOnly, SameSite=Strict cookie for that one link, for 30 minutes", async (base, handler, cookie) => {
    const res = await open(handler, base);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual([`${cookie}=${TOKEN}; Path=/${base}/${ID}; Max-Age=1800; HttpOnly; SameSite=Strict`]);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await open(openPassport, "p")).headers.getSetCookie()).toEqual([`ss_passport=${TOKEN}; Path=/p/${ID}; Max-Age=1800; HttpOnly; SameSite=Strict; Secure`]);
  });

  it("refuses another site's page (403), and sets nothing", async () => {
    const foreign: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { origin: "https://elsewhere.example" }, { origin: "" }];
    for (const headers of foreign) {
      const res = await open(openPassport, "p", { headers });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("answers 404 and sets nothing for a malformed link id or token, including one that tries to add cookie attributes", async () => {
    for (const bad of [
      { id: "not-a-uuid" },
      { token: TOKEN.slice(1) },
      { token: `${TOKEN.slice(0, 30)}; Domain=x` },
      { token: `${TOKEN}; Path=/` },
      { token: 42 },
    ]) {
      const res = await open(openPassport, "p", bad);
      expect(res.status).toBe(404);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("allows 30 opens per address in ten minutes; the next is refused (429), another address still opens", async () => {
    const from = "192.0.2.77";
    for (let i = 0; i < 30; i++) expect((await open(openSign, "s", { from })).status).toBe(200);
    const refused = await open(openSign, "s", { from });
    expect(refused.status).toBe(429);
    expect(refused.headers.getSetCookie()).toEqual([]);
    expect((await open(openSign, "s", { from: "192.0.2.78" })).status).toBe(200);
  });
});
