import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentPage from "@/app/app/documents/[id]/page";
import AppHome from "@/app/app/page";
import { usDate } from "@/lib/pdf/sample-papers";
import { asService, asUser } from "@/lib/server/db";
import type { VersionRow } from "@/lib/server/documents";
import type { SignatureRequestRow } from "@/lib/server/esign";
import type { Ctx } from "@/lib/server/profile";
import { SAMPLE_W9_IMAGES, samplePaperPreview, sampleW9Pdf, seedSampleActivity, seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { plusDays } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { pageHash } from "./support/page-hash";
import { renderPage, textOf } from "./support/render";

/** A sample paper's first page on its document page (ledger 461, spot 5b): drawn, or the W-9's images, never read from the file. */

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
let blobDir: string;

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-preview-"));
  setBlobStoreForTests(localBlobStore(blobDir));
});
afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});
beforeEach(() => {
  vi.stubEnv("SHIPSHAPE_UI", "v2");
});
afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

/** A sample as the sign-in page opens one: the workspace, then its activity (which signs the NDA). */
async function signInSample() {
  const userId = await createLocalUser(null, true);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  await seedSampleActivity(org.id, userId);
  await finishSignIn(userId, { demo: true });
  return requireWorkspace();
}

type Version = Pick<VersionRow, "version" | "origin" | "fill_record">;
type Request = Pick<SignatureRequestRow, "version" | "signed_version">;

