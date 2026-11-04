import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentPage from "@/app/app/documents/[id]/page";
import { usDate } from "@/lib/pdf/sample-papers";
import { asService, asUser } from "@/lib/server/db";
import type { VersionRow } from "@/lib/server/documents";
import { samplePaperPreview, seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { plusDays } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { renderPage, textOf } from "./support/render";

/** A sample paper's first page on its document page (ledger 461, spot 5b): drawn, not read from the file. */

const jar = vi.hoisted(() => new Map<string, { value: string }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = jar.get(name);
      return c && { name, value: c.value };
    },
    set: (name: string, value: string) => void jar.set(name, { value }),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.51" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  RedirectType: { push: "push", replace: "replace" },
  usePathname: () => "/app/documents",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
});
beforeEach(() => {
  vi.stubEnv("SHIPSHAPE_UI", "v2");
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

/** Every version in the workspace, with its document's title. */
const versionsOf = (orgId: string) =>
  db.root((tx) =>
    tx.query<{ title: string; origin: VersionRow["origin"]; fill_record: VersionRow["fill_record"] }>(
      "select d.title, v.origin, v.fill_record from app.document_versions v join app.documents d on d.id = v.document_id where d.org_id = $1 order by d.title",
      [orgId],
    ),
  );

describe("a sample paper's first page", () => {
  it("shows the certificate's own page, drawn from the values it was made with, SAMPLE marks and all", async () => {
    const ctx = await signInSample();
    const [coi] = await db.root((tx) =>
      tx.query<{ id: string; expires_on: string }>("select id, expires_on::text as expires_on from app.documents where org_id = $1 and kind = 'coi'", [ctx.orgId]),
    );
    // A visitor moves its expiry date under Details: the file keeps the date it was drawn with, and so does the preview.
    const moved = plusDays(coi.expires_on, 100);
    await db.root((tx) => tx.query("update app.documents set expires_on = $2 where id = $1", [coi.id, moved]));

    const html = await renderPage(DocumentPage, { params: Promise.resolve({ id: coi.id }), searchParams: Promise.resolve({}) });
    const at = html.indexOf('viewBox="0 0 612 792"');
    expect(at).toBeGreaterThan(-1);
    const page = textOf(html.slice(at, html.indexOf("</svg>", at)));
    expect(page).toContain("CERTIFICATE OF LIABILITY INSURANCE");
    expect(page).toContain(usDate(coi.expires_on));
    expect(page).not.toContain(usDate(moved));
    // The watermark and the footer, as on the file.
    expect(page).toContain("SAMPLE DOCUMENT made by ShipShape for its demo.");
    expect(html.slice(at)).toMatch(/<text[^>]*opacity="0.1"[^>]*>SAMPLE<\/text>/);
    // The drawing is decorative; the button that opens the whole page says what it shows.
    expect(textOf(html)).toContain("Show the first page of Certificate of liability insurance (sample)");
  });

  it("draws only the sample's 3 drawn papers, only in a sample, and only from values that read as one", async () => {
    const ctx = await signInSample();
    const versions = await versionsOf(ctx.orgId);
    const drawn: string[] = [];
    for (const v of versions) if (await samplePaperPreview(ctx, v)) drawn.push(v.title);
    // Not the W-9 or the NDA: the sample fills those from templates, and their pages aren't drawn here.
    expect(drawn).toEqual(["Certificate of liability insurance (sample)", "City business license (sample)", "Contractor license (sample)"]);

    const coi = versions.find((v) => v.title.startsWith("Certificate of liability"));
    expect(await samplePaperPreview(ctx, coi)).not.toBeNull();
    expect(await samplePaperPreview({ ...ctx, demo: false }, coi)).toBeNull();
    expect(await samplePaperPreview(ctx, coi && { ...coi, origin: "upload" })).toBeNull();
    expect(await samplePaperPreview(ctx, { origin: "sample", fill_record: { paper: { kind: "w9" } } })).toBeNull();
    expect(await samplePaperPreview(ctx, undefined)).toBeNull();
  });

  it("keeps the paper card for the documents it doesn't draw", async () => {
    const ctx = await signInSample();
    const [w9] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and kind = 'w9'", [ctx.orgId]));
    const html = await renderPage(DocumentPage, { params: Promise.resolve({ id: w9.id }), searchParams: Promise.resolve({}) });
    expect(html).not.toContain('viewBox="0 0 612 792"');
    expect(html).not.toContain("Show the first page");
  });
});
