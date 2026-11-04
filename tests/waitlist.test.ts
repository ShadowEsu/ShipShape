import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/waitlist/route";
import { encodeSession, newSessionId } from "@/lib/server/session";
import { freshDb, type TestDb } from "./support/db";

let db: TestDb;
let ip = 0;

beforeAll(async () => {
  db = await freshDb();
});

const join = (body: unknown, cookie?: string) =>
  POST(
    new Request("http://shipshape.test/api/waitlist", {
      method: "POST",
      headers: {
        origin: "http://shipshape.test",
        host: "shipshape.test",
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": `198.51.100.${++ip}`,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

/** Every new sign-up counted for a source so far (0051), over all days. */
const counted = async (source: "site" | "sample") =>
  Number(
    (await db.root((tx) => tx.query<{ n: string }>("select coalesce(sum(joined), 0)::text as n from app.waitlist_tally where source = $1", [source])))[0].n,
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

describe("the sample-to-waitlist tally (ledger 461, spot 2b)", () => {
  it("counts each new address once: sample only from a form inside a sample, with that sample's session", async () => {
    const before = [await counted("site"), await counted("sample")];
    const sample = encodeSession({ userId: crypto.randomUUID(), demo: true, sessionId: newSessionId() });
    const real = encodeSession({ userId: crypto.randomUUID(), demo: false, sessionId: newSessionId() });
    expect((await join({ email: "tally-site@example.com" })).status).toBe(200);
    expect((await join({ email: "tally-sample@example.com", from: "sample" }, `theme=calm; ss_session=${sample}`)).status).toBe(200);
    // The site's own form, in a browser with a sample open in another tab: the site's.
    expect((await join({ email: "tally-site-form@example.com" }, `ss_session=${sample}`)).status).toBe(200);
    // Saying "sample" without a sample session (none, an account's, or one whose signature fails): the site's.
    expect((await join({ email: "tally-no-session@example.com", from: "sample" })).status).toBe(200);
    expect((await join({ email: "tally-real@example.com", from: "sample" }, `ss_session=${real}`)).status).toBe(200);
    const forged = `${sample.startsWith("a") ? "b" : "a"}${sample.slice(1)}`;
    expect((await join({ email: "tally-forged@example.com", from: "sample" }, `ss_session=${forged}`)).status).toBe(200);
    // Already on the list: adding an interest isn't a new sign-up.
    expect((await join({ email: "tally-sample@example.com", interest: "collect", from: "sample" }, `ss_session=${sample}`)).status).toBe(200);
    expect([(await counted("site")) - before[0], (await counted("sample")) - before[1]]).toEqual([5, 1]);
  });

  it("keeps numbers only: a day, a source and a count", async () => {
    const columns = await db.root((tx) =>
      tx.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'app' and table_name = 'waitlist_tally' order by ordinal_position"),
    );
    expect(columns.map((c) => c.column_name)).toEqual(["day", "source", "joined"]);
  });
});