/** Each document in the workspace by title: its versions, newest first, and its signature requests, as its page has them. */
async function documentsOf(ctx: Ctx) {
  const docs = await db.root((tx) => tx.query<{ id: string; title: string }>("select id, title from app.documents where org_id = $1 order by title", [ctx.orgId]));
  return Promise.all(
    docs.map(async (d) => ({
      title: d.title,
      versions: await db.root((tx) =>
        tx.query<Version>("select version, origin, fill_record from app.document_versions where document_id = $1 order by version desc", [d.id]),
      ),
      requests: await db.root((tx) => tx.query<Request>("select version, signed_version from app.signature_requests where document_id = $1", [d.id])),
    })),
  );
}

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
    const svg = html.slice(at, html.indexOf("</svg>", at));
    const page = textOf(svg);
    // Each text is fitted to its width in the PDF's own font, so a phone without Arial or Times sets it where the file has it.
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThan(50);
    expect((svg.match(/<text [^>]*textLength="[\d.]+"[^>]*lengthAdjust="spacingAndGlyphs"/g) ?? []).length).toBe((svg.match(/<text /g) ?? []).length);
    expect(page).toContain("CERTIFICATE OF LIABILITY INSURANCE");
    expect(page).toContain(usDate(coi.expires_on));
    expect(page).not.toContain(usDate(moved));
    // The watermark and the footer, as on the file.
    expect(page).toContain("SAMPLE DOCUMENT made by ShipShape for its demo.");
    expect(html.slice(at)).toMatch(/<text[^>]*opacity="0.1"[^>]*>SAMPLE<\/text>/);
    // The drawing is decorative; the button that opens the whole page says what it shows.
    expect(textOf(html)).toContain("Show the first page of Certificate of liability insurance (sample)");
  });

  it("shows only the sample's own papers, only in a sample, and only from values that read as one", async () => {
    const ctx = await signInSample();
    const docs = await documentsOf(ctx);
    const shown: string[] = [];
    for (const d of docs) if (await samplePaperPreview(ctx, d.versions, d.requests)) shown.push(d.title);
    expect(shown).toEqual([
      "Certificate of liability insurance (sample)",
      "City business license (sample)",
      "Contractor license (sample)",
      "Mutual NDA with Northwind Builders (sample)",
      "W-9 Harbor Plumbing (sample)",
    ]);

    const coi = docs.find((d) => d.title.startsWith("Certificate of liability"));
    const v1 = coi?.versions[0];
    if (!v1) throw new Error("the sample has no certificate version");
    expect(await samplePaperPreview(ctx, [v1], [])).not.toBeNull();
    expect(await samplePaperPreview({ ...ctx, demo: false }, [v1], [])).toBeNull();
    expect(await samplePaperPreview(ctx, [{ ...v1, origin: "upload" }], [])).toBeNull();
    // Drawn by an earlier drawing (or before drawings were numbered): its file may differ from today's drawing.
    expect(await samplePaperPreview(ctx, [{ ...v1, fill_record: { paper: v1.fill_record?.paper } }], [])).toBeNull();
    expect(await samplePaperPreview(ctx, [{ ...v1, fill_record: { paper: v1.fill_record?.paper, drawn: 0 } }], [])).toBeNull();
    // A W-9 shows today's images only: one that names other images (or none) keeps its card.
    expect(await samplePaperPreview(ctx, [{ version: 1, origin: "sample", fill_record: { paper: { kind: "w9", images: SAMPLE_W9_IMAGES.number } } }], [])).toEqual({
      images: SAMPLE_W9_IMAGES,
    });
    expect(await samplePaperPreview({ ...ctx, demo: false }, [{ version: 1, origin: "sample", fill_record: { paper: { kind: "w9", images: SAMPLE_W9_IMAGES.number } } }], [])).toBeNull();
    expect(await samplePaperPreview(ctx, [{ version: 1, origin: "sample", fill_record: { paper: { kind: "w9", images: SAMPLE_W9_IMAGES.number - 1 } } }], [])).toBeNull();
    expect(await samplePaperPreview(ctx, [{ version: 1, origin: "sample", fill_record: { paper: { kind: "w9" }, drawn: 1 } }], [])).toBeNull();
    // An NDA record missing a value its form requires would still draw a plausible cover: not drawn.
    expect(await samplePaperPreview(ctx, [{ version: 1, origin: "sample", fill_record: { paper: { kind: "nda", values: {} }, drawn: 1 } }], [])).toBeNull();
    expect(await samplePaperPreview(ctx, [], [])).toBeNull();
    // A newer version that isn't a signed copy of the drawn one (an upload over it): its own page, which isn't drawn.
    expect(await samplePaperPreview(ctx, [{ version: 2, origin: "upload", fill_record: null }, v1], [])).toBeNull();
  });

  it("leaves the card when a kept value can't be drawn, logging no value, instead of breaking the page", async () => {
    const ctx = await signInSample();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // The PDF's standard fonts can't encode an arrow; the schema only checks lengths, so this passes it and then fails to draw.
    const business = { legalName: "Harbor → Plumbing LLC", dba: "Harbor Plumbing", address: ["100 Example Street", "Springfield, CA 90000"], signer: "Alex Rivera" };
    const paper = { kind: "coi", business, dates: { issued: "2025-11-25", from: "2025-11-25", to: "2026-11-25" } };
    expect(await samplePaperPreview(ctx, [{ version: 1, origin: "sample", fill_record: { paper, drawn: 1 } }], [])).toBeNull();
    expect(logged.mock.calls.map((c) => String(c[0]))).toEqual(["sample preview: not drawn (Error)"]);
    logged.mockRestore();
  });

  it("shows the signed NDA's cover page: a signed copy starts with the pages of the version that was sent", async () => {
    const ctx = await signInSample();
    const [nda] = await db.root((tx) =>
      tx.query<{ id: string; issued_on: string }>("select id, issued_on::text as issued_on from app.documents where org_id = $1 and kind = 'nda'", [ctx.orgId]),
    );
    // The sample's activity signed it, as the sign-in page's does: the newest version is the signed copy.
    const [latest] = await db.root((tx) =>
      tx.query<{ origin: string }>("select origin from app.document_versions where document_id = $1 order by version desc limit 1", [nda.id]),
    );
    expect(latest.origin).toBe("signed");
    const html = await renderPage(DocumentPage, { params: Promise.resolve({ id: nda.id }), searchParams: Promise.resolve({}) });
    const at = html.indexOf('viewBox="0 0 612 792"');
    expect(at).toBeGreaterThan(-1);
    const page = textOf(html.slice(at, html.indexOf("</svg>", at)));
    expect(page).toContain("Mutual Non-Disclosure Agreement");
    expect(page).toContain(nda.issued_on);
    expect(page).toContain("Northwind Builders (sample)");
    expect(page).toMatch(/Page 1 of \d+/);
    expect(page).not.toContain("Page 2 of");
    expect(html.slice(at)).toMatch(/<text[^>]*opacity="0.12"[^>]*>SAMPLE<\/text>/);
  });

  it("shows the W-9's first page as images of the sample's own W-9, its signature date left blank", async () => {
    // The images were made from this page (npm run sample:w9-image): a change to the sample's facts, the IRS form or
    // how it's filled changes it, and then the images must be made again.
    expect(await pageHash(await sampleW9Pdf("")), "the sample W-9's page changed: see SAMPLE_W9_IMAGES in lib/server/sample.ts").toBe(SAMPLE_W9_IMAGES.page);
    // Blank, not a fixed date (Security P3): a date on the image would differ from the file's.
    expect(await pageHash(await sampleW9Pdf("2026-11-04"))).not.toBe(SAMPLE_W9_IMAGES.page);
    // Each image is there, at the size the page says, so it fills its place without moving anything.
    for (const image of [SAMPLE_W9_IMAGES.crop, SAMPLE_W9_IMAGES.full]) {
      expect(webpSize(await readFile(path.join(process.cwd(), "public", image.src)))).toEqual([image.width, image.height]);
    }

    const ctx = await signInSample();
    const [w9] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and kind = 'w9'", [ctx.orgId]));
    const html = await renderPage(DocumentPage, { params: Promise.resolve({ id: w9.id }), searchParams: Promise.resolve({}) });
    expect(html).toContain(`<img src="${SAMPLE_W9_IMAGES.crop.src}" width="600" height="480" alt=""`);
    // The whole page loads only when its sheet opens.
    expect(html).toMatch(new RegExp(`<img src="${SAMPLE_W9_IMAGES.full.src}" width="918" height="1188" alt="" loading="lazy"`));
    expect(textOf(html)).toContain("Show the first page of W-9 Harbor Plumbing (sample)");
  });

  it("keeps the paper card for a document it can't show", async () => {
    const ctx = await signInSample();
    const [w9] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and kind = 'w9'", [ctx.orgId]));
    // Made when the W-9's page was different: its images are gone.
    await db.root((tx) => tx.query("update app.document_versions set fill_record = jsonb_set(fill_record, '{paper,images}', '0') where document_id = $1", [w9.id]));
    const html = await renderPage(DocumentPage, { params: Promise.resolve({ id: w9.id }), searchParams: Promise.resolve({}) });
    expect(html).not.toContain("/sample/w9-");
    expect(html).not.toContain("Show the first page");
  });

  it("on Home, a sample's 3 newest papers are their first pages, and a real workspace's are title rows that read no file", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    await signInSample();
    const papers = (html: string) => html.slice(html.indexOf('id="papers-title"'), html.indexOf("</section>", html.indexOf('id="papers-title"')));
    const sample = papers(await renderPage(AppHome, {}));
    const thumbs = [...sample.matchAll(/<a [^>]*href="\/app\/documents\/[^"]+"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
    expect(thumbs).toHaveLength(3);
    for (const t of thumbs) expect(t).toMatch(/viewBox="0 0 612 792"|<img src="\/sample\/w9-1-top\.webp"/);
    expect(sample).not.toContain("hair-row");

    const userId = await createLocalUser("home-papers-real@example.com", false);
    await finishSignIn(userId, { demo: false });
    const real = await requireWorkspace();
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind) values ($1, 'Lease', 'agreement'), ($1, 'Permit', 'permit')", [real.orgId]));
    const rows = papers(await renderPage(AppHome, {}));
    expect([...rows.matchAll(/class="hair-title">([^<]*)</g)].map((m) => m[1]).sort()).toEqual(["Lease", "Permit"]);
    expect(rows).not.toMatch(/<svg viewBox="0 0 612|<img /);
  });
});

/** A WebP's width and height, from its header (cwebp writes a simple lossy file, or an extended one). */
function webpSize(b: Buffer): [number, number] {
  const chunk = b.toString("latin1", 12, 16);
  if (chunk === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  throw new Error(`not a lossy WebP: ${chunk}`);
}
