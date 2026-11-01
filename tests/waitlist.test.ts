import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/waitlist/route";
import { freshDb, type TestDb } from "./support/db";

let db: TestDb;
let ip = 0;

beforeAll(async () => {
  db = await freshDb();
});

const join = (body: unknown) =>
  POST(
    new Request("http://shipshape.test/api/waitlist", {
      method: "POST",
      headers: { origin: "http://shipshape.test", host: "shipshape.test", "sec-fetch-site": "same-origin", "x-forwarded-for": `198.51.100.${++ip}` },
      body: JSON.stringify(body),
    }),
  );

const row = async (email: string) =>
  (await db.root((tx) => tx.query<{ interests: string[] }>("select interests from app.waitlist where email = $1", [email])))[0];

describe("waitlist", () => {
  it("records interest in Collect, and a later plain sign-up keeps it", async () => {
    expect((await join({ email: "Owner@Example.com", interest: "collect" })).status).toBe(200);
    expect(await row("owner@example.com")).toEqual({ interests: ["collect"] });
    expect((await join({ email: "owner@example.com" })).status).toBe(200);
    expect(await row("owner@example.com")).toEqual({ interests: ["collect"] });

    expect((await join({ email: "later@example.com" })).status).toBe(200);
    expect((await join({ email: "later@example.com", interest: "collect" })).status).toBe(200);
    expect(await row("later@example.com")).toEqual({ interests: ["collect"] });
  });

  it("refuses an interest it doesn't know, and stores nothing", async () => {
    expect((await join({ email: "x@example.com", interest: "crypto" })).status).toBe(400);
    expect(await row("x@example.com")).toBeUndefined();
  });

  it("an address that isn't one: says how one looks", async () => {
    const res = await join({ email: "owner at harbor" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter your email address, like you@business.com." });
  });

  it("too many sign-ups from one network: says what happened and when to try again", async () => {
    const from = (email: string) =>
      POST(
        new Request("http://shipshape.test/api/waitlist", {
          method: "POST",
          headers: { origin: "http://shipshape.test", host: "shipshape.test", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ email }),
        }),
      );
    for (let i = 0; i < 10; i++) expect((await from(`busy${i}@example.com`)).status).toBe(200);
    const res = await from("busy10@example.com");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many tries from this network. Wait up to an hour, then try again." });
  });
});
