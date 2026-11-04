import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { askAction } from "@/app/app/ask/actions";
import AppHome from "@/app/app/page";
import { makePassport } from "@/app/app/passport/actions";
import { markDeadlinesSeen } from "@/app/app/start-actions";
import { asService, asUser } from "@/lib/server/db";
import { readRequestByNames } from "@/lib/server/request-check";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { parseStart, SAMPLE_REQUEST } from "@/lib/server/start-here";
import { freshDb, type TestDb } from "./support/db";
import { renderPage, textOf } from "./support/render";

/** A sample's Start here (ledger 461, weakest spot 3): Northwind's request answered in 3 steps, each ticked when done. */

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
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.41" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  RedirectType: { push: "push", replace: "replace" },
  usePathname: () => "/app",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
});
beforeEach(() => {
  vi.stubEnv("SHIPSHAPE_UI", "v2");
  vi.stubEnv("SHIPSHAPE_AI", "");
});
afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

async function signInSample() {
  const userId = await createLocalUser(null, true);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  await finishSignIn(userId, { demo: true });
  return requireWorkspace();
}

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) data.append(k, one);
  return data;
};

/** Start here as Home draws it: each step's link, title and chip, the count, and whether the waitlist ends it; null if absent. */
async function startHere() {
  const html = await renderPage(AppHome, {});
  const at = html.indexOf('aria-labelledby="start-title"');
  if (at === -1) return null;
  const section = html.slice(at, html.indexOf("</section>", at));
  const steps = [...section.matchAll(/<a\b([^>]*\bclass="hair-row"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: (/\bhref="([^"]*)"/.exec(m[1])?.[1] ?? "").replaceAll("&amp;", "&"),
    title: textOf(/<span class="hair-title">([\s\S]*?)<\/span>/.exec(m[2])?.[1] ?? ""),
    chip: textOf(/<span class="hair-chip">([\s\S]*?)<\/span><span class="hair-chev">/.exec(m[2])?.[1] ?? ""),
  }));
  return { steps, count: /\d of 3 done/.exec(textOf(section))?.[0], waitlist: section.includes("Hear when real accounts open") };
}

describe("Start here", () => {
  it("opens on the first step, and each step ticks once it's done here, ending on the waitlist", async () => {
    await signInSample();
    const fresh = await startHere();
    expect(fresh?.steps.map((s) => [s.title, s.chip])).toEqual([
      ["1. See what Northwind asked for", "Next"],
      ["2. Send them the packet", ""],
      ["3. See what's due", ""],
    ]);
    expect([fresh?.count, fresh?.waitlist]).toEqual(["0 of 3 done", false]);

    await askAction({}, form({ text: SAMPLE_REQUEST }));
    expect((await startHere())?.steps.map((s) => s.chip)).toEqual(["Done", "Next", ""]);

    // Steps are ticked by doing them, in any order.
    await markDeadlinesSeen();
    expect((await startHere())?.steps.map((s) => s.chip)).toEqual(["Done", "Next", "Done"]);

    const packet = new URL(fresh?.steps[1].href ?? "", "https://x.example").searchParams.get("docs")?.split(",") ?? [];
    await makePassport({}, form({ label: "Northwind Builders", days: "30", doc: packet }));
    const done = await startHere();
    expect(done?.steps.map((s) => s.chip)).toEqual(["Done", "Done", "Done"]);
    expect([done?.count, done?.waitlist]).toEqual(["3 of 3 done", true]);
  });

  it("step 1 opens Check with the request pasted; step 2 opens a link with the current documents it asks for ticked", async () => {
    const ctx = await signInSample();
    const steps = (await startHere())?.steps ?? [];
    expect(steps.map((s) => s.href.split("?")[0])).toEqual(["/app/ask", "/app/passport", "/app/deadlines"]);
    expect(steps[0].href).toBe("/app/ask?try=northwind");

    const docs = await asUser(ctx.userId, (tx) => tx.query<{ id: string; kind: string }>("select id, kind from app.documents where org_id = $1", [ctx.orgId]));
    const ticked = new URL(steps[1].href, "https://x.example").searchParams.get("docs")?.split(",") ?? [];
    // The W-9, the insurance certificate, the contractor license and the NDA; not the city license, which lapsed.
    expect(ticked.map((id) => docs.find((d) => d.id === id)?.kind).sort()).toEqual(["coi", "license", "nda", "w9"]);
  });

  it("Northwind's request gets every answer on the sample's documents: have it, expires soon, expired and missing", async () => {
    const ctx = await signInSample();
    const items = await readRequestByNames(ctx, SAMPLE_REQUEST, "192.0.2.42");
    expect(items.map((i) => [i.label, i.state])).toEqual([
      ["Form W-9", "ready"],
      ["Certificate of insurance", "expiring"],
      ["Contractor license", "ready"],
      ["Business license", "expired"],
      ["Mutual NDA", "ready"],
      ["Certificate of good standing", "missing"],
    ]);
  });

  it("isn't on a real workspace's Home, and checking a request there sets nothing", async () => {
    await finishSignIn(await createLocalUser("start-real@example.com", false), { demo: false });
    expect(await startHere()).toBeNull();
    await askAction({}, form({ text: SAMPLE_REQUEST }));
    expect(jar.has("ss_start")).toBe(false);
  });

  it("starts over in a new sample: steps ticked in another workspace don't count", async () => {
    const first = await signInSample();
    await askAction({}, form({ text: SAMPLE_REQUEST }));
    const kept = jar.get("ss_start");
    jar.clear();
    await signInSample();
    if (kept) jar.set("ss_start", kept);
    expect((await startHere())?.count).toBe("0 of 3 done");
    expect(parseStart(kept?.value, first.orgId)).toEqual(new Set([1]));
  });

  it("keeps the cookie HttpOnly, for the app's pages only, and reads only step numbers from it", async () => {
    const ctx = await signInSample();
    await askAction({}, form({ text: SAMPLE_REQUEST }));
    expect(jar.get("ss_start")?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/app" });
    expect(parseStart(`${ctx.orgId}.3x1<9`, ctx.orgId)).toEqual(new Set([1, 3]));
    expect(parseStart(undefined, ctx.orgId)).toEqual(new Set());
  });
});
