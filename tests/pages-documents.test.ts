import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import DocumentPage from "@/app/app/documents/[id]/page";
import { addDocument, addVersion, saveDetails } from "@/app/app/documents/actions";
import { fileRowDescribedBy } from "@/app/app/documents/forms";
import NewDocumentPage from "@/app/app/documents/new/page";
import DocumentsPage from "@/app/app/documents/page";
import { saveFacts, saveTaxId } from "@/app/app/facts/actions";
import FactsPage from "@/app/app/facts/page";
import FillPage from "@/app/app/make/[template]/page";
import { fill } from "@/app/app/make/actions";
import MakePage from "@/app/app/make/page";
import AppNotFound from "@/app/app/not-found";
import AppHome from "@/app/app/page";
import { searchAction } from "@/app/app/search-actions";
import { ShellV2 } from "@/app/app/shell-v2";
import { ErrorPanel } from "@/components/error-panel";
import { PROFILE_FIELDS } from "@/lib/profile-fields";
import { asService, asUser } from "@/lib/server/db";
import { DOCUMENTS_PAGE_SIZE, fillTemplate, setArchived, uploadDocument } from "@/lib/server/documents";
import { requestSignature } from "@/lib/server/esign";
import { prefill } from "@/lib/server/fill";
import { FILL_BUSY, SAMPLE_FULL } from "@/lib/server/limits";
import { createPassport, passportFileUrl, revokePassport } from "@/lib/server/passport";
import { factsForFill, saveEin, saveProfile, type Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { setSaved } from "@/lib/server/saved";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { templateById, TEMPLATES } from "@/lib/templates/catalog";
import { fmtDay } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { fillBucket } from "./support/rate";
import { actionsOf, renderPage, textOf } from "./support/render";

// The request's cookies, as Next.js would hold them.
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
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.31" }),
}));
// The address the page is rendered at, for client components that read it.
const at = vi.hoisted(() => ({ path: "/app" }));
// Like Next.js, redirect() and notFound() never return.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  RedirectType: { push: "push", replace: "replace" },
  usePathname: () => at.path,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");
let blobDir: string;
let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-blobs-"));
  setBlobStoreForTests(localBlobStore(blobDir));
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

beforeEach(() => vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1"));
afterEach(() => {
  jar.clear();
  at.path = "/app";
  vi.unstubAllEnvs();
});

/** Signs a new person in to a new (Free) workspace of their own, the way the sign-in page does. */
async function signIn(email: string) {
  await finishSignIn(await createLocalUser(email, false), { demo: false });
  return requireWorkspace();
}

/** Signs in to a seeded sample workspace, as "Try the sample workspace" does. */
async function signInSample() {
  const userId = await createLocalUser(null, true);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  await finishSignIn(userId, { demo: true });
  return requireWorkspace();
}

/** The labels of the page's primary buttons (class "btn" or "btn-accent"): each state should have exactly one. */
function primaryActions(html: string): { label: string; href?: string }[] {
  return [...html.matchAll(/<(a|button)\b([^>]*\bclass="btn(?:-accent)?"[^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    label: textOf(m[3]),
    href: /\bhref="([^"]*)"/.exec(m[2])?.[1],
  }));
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const documentsPage = (searchParams: { q?: string; kind?: string; archived?: string; page?: string; sort?: string }) =>
  renderPage(DocumentsPage, { searchParams: Promise.resolve(searchParams) });

describe("documents list", () => {
  it("with no documents says what lives here, shows a ghosted example, and offers Fill your first W-9, plus Upload while uploads are open", async () => {
    await signIn("docs-empty@example.com");
    const html = await documentsPage({});
    const text = textOf(html);
    expect(text).toContain("No documents yet");
    expect(text).toContain("Your W-9, insurance certificate and licenses live here, with the date each one runs out, every version, and its history.");
    // Three example rows under an Example label, hidden from screen readers.
    const example = /<div aria-hidden="true"[^>]*>([\s\S]*?)<\/ul><\/div>/.exec(html)?.[1] ?? "";
    expect(textOf(example)).toMatch(/^Example W-9 · /);
    expect(example.match(/<li\b/g)).toHaveLength(3);
    expect(primaryActions(html)).toEqual([{ label: "Fill your first W-9", href: "/app/make/irs-w9" }]);
    expect(actionsOf(html).filter((a) => a.label === "Upload a document")).toEqual([{ tag: "a", label: "Upload a document", href: "/app/documents/new" }]);
    // Nothing to search or to look back at yet.
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Search");
    expect(text).not.toContain("See archived documents");
  });

  it("with no documents and real documents not open yet: says why, and offers no way to the closed Make or Upload pages; the earlier look as it was", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    await signIn("docs-empty-closed@example.com");
    const html = await documentsPage({});
    expect(textOf(html)).toContain("Adding and making real documents opens after our security review.");
    expect(primaryActions(html)).toEqual([]);
    expect(actionsOf(html).map((a) => a.href)).not.toContain("/app/make/irs-w9");
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Upload a document");
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    const earlier = await documentsPage({});
    expect(primaryActions(earlier)).toEqual([{ label: "Fill your first W-9", href: "/app/make/irs-w9" }]);
    expect(actionsOf(earlier).map((a) => a.label)).not.toContain("Upload a document");
  });

  it("with a search that finds nothing says what was searched and offers one action: clear it", async () => {
    const ctx = await signIn("docs-search@example.com");
    await uploadDocument(ctx, { title: "Liability certificate", kind: "coi" }, PDF);
    const text = textOf(await documentsPage({ q: "zebra" }));
    expect(text).toContain("No documents match “zebra”");
    expect(text).toContain("Try a shorter word, or clear the search");
    expect(primaryActions(await documentsPage({ q: "zebra" }))).toEqual([{ label: "Clear the search", href: "/app/documents" }]);
  });

  it("with nothing archived says what archiving does and offers one action: back to current documents", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "");
    const ctx = await signIn("docs-archived@example.com");
    await uploadDocument(ctx, { title: "Business license", kind: "license" }, PDF);
    const html = await documentsPage({ archived: "1" });
    const text = textOf(html);
    expect(text).toContain("No archived documents");
    expect(text).toContain("Documents you archive will be listed here");
    expect(primaryActions(html)).toEqual([{ label: "Go to current documents", href: "/app/documents" }]);
    // The tabs stay, Archived current, so the page says where you are (Design #26 S1); no kind or order menus for nothing.
    const tabs = /<nav aria-label="Current or archived"[^>]*>(.*?)<\/nav>/s.exec(html)?.[1] ?? "";
    expect([...tabs.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["Archived"]);
    expect(html).not.toContain('aria-label="Kind:');

    // The earlier look: the empty state's one action is the only way back.
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    const v1 = await documentsPage({ archived: "1" });
    expect(actionsOf(v1).filter((a) => a.href === "/app/documents")).toHaveLength(1);
    expect(v1).not.toContain("Current or archived");
  });

  it("on Pro, lists 50 documents at a time in the list's order, says which are shown, and pages with the filter kept; a page past the end shows the last", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier look's list markup
    const ctx = await signIn("docs-paged@example.com");
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_paged', 'active', 'pro')", [ctx.orgId]));
    // 51 licenses: the one that runs out soonest sorts first; the others have no date and sort by newest.
    await uploadDocument(ctx, { title: "Soonest license", kind: "license", expires_on: "2030-01-01" }, PDF);
    for (let i = 1; i <= DOCUMENTS_PAGE_SIZE; i++) await uploadDocument(ctx, { title: `License ${String(i).padStart(2, "0")}`, kind: "license" }, PDF);
    await uploadDocument(ctx, { title: "Lone permit", kind: "permit" }, PDF);

    const first = await documentsPage({ kind: "license" });
    const text = textOf(first);
    expect(text).toMatch(/Showing 1\s*–\s*50 of 51/);
    expect(first.match(/<li>/g)).toHaveLength(DOCUMENTS_PAGE_SIZE);
    expect(text.indexOf("Soonest license")).toBeLessThan(text.indexOf("License 50"));
    expect(text).not.toContain("License 01");
    expect(actionsOf(first).filter((a) => a.label === "Next" || a.label === "Previous")).toEqual([{ tag: "a", label: "Next", href: "/app/documents?kind=license&amp;page=2" }]);

    const second = await documentsPage({ kind: "license", page: "2" });
    expect(textOf(second)).toMatch(/Showing 51\s*–\s*51 of 51/);
    expect(textOf(second)).toContain("License 01");
    expect(textOf(second)).not.toContain("Lone permit");
    expect(actionsOf(second).filter((a) => a.label === "Next" || a.label === "Previous")).toEqual([{ tag: "a", label: "Previous", href: "/app/documents?kind=license" }]);

    // Past the end, or junk: the last page, and page 1, with no error.
    expect(textOf(await documentsPage({ kind: "license", page: "9" }))).toMatch(/Showing 51\s*–\s*51 of 51/);
    expect(textOf(await documentsPage({ kind: "license", page: "x" }))).toMatch(/Showing 1\s*–\s*50 of 51/);
    // One page needs no pager.
    expect(textOf(await documentsPage({ kind: "permit" }))).not.toContain("Showing");
  });

  it("in the default look too: 50 at a time, says which are shown, pages with the filter kept, and a page past the end shows the last", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "");
    const ctx = await signIn("docs-paged-v2@example.com");
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_paged2', 'active', 'pro')", [ctx.orgId]));
    await uploadDocument(ctx, { title: "Soonest license", kind: "license", expires_on: "2030-01-01" }, PDF);
    for (let i = 1; i <= DOCUMENTS_PAGE_SIZE; i++) await uploadDocument(ctx, { title: `License ${String(i).padStart(2, "0")}`, kind: "license" }, PDF);
    const pager = (html: string) => actionsOf(html).filter((a) => a.label === "Next" || a.label === "Previous");
    const first = await documentsPage({ kind: "license" });
    expect(textOf(first)).toMatch(/Showing 1\s*–\s*50 of 51/);
    expect(textOf(first).indexOf("Soonest license")).toBeLessThan(textOf(first).indexOf("License 50"));
    expect(textOf(first)).not.toContain("License 01");
    expect(pager(first)).toEqual([{ tag: "a", label: "Next", href: "/app/documents?kind=license&amp;page=2" }]);
    const second = await documentsPage({ kind: "license", page: "9" });
    expect(textOf(second)).toMatch(/Showing 51\s*–\s*51 of 51/);
    expect(textOf(second)).toContain("License 01");
    expect(pager(second)).toEqual([{ tag: "a", label: "Previous", href: "/app/documents?kind=license" }]);
  });

  it("in the default look: tabs All / Archived and the kind and order menus, each link keeping the other choices; Recently added puts the newest first", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "");
    const ctx = await signIn("docs-order@example.com");
    await uploadDocument(ctx, { title: "Soonest license", kind: "license", expires_on: "2030-01-01" }, PDF);
    await uploadDocument(ctx, { title: "Newest permit", kind: "permit" }, PDF);
    const order = (text: string) => [text.indexOf("Soonest license"), text.indexOf("Newest permit")];

    const html = await documentsPage({});
    const [license, permit] = order(textOf(html));
    expect(license).toBeLessThan(permit);
    const links = actionsOf(html);
    const hrefOf = (label: string) => links.find((a) => a.label === label)?.href;
    expect([hrefOf("All"), hrefOf("Archived"), hrefOf("License"), hrefOf("Recently added")]).toEqual([
      "/app/documents",
      "/app/documents?archived=1",
      "/app/documents?kind=license",
      "/app/documents?sort=added",
    ]);
    // Search is the top bar's here: no form on the page.
    expect(html).not.toContain('role="search"');

    const [license2, permit2] = order(textOf(await documentsPage({ sort: "added" })));
    expect(permit2).toBeLessThan(license2);
    // Anything else reads as the default order.
    const [license3, permit3] = order(textOf(await documentsPage({ sort: "title" })));
    expect(license3).toBeLessThan(permit3);

    const both = actionsOf(await documentsPage({ sort: "added", kind: "license" }));
    expect(both.find((a) => a.label === "Archived")?.href).toBe("/app/documents?kind=license&amp;archived=1&amp;sort=added");
    expect(both.find((a) => a.label === "Soonest expiry")?.href).toBe("/app/documents?kind=license");

    // A search from the top bar says what it shows and how to clear it, keeping the rest.
    const searched = await documentsPage({ q: "permit", sort: "added" });
    expect(textOf(searched)).toContain("Showing documents that match “permit”. Clear the search");
    expect(actionsOf(searched).find((a) => a.label === "Clear the search")?.href).toBe("/app/documents?sort=added");
  });
});

const homePage = () => renderPage(AppHome, {});

// The earlier Home (SHIPSHAPE_UI=v1): the setup list and its cards. The redesigned Home has its own describe below.
describe("home, earlier look (SHIPSHAPE_UI=v1)", () => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", "v1"));
  it("on a first visit teaches what will appear, counts only real progress, and offers one action: the next step", async () => {
    await signIn("home-first@example.com");
    const html = await homePage();
    const text = textOf(html);
    expect(text).toContain("0 of 6 done");
    expect(text).toContain("this page lists only what needs you");
    expect(text).toContain("Documents that have expired, expire, or have a renewal notice due in the next 30 days will be listed here");
    expect(primaryActions(html)).toEqual([{ label: "Name your workspace", href: "/app/settings#workspace" }]);
  });

  it("calls the W-9 action by one name, 'Fill a W-9', in the setup list and on its card, and the card says where the values come from", async () => {
    await signIn("home-w9@example.com");
    const w9 = actionsOf(await homePage()).filter((a) => a.href === "/app/make/irs-w9");
    expect(w9.map((a) => a.label)).toEqual(["Fill a W-9 (to do)", "Fill a W-9 Filled from your business facts."]);
  });

  it("with an expired document says what it means and gives one action that fixes it", async () => {
    const ctx = await signIn("home-expired@example.com");
    const id = await uploadDocument(ctx, { title: "Old permit", kind: "permit", expires_on: "2020-01-31" }, PDF);
    const html = await homePage();
    const text = textOf(html);
    expect(text).toContain("Old permit");
    expect(text).toContain("It has lapsed.");
    // What renews a document is said once above the list, not on every row.
    expect(text.split("For a document that's lapsing, renew it with the issuer, then add the new copy and its new date, so your passport links share the current one.")).toHaveLength(2);
    expect(text).not.toContain("Renew it with the issuer, then");
    expect(text).not.toContain("Nothing has expired");
    // Only the lapsed group is there, so only its label.
    expect(text).toContain("Already lapsed");
    expect(text).not.toContain("Coming up");
    const attention = html.slice(html.indexOf("Needs attention"));
    expect(actionsOf(attention).filter((a) => a.href?.startsWith(`/app/documents/${id}`))).toEqual([
      { tag: "a", label: "Add the renewed copy", href: `/app/documents/${id}#version-file` },
    ]);
  });

  // Rows are dated from the page's own "today" (ctx.today), not the database's clock, so a non-UTC server can't shift them.
  const seedDated = (ctx: Ctx, rows: [title: string, daysFromToday: number][], kind = "license") =>
    db.root(async (tx) => {
      for (const [title, days] of rows) {
        await tx.query("insert into app.documents (org_id, title, kind, expires_on) values ($1, $2, $3, $4::date + $5::int)", [ctx.orgId, title, kind, ctx.today, days]);
      }
    });

  it("on Pro with many lapsing documents: lists the 20 most urgent, counts them all, and points at Deadlines for the rest", async () => {
    const ctx = await signIn("home-many@example.com");
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_HomeMany', 'active', 'pro')", [ctx.orgId]));
    // 22 lapsing (days 1..21 from today, and the last day of the window, +30); 3 current (+31, one just outside the window, and two undated);
    // one archived lapsed document that counts nowhere.
    await seedDated(ctx, [...Array.from({ length: 21 }, (_, i): [string, number] => [`License ${String(i + 1).padStart(2, "0")}`, i + 1]), ["Window edge", 30], ["Just outside", 31]]);
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind) values ($1, 'Undated A', 'other'), ($1, 'Undated B', 'other')", [ctx.orgId]));
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind, status, expires_on) values ($1, 'Archived old', 'other', 'archived', $2::date - 5)", [ctx.orgId, ctx.today]));
    const html = await homePage();
    const text = textOf(html);
    expect(text).toMatch(/3 of 25 documents current/);
    expect(text).toContain("License 01");
    expect(text).toContain("License 20");
    expect(text).not.toContain("License 21");
    expect(text).not.toContain("Window edge");
    expect(text).not.toContain("Archived old");
    expect(text).toContain("The 20 most urgent are listed; 2 more need attention.");
    expect(text.split("renew it with the issuer")).toHaveLength(2);
    // Past the cap, the only list that shows why each hidden row is there (expiry or renewal date) is Deadlines (Design).
    expect(actionsOf(html).filter((a) => a.label === "See every date")).toEqual([{ tag: "a", label: "See every date", href: "/app/deadlines" }]);
    expect(text).not.toContain("See all documents");
    // The setup list reads the same summary: a document exists and one has a date.
    expect(text).not.toContain("Add an expiry date (to do)");
  });

  it("lists what can still be renewed in time before what has lapsed, so old lapsed documents can't hide one expiring this week", async () => {
    const ctx = await signIn("home-urgent@example.com");
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_HomeUrgent', 'active', 'pro')", [ctx.orgId]));
    // 21 lapsed long ago (the list's own order would fill the 20 slots with them), one lapsed yesterday, one expiring in 3 days.
    await seedDated(ctx, [...Array.from({ length: 21 }, (_, i): [string, number] => [`Old COI ${String(i + 1).padStart(2, "0")}`, -400 - i]), ["Lapsed yesterday", -1], ["Expiring soon", 3]]);
    const text = textOf(await homePage());
    const at = (title: string) => text.indexOf(title);
    // Two labelled groups, in this order: the one that can still be renewed, then the lapsed ones, most recent first.
    expect(at("Coming up")).toBeGreaterThan(-1);
    expect(at("Expiring soon")).toBeGreaterThan(at("Coming up"));
    expect(at("Already lapsed")).toBeGreaterThan(at("Expiring soon"));
    expect(at("Lapsed yesterday")).toBeGreaterThan(at("Already lapsed"));
    expect(at("Old COI 01")).toBeGreaterThan(at("Lapsed yesterday"));
    expect(at("Old COI 21")).toBe(-1);
    // Every hidden one has lapsed, and the line says so.
    expect(text).toContain("The 20 most urgent are listed; 3 more have lapsed.");
    expect(text).not.toContain("more need attention");
  });

  it("with up to 20 lapsing documents lists them all and says nothing about more; past 20 the line counts what's hidden and says whether it has all lapsed", async () => {
    const ctx = await signIn("home-twenty@example.com");
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_HomeTwenty', 'active', 'pro')", [ctx.orgId]));
    await seedDated(ctx, Array.from({ length: 20 }, (_, i): [string, number] => [`Permit ${String(i + 1).padStart(2, "0")}`, i + 1]), "permit");
    const text = textOf(await homePage());
    expect(text).toMatch(/0 of 20 documents current/);
    expect(text).toContain("Permit 01");
    expect(text).toContain("Permit 20");
    expect(text).not.toContain("more need attention");
    expect(text).not.toContain("more ha");
    // One more, still renewable: hidden behind the 20 sooner ones.
    await seedDated(ctx, [["Permit 21", 21]], "permit");
    expect(textOf(await homePage())).toContain("The 20 most urgent are listed; 1 more needs attention.");
    // A lapsed one joins the hidden: a mix, so the plain count.
    await seedDated(ctx, [["Lapsed permit", -1]], "permit");
    expect(textOf(await homePage())).toContain("The 20 most urgent are listed; 2 more need attention.");
    // Only the lapsed one hidden: the line says so, in the singular.
    await db.root((tx) => tx.query("delete from app.documents where org_id = $1 and title = 'Permit 21'", [ctx.orgId]));
    expect(textOf(await homePage())).toContain("The 20 most urgent are listed; 1 more has lapsed.");
  });

  it("each row says how long is left in plain words: 'Expires today.', '1 day left.', 'N days left.'", async () => {
    const ctx = await signIn("home-days@example.com");
    await seedDated(ctx, [["Today permit", 0], ["Tomorrow permit", 1], ["Week permit", 7]], "permit");
    const text = textOf(await homePage());
    expect(text).toMatch(/Today permit.*Expires today\./);
    expect(text).toMatch(/Tomorrow permit.*1 day left\./);
    expect(text).toMatch(/Week permit.*7 days left\./);
    expect(text).not.toContain("0 days left");
  });

  it("a renewal notice due in the next 30 days is 'Coming up', sorted with the expiries by date, with its own words and 'Open it'; a passed one drops off", async () => {
    const ctx = await signIn("home-renewals@example.com");
    const ins = (title: string, expires: number | null, renews: number | null) =>
      db.root(async (tx) => {
        const [row] = await tx.query<{ id: string }>(
          "insert into app.documents (org_id, title, kind, expires_on, renews_on) values ($1, $2, 'agreement', case when $4::int is null then null else $3::date + $4::int end, case when $5::int is null then null else $3::date + $5::int end) returning id",
          [ctx.orgId, title, ctx.today, expires, renews],
        );
        return row.id;
      });
    const nda = await ins("Vendor NDA", null, 5);
    await ins("Lease", 400, 0);
    await ins("Old notice", null, -1);
    await ins("Edge notice", null, 30);
    await ins("Far notice", null, 31);
    await ins("Permit", 3, null);
    // Both dates in the window: the sooner one decides the row (the renewal here), and the document appears once.
    await ins("Both soon", 25, 10);
    // The expiry sooner than an in-window renewal: the expiry decides; the same day: the expiry.
    await ins("Expiry first", 5, 20);
    await ins("Same day", 0, 0);
    const html = await homePage();
    const text = textOf(html);
    const at = (s: string) => text.indexOf(s);
    expect(text).toMatch(/Vendor NDA.*Renewal notice · \w{3} \d{1,2}, \d{4}.*Renewal notice due in 5 days\./);
    // The chip shows the row's reason: no "Current" or "No expiry date" chip beside a renewal notice (Design MUST).
    expect(text).toMatch(/Lease.*Renewal notice · .*Renewal notice due today\.\s+Open it/);
    expect(text).not.toMatch(/Lease.*Current ·/);
    expect(text).not.toMatch(/Vendor NDA.*No expiry date/);
    // One chip, the row's reason; an expiry within 30 days is named on the state line, month and day only (Design).
    const in25 = new Date(Date.parse(ctx.today) + 25 * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    expect(text).toMatch(new RegExp(`Both soon.*Renewal notice · .*Renewal notice due in 10 days\\. Expires ${in25}\\.\\s+Open it`));
    expect(text).not.toMatch(/Lease[^.]*\.\s*Expires /);
    expect(text).not.toMatch(/Both soon.*Expires soon/);
    expect(text.split("Both soon")).toHaveLength(2);
    expect(text).toMatch(/Edge notice.*Renewal notice due in 30 days\./);
    expect(text).toMatch(/Expiry first\s+Agreement\s+◷?\s*Expires soon\s*·[^.]*5 days left\./);
    expect(text).toMatch(/Same day.*Expires today\./);
    // "Current" leaves out anything listed above: 9 documents, 2 need nothing now (Far notice, Old notice).
    expect(text).toMatch(/2 of 9 documents current/);
    // Expiry rows keep their validity chip.
    expect(text).toMatch(/Permit.*Expires soon ·/);
    expect(text).not.toContain("Old notice");
    expect(text).not.toContain("Far notice");
    // Sorted by date with the expiries: Lease (today), Permit (3 days), Vendor NDA (5), Both soon (10), Edge notice (30).
    expect(at("Lease")).toBeLessThan(at("Permit"));
    expect(at("Permit")).toBeLessThan(at("Vendor NDA"));
    expect(at("Vendor NDA")).toBeLessThan(at("Both soon"));
    expect(at("Both soon")).toBeLessThan(at("Edge notice"));
    expect(at("Same day")).toBeLessThan(at("Lease"));
    expect(text).toContain("Coming up");
    expect(text).not.toContain("Already lapsed");
    const attention = html.slice(html.indexOf("Needs attention"));
    expect(actionsOf(attention).filter((a) => a.href?.startsWith(`/app/documents/${nda}`))).toEqual([{ tag: "a", label: "Open it", href: `/app/documents/${nda}` }]);
    // The checklist's "Add an expiry date" is ticked by a renewal date too, and Home now agrees: that document is listed.
    expect(text).not.toContain("Add an expiry date (to do)");
  });

  it("a lapsed expiry decides the row even with a renewal notice due", async () => {
    const ctx = await signIn("home-lapsed-renewal@example.com");
    await db.root((tx) =>
      tx.query("insert into app.documents (org_id, title, kind, expires_on, renews_on) values ($1, 'Lapsed with notice', 'agreement', $2::date - 2, $2::date + 4)", [ctx.orgId, ctx.today]),
    );
    const text = textOf(await homePage());
    expect(text).toMatch(/Already lapsed.*Lapsed with notice.*It has lapsed\./);
    expect(text).not.toContain("Renewal notice");
    expect(text).not.toContain("Coming up");
  });
});

describe("home, redesigned (SHIPSHAPE_UI=v2)", () => {
  /** Home's tools in order: where each goes, its one-word name, and whether it's closed and why (its tooltip and accessible name). */
  const tools = (html: string) =>
    [...html.matchAll(/<a ([^>]*\bclass="tool press[^"]*"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
      const closed = /\bclass="tool press closed"/.test(m[1]);
      const [name, why] = textOf(m[2]).split(/\s*:\s*/);
      return { href: /\bhref="([^"]*)"/.exec(m[1])?.[1], name, closed, why: why ?? null, title: /\btitle="([^"]*)"/.exec(m[1])?.[1] };
    });
  const closedOnes = (html: string) => tools(html).filter((t) => t.closed).map((t) => `${t.name}: ${t.why} (${t.title})`);
  /** One of Home's sections, from its title to the next section. */
  const section = (html: string, id: string) => {
    const from = html.indexOf(`id="${id}"`);
    const end = html.indexOf("</section>", from);
    return html.slice(from, end);
  };
  const rowTitles = (html: string) => [...html.matchAll(/class="hair-title">([^<]*)</g)].map((m) => m[1]);

  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", "v2"));

  it("asks the question first, then one row of all ten tools by their one-word names, each opening its own page; a closed one says why (AI off)", async () => {
    await signIn("home-v2@example.com");
    const html = await homePage();
    expect(textOf(html)).toMatch(/^What do you need to get done\?/);
    expect(tools(html).map(({ href, name, closed }) => ({ href, name, closed }))).toEqual([
      { href: "/app/documents", name: "Documents", closed: false },
      { href: "/app/documents/new", name: "Add", closed: false },
      { href: "/app/make", name: "Make", closed: false },
      { href: "/app/ask", name: "Check", closed: true },
      { href: "/app/passport", name: "Passport", closed: false },
      { href: "/app/documents", name: "Sign", closed: false },
      { href: "/app/collect", name: "Collect", closed: false },
      { href: "/app/deadlines", name: "Deadlines", closed: false },
      { href: "/app/facts", name: "Facts", closed: false },
      { href: "/app/settings", name: "Settings", closed: false },
    ]);
    expect(closedOnes(html)).toEqual(["Check: AI is off right now (AI is off right now)"]);
  });

  it("before the security review, a real workspace's closed tools say what isn't open yet; Facts, view only, still opens", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    await signIn("home-v2-gated@example.com");
    const html = await homePage();
    expect(closedOnes(html)).toEqual([
      "Add: Opens after our security review (Opens after our security review)",
      "Make: Opens after our security review (Opens after our security review)",
      "Check: AI is off right now (AI is off right now)",
      "Collect: Not open yet (Not open yet)",
    ]);
    // The page each one opens says the same.
    expect(textOf(await renderPage(MakePage, {}))).toContain("Making real documents opens after our security review.");
  });

  it("in a sample, adding a document is the one closed tool", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "unused");
    await signInSample();
    expect(closedOnes(await homePage())).toEqual(["Add: Not in the sample (Not in the sample)"]);
  });

  it("the documents list leads with an action that works: Make in a sample (adding isn't in it), Add where files can be added", async () => {
    await signInSample();
    expect(primaryActions(await documentsPage({}))).toEqual([{ label: "Make a document", href: "/app/make" }]);
    expect(await documentsPage({})).not.toContain('href="/app/documents/new"');
    const ctx = await signIn("docs-v2-real@example.com");
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind) values ($1, 'Lease', 'agreement')", [ctx.orgId]));
    const html = await documentsPage({});
    expect(primaryActions(html)).toEqual([{ label: "Add a document", href: "/app/documents/new" }]);
    expect(html).toMatch(/<a class="btn-ghost" href="\/app\/make">Make a document<\/a>/);
  });

  it("Recent lists the five newest active documents, newest first, each with its kind, issuer and state", async () => {
    const ctx = await signIn("home-v2-recent@example.com");
    await db.root((tx) =>
      tx.query(
        "insert into app.documents (org_id, title, kind, issuer, expires_on, status, created_at) select $1, 'Doc ' || n, 'permit', 'City (test)', $2::date - 1, case when n = 6 then 'archived' else 'active' end, now() - make_interval(mins => 10 - n) from generate_series(1, 7) n",
        [ctx.orgId, ctx.today],
      ),
    );
    const recent = section(await homePage(), "recent-title");
    expect(rowTitles(recent)).toEqual(["Doc 7", "Doc 5", "Doc 4", "Doc 3", "Doc 2"]);
    expect(textOf(recent)).toContain("Permit · City (test)");
    expect(recent).toContain('data-validity="expired"');
    expect(actionsOf(recent)[0]).toEqual({ tag: "a", label: "View all", href: "/app/documents" });
  });

  it("Waiting on others: the open signature requests on active documents, then the vendors who owe a document, and only this workspace's (S1, S4, S5)", async () => {
    const ctx = await signInSample();
    const nda = await db.root(async (tx) => {
      const [d] = await tx.query<{ id: string; title: string }>("select id, title from app.documents where org_id = $1 and kind = 'nda'", [ctx.orgId]);
      return d;
    });
    await requestSignature(ctx, { documentId: nda.id, signerName: "Dana Kim (sample)", signerEmail: "dana@bayside.example", days: 7 }, "192.0.2.10");
    // A request on a document that's then archived is withdrawn, and doesn't come back here.
    const gone = await db.root(async (tx) => {
      const [d] = await tx.query<{ id: string }>("select id from app.documents where org_id = $1 and kind = 'w9'", [ctx.orgId]);
      return d.id;
    });
    await requestSignature(ctx, { documentId: gone, signerName: "Sam Ortiz (sample)", signerEmail: "sam@northwind.example", days: 7 }, "192.0.2.10");
    await setArchived(ctx, gone, true);
    // Even a request still open on an archived document stays out (S5), not only the withdrawn ones.
    const permit = await db.root(async (tx) => {
      const [d] = await tx.query<{ id: string }>("select id from app.documents where org_id = $1 and kind = 'permit'", [ctx.orgId]);
      return d.id;
    });
    await requestSignature(ctx, { documentId: permit, signerName: "Lee Park (sample)", signerEmail: "lee@city.example", days: 7 }, "192.0.2.10");
    await db.root((tx) => tx.query("update app.documents set status = 'archived' where id = $1", [permit]));

    const waiting = section(await homePage(), "waiting-title");
    expect(rowTitles(waiting)).toEqual([nda.title, "Bayside Drywall (sample)", "Rivera Electric (sample)"]);
    const text = textOf(waiting);
    expect(text).toContain(`Dana Kim (sample) · sent ${fmtDay(ctx.today)} Not signed yet`);
    // The owner-entered name only: the signer's email stays on the document's page.
    expect(text).not.toContain("dana@bayside.example");
    expect(text).not.toMatch(/Sam Ortiz|Lee Park/);
    expect(text).toContain("Collect · W-9 missing, insurance certificate lapsed Waiting");
    expect(text).toContain("Collect · License missing Waiting");
    expect(text).not.toContain("Summit Supply");

    // Someone in another workspace sees none of it, and their own empty state; so do they after joining this one too,
    // while they're in their own (a person in two workspaces sees each one's on its own Home).
    const other = await signIn("home-v2-other@example.com");
    const otherHome = () => homePage().then((html) => textOf(section(html, "waiting-title")));
    expect(await otherHome()).not.toMatch(/Dana Kim|Bayside|Rivera/);
    expect(await otherHome()).toContain("Signature requests nobody has signed yet, and vendors who still owe you a document, show up here.");
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [ctx.orgId, other.userId]));
    expect(await otherHome()).not.toMatch(/Dana Kim|Bayside|Rivera/);
  });

  it("Saved: the person's three newest saves beside Waiting, each to its page with its state in words; with nothing saved it isn't there", async () => {
    const ctx = await signIn("home-v2-saved@example.com");
    expect(await homePage()).not.toContain('id="saved-title"');
    for (const n of [1, 2, 3, 4]) {
      const [doc] = await db.root((tx) =>
        tx.query<{ id: string }>("insert into app.documents (org_id, title, kind, expires_on) values ($1, $2, 'permit', $3::date + 400) returning id", [ctx.orgId, `Saved ${n}`, ctx.today]),
      );
      await setSaved(ctx, { kind: "document", id: doc.id, saved: true });
    }
    const html = await homePage();
    const saved = section(html, "saved-title");
    expect(rowTitles(saved)).toEqual(["Saved 4", "Saved 3", "Saved 2"]);
    expect(textOf(saved)).toContain("Saved 4 Permit · current");
    expect(saved).not.toContain("hair-chip");
    expect(actionsOf(saved)[0]).toEqual({ tag: "a", label: "View all", href: "/app/saved" });
    expect(html).toContain('<div class="grid gap-12 lg:grid-cols-2 lg:gap-6"><section aria-labelledby="waiting-title"');
  });

  it("search finds this workspace's active documents by their words, never an archived one or another workspace's (S1, S5, S6)", async () => {
    const ctx = await signIn("search-v2@example.com");
    await db.root((tx) =>
      tx.query("insert into app.documents (org_id, title, kind, issuer, status) values ($1, 'Harbor lease', 'agreement', 'Pier 9 (test)', 'active'), ($1, 'Harbor permit', 'permit', null, 'archived')", [ctx.orgId]),
    );
    const other = await signIn("search-v2-other@example.com");
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind) values ($1, 'Harbor insurance', 'coi')", [other.orgId]));
    expect(await searchAction("harbor")).toEqual([{ id: expect.any(String), title: "Harbor insurance", line: "Insurance certificate" }]);
    // In both workspaces, a search still finds only the one they're in.
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [ctx.orgId, other.userId]));
    expect(await searchAction("harbor")).toEqual([{ id: expect.any(String), title: "Harbor insurance", line: "Insurance certificate" }]);
    await finishSignIn(ctx.userId, { demo: false });
    expect(await searchAction("harbor")).toEqual([{ id: expect.any(String), title: "Harbor lease", line: "Agreement · Pier 9 (test)" }]);
    expect(await searchAction("")).toEqual([]);
    expect(await searchAction({ q: "harbor" })).toEqual([]);
  });

  it("is the default: unset shows the redesigned Home, and only SHIPSHAPE_UI=v1 brings back the earlier one (ledger 416)", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "");
    await signIn("home-v2-default@example.com");
    expect(tools(await homePage())).toHaveLength(10);
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    const html = await homePage();
    expect(tools(html)).toEqual([]);
    expect(textOf(html)).toContain("0 of 6 done");
  });
});

describe("the app's frame, redesigned", () => {
  const shell = (ws: Ctx, deleting = false) => renderPage(ShellV2, { ws, deleting, children: null });
  /** The sidebar's rows, with a ● where the lapsed dot is. */
  const sidebar = (html: string) => {
    const aside = html.slice(html.indexOf('<aside aria-label="Workspace"'), html.indexOf("</aside>"));
    return [...aside.matchAll(/<a [^>]*class="side-row"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => textOf(m[1].replace(/<span class="side-dot"[^>]*><\/span>/, " ● ")));
  };

  it("groups the pages that exist, and dots Deadlines only while a document has lapsed", async () => {
    const ctx = await signIn("shell-v2@example.com");
    const rows = ["Home", "Work", "Documents", "Saved", "Signed copies", "Sent", "Templates", "Track", "History", "Deadlines", "Passport", "Business", "Business facts", "Collect", "People", "Settings"];
    const html = await shell(ctx);
    expect(textOf(html.slice(html.indexOf('<nav aria-label="App"'), html.indexOf("</nav>")))).toBe(rows.join(" "));
    expect(sidebar(html)).not.toContain("Deadlines ● , something has lapsed");
    // Expiring today is still current today ("Expires soon"), so no dot until the day after.
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind, expires_on) values ($1, 'Last day', 'permit', $2::date)", [ctx.orgId, ctx.today]));
    expect(sidebar(await shell(ctx))).not.toContain("Deadlines ● , something has lapsed");
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind, expires_on) values ($1, 'Old permit', 'permit', $2::date - 1)", [ctx.orgId, ctx.today]));
    expect(sidebar(await shell(ctx))).toContain("Deadlines ● , something has lapsed");
    // Archived, it no longer counts.
    await db.root((tx) => tx.query("update app.documents set status = 'archived' where org_id = $1", [ctx.orgId]));
    expect(sidebar(await shell(ctx))).toContain("Deadlines");
    expect(sidebar(await shell(ctx))).not.toContain("Deadlines ● , something has lapsed");
  });

  it("a sample carries Security's strip word for word, and the account row is the workspace and its role, never a person", async () => {
    const ctx = await signInSample();
    const html = await shell(ctx);
    expect(textOf(html)).toContain(
      "Sample workspace: everything here is made up, and it never takes real files. Don't type real tax numbers or personal details here.",
    );
    const row = /<button [^>]*class="account-row"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    expect(textOf(row)).toBe("HP Harbor Plumbing (sample) Owner");
    expect(textOf(await shell(await signIn("shell-v2-real@example.com")))).not.toContain("Sample workspace");
  });

  it("Feedback writes to the contact address, and isn't there while none is set; Help opens the FAQ, in the top bar and the phone's menu", async () => {
    const ctx = await signIn("shell-v2-feedback@example.com");
    expect(actionsOf(await shell(ctx)).filter((a) => a.label === "Feedback")).toEqual([]);
    expect(actionsOf(await shell(ctx)).filter((a) => a.label === "Help")).toHaveLength(2);
    vi.stubEnv("CONTACT_EMAIL", "hello@shipshape.example");
    const html = await shell(ctx);
    const pair = [
      { tag: "a", label: "Help", href: "/faq" },
      { tag: "a", label: "Feedback", href: "mailto:hello@shipshape.example?subject=ShipShape%20feedback" },
    ];
    // The top bar's (hidden on the phone), then the phone menu's.
    expect(actionsOf(html).filter((a) => a.label === "Feedback" || a.label === "Help")).toEqual([...pair, ...pair]);
  });
});

// Every state and word holds in both looks.
describe.each([
  ["earlier (SHIPSHAPE_UI=v1)", "v1"],
  ["redesigned (the default, SHIPSHAPE_UI unset)", ""],
])("business facts, %s", (_look, ui) => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", ui));
  const v2 = ui !== "v1";
  const mail = (name: string) => `${ui || "v2"}-${name}@example.com`;
  /** The page's primary actions: class "btn" in the earlier look, "btn press …" (docked) in the redesigned app. */
  const primary = (html: string) =>
    v2 ? [...html.matchAll(/<button class="btn press[^"]*"[^>]*>([^<]*)</g)].map((m) => ({ label: m[1], href: undefined })) : primaryActions(html);

  it("with nothing confirmed says so, what the facts are for, and offers one action: save them", async () => {
    await signIn(mail("facts-empty"));
    const html = await renderPage(FactsPage, {});
    expect(textOf(html)).toContain("Nothing is confirmed yet: fill in what you know, then choose Save and confirm.");
    expect(primary(html)).toEqual([{ label: "Save and confirm", href: undefined }]);
  });

  it("W15-11: a member's crafted post to Save facts or Save EIN comes back as a message with what was typed, not the error page", async () => {
    const owner = await signIn(mail("facts-owner-w15"));
    const memberId = await createLocalUser(mail("facts-member-w15"), false);
    // Their membership here is older than their own workspace, so this is the workspace they work in.
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role, created_at) values ($1, $2, 'member', now() - interval '1 day')", [owner.orgId, memberId]));
    await finishSignIn(memberId, { demo: false });
    const member = await requireWorkspace();
    expect({ orgId: member.orgId, role: member.role }).toEqual({ orgId: owner.orgId, role: "member" });
    const said = "Only owners and admins can change this workspace's business facts. Nothing was saved.";
    const saved = await saveFacts({}, form({ legal_name: "Member Co", entity_type: "llc" }));
    expect(saved.error).toBe(said);
    expect(saved.values?.legal_name).toBe("Member Co");
    expect(await saveTaxId({}, form({ ein: "12-3456789" }))).toEqual({ error: said });
  });

  it("dates the last confirmation on the owner's day, not the UTC day: the Facts page and the fill form's source chip (wave 8 #5)", async () => {
    const ctx = await signIn(mail("facts-zone"));
    await saveProfile(ctx, { ...(await factsForFill(ctx)).values, legal_name: "West Coast Co", entity_type: "c_corp" });
    // Confirmed at 01:00 UTC on Nov 1: still Oct 31 in Los Angeles.
    await db.root((tx) => tx.query("update app.profile_facts set confirmed_at = '2026-11-01 01:00:00+00' where org_id = $1", [ctx.orgId]));
    jar.set("ss_tz", { value: "America/Los_Angeles" });
    expect(textOf(await renderPage(FactsPage, {}))).toMatch(/Last confirmed Oct 31, 2026 ?\./);
    expect(textOf(await renderPage(FillPage, { params: Promise.resolve({ template: "irs-w9" }) }))).toContain("From Business facts · confirmed Oct 31, 2026");
    jar.set("ss_tz", { value: "Asia/Tokyo" });
    expect(textOf(await renderPage(FactsPage, {}))).toMatch(/Last confirmed Nov 1, 2026 ?\./);
  });
});

describe("business facts and Make, redesigned only", () => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", "v2"));

  it("Facts: Save and confirm is there with nothing changed (confirming unchanged facts is what 'still true?' asks), and every editable row hints Add; a sample's rows are locked, with no Save and no hint", async () => {
    await signIn("v2-facts-owner@example.com");
    const own = await renderPage(FactsPage, {});
    expect(own).toMatch(/<div class="save-dock[^"]*"><button class="btn press[^"]*">Save and confirm<\/button>/);
    expect(own).toMatch(/<fieldset class="min-w-0">/);
    expect(own).toMatch(/<input id="legal_name"[^>]*class="row-field"/);
    // Empty rows read as places to type, not a static list (Design 02 Nov).
    const hints = (html: string) => [...html.matchAll(/<input id="([a-z_0-9]+)"[^>]*class="row-field"[^>]*>/g)].map((m) => [m[1], /placeholder="([^"]*)"/.exec(m[0])?.[1]]);
    expect(hints(own)).toEqual(PROFILE_FIELDS.map((f) => [f.key, "Add"]));

    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await finishSignIn(userId, { demo: true });
    const sample = await renderPage(FactsPage, {});
    expect(sample).toMatch(/<fieldset disabled="" class="min-w-0">/);
    expect(sample).not.toContain("Save and confirm</button>");
    expect(hints(sample)).toEqual(PROFILE_FIELDS.map((f) => [f.key, undefined]));
    // The EIN is a row: the masked number, and the button that shows it.
    expect(textOf(sample)).toMatch(/Employer identification number \(EIN\) \S*\d{4} Show full EIN/);
  });

  it("Make: one row per template opening its form; the SAFE row leaves for ycombinator.com in a new tab, and says so", async () => {
    await signIn("v2-make@example.com");
    const html = await renderPage(MakePage, {});
    expect(actionsOf(html).filter((a) => a.href?.startsWith("/app/make/")).map((a) => a.href)).toEqual(TEMPLATES.map((t) => `/app/make/${t.id}`));
    const safe = /<a href="https:\/\/www\.ycombinator\.com\/documents"([^>]*)>([\s\S]*?)<\/a>/.exec(html);
    expect(safe?.[1]).toContain('target="_blank"');
    expect(safe?.[1]).toContain('rel="noopener noreferrer"');
    expect(textOf(safe?.[2] ?? "")).toContain("Link to the original · ycombinator.com · No redistribution license, so we link out , opens on ycombinator.com in a new tab");
  });
});

describe("making a document", () => {
  it("starts on step 1 of 4 with a Continue button; the later steps are present but hidden, and approving comes after the review", async () => {
    await signIn("fill-start@example.com");
    const html = await renderPage(FillPage, { params: Promise.resolve({ template: "irs-w9" }) });
    const text = textOf(html);
    expect(text).toContain("Step 1 of 4 Who's filling it in");
    expect(primaryActions(html)).toEqual([{ label: "Continue", href: undefined }]);
    expect(text).toMatch(/Next: tax type and number\s*\./);
    // Step 2's fields are in the form (hidden) so every post carries every value.
    expect(html).toMatch(/<div hidden=""[^>]*>(?:(?!<\/div>)[\s\S])*name="tax_class"/);
    expect(text).not.toContain("Review the W-9");
    expect(text).not.toContain("Approve and make");
  });

  it("the NDA, which has no steps, is one page with the review button", async () => {
    await signIn("fill-nda@example.com");
    const html = await renderPage(FillPage, { params: Promise.resolve({ template: "common-paper-mnda" }) });
    expect(textOf(html)).not.toContain("Step 1 of");
    expect(primaryActions(html)).toEqual([{ label: "Review the NDA", href: undefined }]);
  });

  it("Continue checks only the step being left and answers with the next step; the review checks everything and names the first step with a problem", async () => {
    await signIn("fill-steps@example.com");
    const w9 = { template: "irs-w9", name: "Harbor Plumbing", tax_class: "individual", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ssn", ssn: "900-12-3456" };
    // Step 1 (name) is fine even though step 2 is still empty.
    expect(await fill({}, form({ ...w9, tax_class: "", ssn: "", step: "next", at: "0" }))).toEqual({ at: 1 });
    // Leaving step 2 with its own problems: only those come back, and the form stays on step 2.
    expect(await fill({}, form({ ...w9, tax_class: "", ssn: "12", address: "", step: "next", at: "1" }))).toEqual({
      errors: { tax_class: "Choose one of the options.", ssn: "Enter the SSN as 9 digits, like 123-45-6789." },
      at: 1,
    });
    // The review: every problem, and the form goes to the first step that has one (the address is on step 3).
    expect(await fill({}, form({ ...w9, address: "", step: "review" }))).toEqual({ errors: { address: "Fill this in." }, at: 2 });
    expect(await fill({}, form({ ...w9, name: "", address: "", step: "review" }))).toEqual({ errors: { name: "Fill this in.", address: "Fill this in." }, at: 0 });
  });

  it("an approval refused with a message (the plan's limit) keeps the review in view with the message; a check refused keeps its step", async () => {
    const ctx = await signIn("fill-limit@example.com");
    // The Free plan holds 10 active documents: fill the workspace up.
    await db.root((tx) =>
      tx.query("insert into app.documents (org_id, title, kind) select $1, 'Doc ' || n, 'other' from generate_series(1, 10) n", [ctx.orgId]),
    );
    const w9 = { template: "irs-w9", name: "Harbor Plumbing", tax_class: "individual", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ssn", ssn: "900-12-3456" };
    expect(await fill({}, form({ ...w9, step: "review" }))).toEqual({ review: true });
    // Payments off (no Stripe config in tests): the message doesn't offer Pro; the one fix is a link to the documents list.
    expect(await fill({}, form({ ...w9, ack: "on", at: "3" }))).toEqual({
      error: "The Free plan holds 10 active documents.",
      fix: { href: "/app/documents", label: "Choose one to archive" },
      review: true,
    });
    // Payments on, and this person is the owner: the Pro half comes back; the fix link stays.
    vi.stubEnv("BILLING_ENABLED", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", `sk_test_${"a".repeat(24)}`);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_testsecret123");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_Pro1");
    vi.stubEnv("SHIPSHAPE_APP_URL", "http://127.0.0.1:3917");
    expect(await fill({}, form({ ...w9, ack: "on", at: "3" }))).toEqual({
      error: "The Free plan holds 10 active documents. Or move to Pro for no limit.",
      fix: { href: "/app/documents", label: "Choose one to archive" },
      review: true,
    });
    // A check that can't run (real documents closed) keeps the step the person is on, for Continue and for the review check;
    // a gate message has no fix link.
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    expect(await fill({}, form({ ...w9, step: "next", at: "2" }))).toEqual({ error: expect.any(String), at: 2 });
    expect(await fill({}, form({ ...w9, step: "review", at: "3" }))).toEqual({ error: expect.any(String), at: 3 });
  });

  it("W15-2: past the hourly limit, an approval keeps the review in view with the message and makes nothing", async () => {
    const ctx = await signIn("fill-busy-page@example.com");
    await fillBucket(db, "fill", ctx.userId, 30, 3600);
    const w9 = { template: "irs-w9", name: "Harbor Plumbing", tax_class: "individual", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ssn", ssn: "900-12-3456" };
    expect(await fill({}, form({ ...w9, step: "review" }))).toEqual({ review: true });
    expect(await fill({}, form({ ...w9, ack: "on", at: "3" }))).toEqual({ error: FILL_BUSY, review: true });
    expect(await db.root((tx) => tx.query("select 1 from app.documents where org_id = $1", [ctx.orgId]))).toEqual([]);
  });

  it("W15-2: a full sample's Make page says so instead of offering the form, and an approval posted anyway gets the same sentence", async () => {
    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await finishSignIn(userId, { demo: true });
    const page = () => renderPage(FillPage, { params: Promise.resolve({ template: "common-paper-mnda" }) });
    expect(textOf(await page())).not.toContain(SAMPLE_FULL);
    // 25 more (some archived) make 30 in all.
    await db.root((tx) =>
      tx.query("insert into app.documents (org_id, title, kind, status) select $1, 'Doc ' || n, 'other', case when n % 3 = 0 then 'archived' else 'active' end from generate_series(1, 25) n", [org.id]),
    );
    const html = await page();
    expect(textOf(html)).toContain(SAMPLE_FULL);
    expect(html).not.toContain("<form");
    expect(primaryActions(html)).toEqual([]);
    const t = templateById("common-paper-mnda");
    if (!t) throw new Error("the NDA template is missing");
    const ctx = await requireWorkspace();
    const nda = { ...prefill(t, await factsForFill(ctx), ctx.today), template: t.id, mnda_term: "until_terminated", conf_term: "perpetual", governing_law: "California", jurisdiction: "San Francisco, CA", p2_company: "Northwind", p2_name: "Jordan Lee", p2_notice: "legal@northwind.example" };
    expect(await fill({}, form({ ...nda, ack: "on" }))).toEqual({ error: SAMPLE_FULL, review: true });
  });

  it("checks the values for the review without saving, and stays on the review when only the approval box is missing", async () => {
    await signIn("fill-review@example.com");
    const w9 = { template: "irs-w9", name: "Harbor Plumbing", tax_class: "individual", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ssn", ssn: "900-12-3456" };
    expect(await fill({}, form({ ...w9, step: "review" }))).toEqual({ review: true });
    expect(await fill({}, form({ ...w9, name: "", step: "review" }))).toEqual({ errors: { name: "Fill this in." }, at: 0 });
    expect(await fill({}, form(w9))).toEqual({ errors: { _ack: "Check the box to confirm you've reviewed the document." }, review: true });
    await expect(fill({}, form({ ...w9, ack: "on" }))).rejects.toThrow(/^redirect \/app\/documents\/.+\?made=1$/);
  });
  it("with an EIN saved, the W-9 shows the masked number (never the full one) and no 'also save it' box", async () => {
    const ctx = await signIn("fill-ein@example.com");
    await saveEin(ctx, "12-3456789");
    const html = await renderPage(FillPage, { params: Promise.resolve({ template: "irs-w9" }) });
    expect(html).not.toMatch(/<input[^>]*id="f-ein"/);
    expect(html).not.toContain('name="save_ein"');
    expect(textOf(html)).toContain("••-•••6789");
    expect(html).not.toContain("12-3456789");
  });

  it("after making one, the document's page says it's done, what was kept, and what to do next", async () => {
    const ctx = await signIn("fill-done@example.com");
    const w9 = { name: "Harbor Plumbing", tax_class: "individual", address: "1 Main St", city_state_zip: "Springfield, CA 90000", tin_kind: "ssn", ssn: "900-12-3456" };
    const made = await fillTemplate(ctx, "irs-w9", w9, true, "192.0.2.10");
    const id = made.ok ? made.id : "";
    const html = await renderPage(DocumentPage, {
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({ made: "1" }),
    });
    expect(textOf(html)).toContain(
      "Your W-9 is made and saved here, with where each value came from and your approval in its history. Next: download it and send it to whoever asked for it.",
    );
  });
});

describe("document forms", () => {
  it("put an error next to the field it is about, keep what was typed, and say what to fix", async () => {
    const ctx = await signIn("forms-field@example.com");
    const id = await uploadDocument(ctx, { title: "Lease", kind: "agreement" }, PDF);
    const saved = await saveDetails({}, form({ id, title: " ", kind: "agreement", issuer: "City of Springfield" }));
    expect(saved).toMatchObject({ field: "title", error: "Give the document a title, like “General liability certificate 2026”." });
    expect(saved.values?.issuer).toBe("City of Springfield");
    expect(await addDocument({}, form({ title: "Permit", kind: "permit" }))).toMatchObject({ field: "file", error: "Choose a file to upload." });
  });
});

/** Each date row's field name, and whether it's flagged empty (so it says "Add" instead of mm/dd/yyyy). */
const emptyDates = (html: string) =>
  Object.fromEntries([...html.matchAll(/<span class="date-row"( data-empty="true")?><input [^>]*name="([a-z_]+)"/g)].map((m) => [m[2], Boolean(m[1])]));

describe.each([
  ["earlier (SHIPSHAPE_UI=v1)", "v1"],
  ["redesigned (the default, SHIPSHAPE_UI unset)", ""],
])("Add a document, %s", (_look, ui) => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", ui));
  const addPage = () => renderPage(NewDocumentPage, {});

  it("posts the file and its details under the names addDocument reads, Other preselected, with one button, Add to documents; a sample gets its notice and no form", async () => {
    await signIn(`${ui || "v2"}-add@example.com`);
    const html = await addPage();
    expect([...html.matchAll(/<(?:input|select)\b[^>]*\bname="([a-z_]+)"/g)].map((m) => m[1])).toEqual([
      "file",
      "title",
      "kind",
      "issuer",
      "counterparty",
      "issued_on",
      "expires_on",
      "renews_on",
    ]);
    expect(/<input [^>]*name="file"[^>]*>/.exec(html)?.[0]).toContain('accept="application/pdf,image/png,image/jpeg"');
    expect(html).toMatch(/<option value="other" selected="">Other<\/option>/);
    expect([...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])).toEqual(["Add to documents"]);
    expect(textOf(html)).toContain("PDF, PNG or JPEG, up to 4 MB.");
    expect(textOf(html)).toContain("Files are stored privately for your workspace.");
    // The redesigned rows' placeholder only says "Add", so the required Title says so as the fill form does (hidden from
    // screen readers, which hear `required`); the earlier form is as it was. Both keep `required`.
    if (ui === "v1") expect(html).not.toContain("(required)");
    else expect(html).toContain('<label for="title">Title<span aria-hidden="true" class="text-ink-3"> (required)</span></label>');
    expect(/<input [^>]*name="title"[^>]*>/.exec(html)?.[0]).toContain('required=""');

    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await finishSignIn(userId, { demo: true });
    const sample = await addPage();
    expect(textOf(sample)).toContain("This is a sample workspace, so it can't take real files.");
    expect(sample).not.toContain('name="file"');
  });
});

describe("Add a document, redesigned only", () => {
  it("one file control, named by its row and opened by Choose a file; every empty row says Add, the dates too; Add to documents docked on the phone", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v2");
    await signIn("v2-add-look@example.com");
    const html = await renderPage(NewDocumentPage, {});
    expect(html).toMatch(/^<div class="mx-auto max-w-\[720px\] space-y-6">/);
    expect(html).not.toContain('class="card"');
    expect(html.match(/type="file"/g)).toHaveLength(1);
    const file = /<input [^>]*name="file"[^>]*>/.exec(html)?.[0] ?? "";
    expect(file).toContain('class="peer sr-only"');
    // Named "File Choose a file": the row's label and the visible button, so a spoken "Choose a file" finds it (WCAG 2.5.3).
    expect(file).toContain('aria-labelledby="file-label file-action"');
    expect(html).toMatch(/<span id="file-label"[^>]*>File<\/span>/);
    expect(html).toMatch(/<label id="file-action" for="file" class="btn-ghost press[^"]*">Choose a file<\/label>/);
    const hint = (name: string) => /placeholder="([^"]*)"/.exec(new RegExp(`<input [^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "")?.[1];
    expect(["title", "issuer", "counterparty"].map(hint)).toEqual(["Add", "Add", "Add"]);
    expect(emptyDates(html)).toEqual({ issued_on: true, expires_on: true, renews_on: true });
    expect(html.match(/<span aria-hidden="true" class="date-add">Add<\/span>/g)).toHaveLength(3);
    expect(html).toMatch(/<div class="save-dock sticky[^"]*"><button class="btn press w-full md:w-auto">Add to documents<\/button>/);
  });

  it("the file control is described by the chosen file's name once there is one, then the size hint, then any error", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v2");
    await signIn("v2-add-file-name@example.com");
    // Nothing chosen on the server's render: the hint alone, and no name to point at.
    const html = await renderPage(NewDocumentPage, {});
    expect(/<input [^>]*name="file"[^>]*>/.exec(html)?.[0]).toContain('aria-describedby="file-hint"');
    expect(html).not.toContain('id="file-name"');
    // Chosen (the name span, id file-name, shows): its name is read with "File Change".
    expect(fileRowDescribedBy(true, false)).toBe("file-name file-hint");
    expect(fileRowDescribedBy(true, true)).toBe("file-name file-hint file-error");
    expect(fileRowDescribedBy(false, true)).toBe("file-hint file-error");
  });
});

describe("a document's page", () => {
  const documentPage = (id: string, searchParams: { error?: string; added?: string }) => renderPage(DocumentPage, { params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

  it("after adding a document says it's done and that its expiry date is the next step", async () => {
    const ctx = await signIn("doc-added@example.com");
    const id = await uploadDocument(ctx, { title: "Business license", kind: "license" }, PDF);
    expect(textOf(await documentPage(id, { added: "1" }))).toContain(
      "Added to your documents as version 1. Every view and download goes into its history. Next: add its expiry date under Details, so Home can warn you before it lapses.",
    );
  });

  it("after adding one with an expiry date, says where it stands on Home: later, already inside the 30 days, or lapsed (Design)", async () => {
    const ctx = await signIn("doc-added-dates@example.com");
    const day = (n: number) => new Date(Date.parse(ctx.today) + n * 86_400_000).toISOString().slice(0, 10);
    const head = "Added to your documents as version 1. Every view and download goes into its history.";
    // The notice's last sentence, which ends at the first full stop after the head (dates carry none).
    const said = async (expires_on: string) => {
      const id = await uploadDocument(ctx, { title: "Business license", kind: "license", expires_on }, PDF);
      const text = textOf(await documentPage(id, { added: "1" }));
      const start = text.indexOf(head);
      return start < 0 ? text : text.slice(start, text.indexOf(".", start + head.length + 1) + 1);
    };
    expect(await said(day(90))).toBe(`${head} Next: it shows under Needs attention on Home 30 days before it expires on ${fmtDay(day(90))}.`);
    expect(await said(day(10))).toBe(`${head} It expires on ${fmtDay(day(10))}, so it's already under Needs attention on Home.`);
    expect(await said(day(-10))).toBe(`${head} It expired on ${fmtDay(day(-10))}, so it's under Needs attention on Home.`);
  });

  it("lists a passport visitor's download in History, labelled as such (wave 8 #3)", async () => {
    const ctx = await signIn("doc-history-link@example.com");
    const id = await uploadDocument(ctx, { title: "Business license", kind: "license" }, PDF);
    const { id: linkId, token } = await createPassport(ctx, { label: "Northwind", days: 7, documentIds: [id] });
    expect(await passportFileUrl(linkId, token, id, "198.51.100.9")).toBeTruthy();
    const history = /<ol[^>]*>([\s\S]*?)<\/ol>/.exec((await documentPage(id, {})).split("History")[1] ?? "")?.[1] ?? "";
    expect(textOf(history)).toContain("Downloaded through a passport link: Northwind");
  });

  it("shows History and Versions times where the owner is, with the zone's name; UTC when the browser hasn't said (Design, wave 8)", async () => {
    const ctx = await signIn("doc-times@example.com");
    const id = await uploadDocument(ctx, { title: "Business license", kind: "license" }, PDF);
    // Added at 03:30 UTC on Nov 1: the evening of Oct 31 in Los Angeles, the afternoon of Nov 1 in Tokyo.
    await db.root(async (tx) => {
      await tx.query("update app.audit_log set at = '2026-11-01 03:30:00+00' where org_id = $1 and object_id = $2", [ctx.orgId, id]);
      await tx.query("update app.document_versions set created_at = '2026-11-01 03:30:00+00' where document_id = $1", [id]);
    });
    jar.set("ss_tz", { value: "America/Los_Angeles" });
    const html = await documentPage(id, {});
    expect(textOf(html)).toContain("Added to documents Oct 31, 2026, 8:30 PM PDT");
    expect(textOf(html)).toContain("Version 1 · Oct 31, 2026, 8:30 PM PDT · 1 KB");
    expect(html).toContain("1\u00A0KB"); // a non-breaking space: "1 KB" stays on one line at 390 wide (textOf folds it)
    jar.set("ss_tz", { value: "Asia/Tokyo" });
    expect(textOf(await documentPage(id, {}))).toContain("Added to documents Nov 1, 2026, 12:30 PM GMT+9");
    jar.delete("ss_tz");
    expect(textOf(await documentPage(id, {}))).toContain("Added to documents Nov 1, 2026, 3:30 AM UTC");
  });

  it("at the plan's limit says why the document stays archived and links to the one fix", async () => {
    const ctx = await signIn("doc-limit@example.com");
    const id = await uploadDocument(ctx, { title: "Old permit", kind: "permit" }, PDF);
    const html = await documentPage(id, { error: "limit" });
    expect(textOf(html)).toContain("The Free plan holds 10 active documents, so this one stays archived. Archive another one, then restore this one.");
    expect(actionsOf(html).filter((a) => a.label === "Choose one to archive")).toEqual([{ tag: "a", label: "Choose one to archive", href: "/app/documents" }]);
  });

  it("redesigned: archive and restore have somewhere for focus to land, the Archived block or the heading (tabIndex -1), and a status that's always there to say which; the earlier page as it was", async () => {
    const ctx = await signIn("doc-archive-landing@example.com");
    const id = await uploadDocument(ctx, { title: "Old permit", kind: "permit" }, PDF);
    const active = await documentPage(id, {});
    expect(active).toMatch(/<h1 id="document-title" tabindex="-1" class="page-title"[^>]*>Old permit<\/h1>/);
    // Empty on a first load: it speaks only once the page changes status while open.
    expect(active).toContain('<p role="status" class="sr-only"></p>');
    await setArchived(ctx, id, true);
    expect(await documentPage(id, {})).toMatch(/<div id="archived" tabindex="-1" class="space-y-2 rounded-2xl border border-line p-4"><form/);
    vi.stubEnv("SHIPSHAPE_UI", "v1");
    const v1 = await documentPage(id, {});
    expect(v1).not.toContain('id="archived"');
    expect(v1).not.toContain('id="document-title"');
  });

  it("withdrawing a signature request asks first: the question names the signer, with Withdraw the request and Cancel", async () => {
    const ctx = await signIn("doc-withdraw@example.com");
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const id = await uploadDocument(ctx, { title: "Mutual NDA", kind: "nda" }, await pdf.save());
    // Asking for signatures is part of Pro.
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_W1', 'active', 'pro')", [ctx.orgId]));
    await requestSignature(ctx, { documentId: id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 }, "192.0.2.10");
    const html = await documentPage(id, {});
    // Step 1 shows; step 2 is in the page, hidden until Withdraw is pressed.
    expect(html).toMatch(/<button type="button" class="[^"]*">Withdraw<\/button>/);
    const step2 = /<form\b([^>]*)>([\s\S]*?)<\/form>/.exec(html.slice(html.indexOf(">Withdraw</button>")));
    expect(step2?.[1]).toMatch(/\bhidden=""/);
    expect(textOf(step2?.[2] ?? "")).toBe("Withdraw this request? Jordan Lee won't be able to sign. You can make a new link any time. Withdraw the request Cancel");
  });

  it("while a signing request is open: the Add version field warns, archiving asks first (Archive and withdraw / Keep it), and a new version says what it withdrew (wave 8 #2, #7)", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier page's markup; the redesigned page's own test is under "redesigned"
    const ctx = await signIn("doc-open-request@example.com");
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const bytes = await pdf.save();
    const id = await uploadDocument(ctx, { title: "Mutual NDA", kind: "nda" }, bytes);
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_W2', 'active', 'pro')", [ctx.orgId]));
    // Without an open request: no warning, and Archive document is a plain link with no question.
    const plain = await documentPage(id, {});
    expect(plain).not.toContain("version-file-warning");
    expect(plain).toMatch(/<button class="inline-flex[^"]*"[^>]*>Archive document<\/button>/);
    expect(plain).not.toContain("Archive and withdraw");

    await requestSignature(ctx, { documentId: id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 }, "192.0.2.10");
    const html = await documentPage(id, {});
    expect(textOf(/<p id="version-file-warning"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "")).toBe("Adding a version withdraws the open signing request for Jordan Lee.");
    expect(html).toMatch(/<input[^>]*id="version-file"[^>]*aria-describedby="version-file-warning"/);
    expect(html).toMatch(/<button type="button" class="btn-ghost">Archive document<\/button>/);
    const step2 = /<form\b([^>]*)>([\s\S]*?)<\/form>/.exec(html.slice(html.indexOf(">Archive document</button>")));
    expect(step2?.[1]).toMatch(/\bhidden=""/);
    expect(textOf(step2?.[2] ?? "")).toBe(
      "Archiving withdraws the open signing request for Jordan Lee. Restoring the document won't bring it back; you'd send it again. Archive and withdraw Keep it",
    );
    expect(step2?.[2]).toMatch(/<button[^>]*class="btn-danger"[^>]*>Archive and withdraw<\/button>/);

    // A second signer: the sentences count the others, newest request first as the list shows them.
    await requestSignature(ctx, { documentId: id, signerName: "Sam Ortiz", signerEmail: "sam@northwind.example", days: 7 }, "192.0.2.10");
    const two = await documentPage(id, {});
    expect(textOf(two)).toContain("Adding a version withdraws the open signing requests for Sam Ortiz and 1 other.");
    expect(textOf(two)).toContain("Archiving withdraws the open signing requests for Sam Ortiz and 1 other. Restoring the document won't bring them back; you'd send them again.");

    // The new version withdraws both and says so; the page then shows no warning and the plain link again.
    const data = form({ id });
    data.set("file", new File([PDF], "v2.pdf", { type: "application/pdf" }));
    expect(await addVersion({}, data)).toEqual({
      saved: true,
      savedText: "Version 2 added. The open signing requests for Sam Ortiz and 1 other were for version 1, so they were withdrawn. Send them for signature again to sign this version.",
    });
    const after = await documentPage(id, {});
    expect(after).not.toContain("version-file-warning");
    expect(after).not.toContain("Archive and withdraw");
    expect(textOf(after)).toContain("Withdrawn");
  });

  it("on passport links that still work, Archive says first that it takes the document off them for good, in the confirm too; archived, the page says restoring won't put it back (W14-3)", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier page's markup; the redesigned page's own test is under "redesigned"
    const ctx = await signIn("doc-archive-links@example.com");
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const id = await uploadDocument(ctx, { title: "Liability certificate", kind: "coi" }, await pdf.save());
    // Pro: more than one open link, and signing requests.
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_W14', 'active', 'pro')", [ctx.orgId]));
    const line = (html: string) => textOf(/<p class="text-xs text-ink-3">(Archiving takes it off[\s\S]*?)<\/p>/.exec(html)?.[1] ?? "");
    expect(line(await documentPage(id, {}))).toBe("");

    await createPassport(ctx, { label: "Northwind", days: 7, documentIds: [id] });
    expect(line(await documentPage(id, {}))).toBe("Archiving takes it off 1 passport link for good; restoring won't add it back.");
    const off = await createPassport(ctx, { label: "Turned off", days: 7, documentIds: [id] });
    await revokePassport(ctx, off.id);
    await createPassport(ctx, { label: "Acme", days: 30, documentIds: [id] });
    expect(line(await documentPage(id, {}))).toBe("Archiving takes it off 2 passport links for good; restoring won't add it back.");

    // With a signing request open, the confirm carries the same sentence.
    await requestSignature(ctx, { documentId: id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 }, "192.0.2.10");
    const html = await documentPage(id, {});
    const step2 = /<form\b([^>]*)>([\s\S]*?)<\/form>/.exec(html.slice(html.indexOf(">Archive document</button>")));
    expect(textOf(step2?.[2] ?? "")).toBe(
      "Archiving withdraws the open signing request for Jordan Lee. Restoring the document won't bring it back; you'd send it again. Archiving takes it off 2 passport links for good; restoring won't add it back. Archive and withdraw Keep it",
    );

    await setArchived(ctx, id, true);
    const archived = await documentPage(id, {});
    expect(line(archived)).toBe("");
    expect(textOf(archived)).toContain(
      "This document is archived. It keeps its history and was taken off your passport links; it isn't reminded about or open for signing. Restoring it won't put it back on any link.",
    );
  });

  it("past 50 history entries, says it shows the latest 50 and that the export has every one; at 50, says nothing (W15-5)", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier page's markup; the redesigned page's own test is under "redesigned"
    const ctx = await signIn("doc-long-history@example.com");
    const id = await uploadDocument(ctx, { title: "Lease", kind: "agreement" }, PDF);
    const note = "Showing the latest 50 entries. Your export has every one.";
    const entries = (html: string) => (/<h2[^>]*>History<\/h2>\s*<ol[^>]*>([\s\S]*?)<\/ol>/.exec(html)?.[1].match(/<li\b/g) ?? []).length;
    const view = () => asUser(ctx.userId, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $2)", [ctx.orgId, id]));
    for (let i = entries(await documentPage(id, {})); i < 50; i++) await view();
    const full = await documentPage(id, {});
    expect(entries(full)).toBe(50);
    expect(textOf(full)).not.toContain(note);
    await view();
    const over = await documentPage(id, {});
    expect(entries(over)).toBe(50);
    expect(textOf(over)).toContain(`${note} Entries can't be edited or deleted through ShipShape, and each is linked to the one before it.`);
  });

  describe("redesigned (SHIPSHAPE_UI=v2)", () => {
    beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", "v2"));
    /** The primary (a `btn press` link; its width utilities are layout, not the contract) and the round actions, as label + href. */
    const primary = (html: string) => [...html.matchAll(/<a class="btn press(?: [^"]*)?" href="([^"]*)">([^<]*)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
    const actions = (html: string) => {
      const group = /<div role="group" aria-label="Actions"[^>]*>([\s\S]*?)<\/div><section/.exec(html)?.[1] ?? "";
      return [...group.matchAll(/<(a|button)\b([^>]*class="round-action press"[^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => textOf(m[3]));
    };

    it("in the default look, says what Add a version and Archive would withdraw or take off links, and that the history shows the latest 50", async () => {
      vi.stubEnv("SHIPSHAPE_UI", "");
      const ctx = await signIn("doc-warnings-v2@example.com");
      const pdf = await PDFDocument.create();
      pdf.addPage([612, 792]);
      const id = await uploadDocument(ctx, { title: "Mutual NDA", kind: "nda" }, await pdf.save());
      await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_W2v2', 'active', 'pro')", [ctx.orgId]));
      const plain = textOf(await documentPage(id, {}));
      expect(plain).not.toMatch(/withdraws the open signing request|Archiving takes it off/);

      await createPassport(ctx, { label: "Northwind", days: 7, documentIds: [id] });
      await requestSignature(ctx, { documentId: id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 }, "192.0.2.10");
      const html = await documentPage(id, {});
      expect(textOf(/<p id="version-file-warning"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "")).toBe("Adding a version withdraws the open signing request for Jordan Lee.");
      expect(html).toMatch(/<input[^>]*id="version-file"[^>]*aria-describedby="version-file-warning"/);
      expect(textOf(html)).toContain(
        "Archiving withdraws the open signing request for Jordan Lee. Restoring the document won't bring it back; you'd send it again. Archiving takes it off 1 passport link for good; restoring won't add it back. Archive and withdraw Keep it",
      );

      const note = "Showing the latest 50 entries. Your export has every one.";
      expect(textOf(html)).not.toContain(note);
      const view = () => asUser(ctx.userId, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $2)", [ctx.orgId, id]));
      for (let i = 0; i < 50; i++) await view();
      expect(textOf(await documentPage(id, {}))).toContain(note);
    });

    it("leads with one primary, Share in a link, which ticks this document on the passport page; Details are one list with the saved dates", async () => {
      const ctx = await signIn("doc-v2@example.com");
      const id = await uploadDocument(ctx, { title: "Business license", kind: "license", expires_on: "2030-01-31" }, PDF);
      const html = await documentPage(id, {});
      expect(primary(html)).toEqual([`Share in a link /app/passport?docs=${id}`]);
      // An upload downloads rather than opening, and a license isn't something that gets signed.
      expect(actions(html)).toEqual(["Download", "More"]);
      const expires = /<input [^>]*id="expires_on"[^>]*>/.exec(html)?.[0] ?? "";
      expect(expires).toContain('type="date"');
      expect(expires).toContain('value="2030-01-31"');
      // An empty date says "Add" (the row is flagged empty); a saved one shows its date.
      expect(emptyDates(html)).toEqual({ issued_on: true, expires_on: false, renews_on: true });
      expect(html).not.toContain('id="signatures"');
      // Who issues a license, as the Issued by field's hint.
      expect(/<input [^>]*id="issuer"[^>]*>/.exec(html)?.[0]).toContain('placeholder="Agency or city"');
      vi.stubEnv("SHIPSHAPE_UI", "v1");
      expect(primary(await documentPage(id, {}))).toEqual([]);
    });

    it("offers Ask to sign only on the kinds that get signed; it lands on the signer's name, in the same grouped rows as Details", async () => {
      const ctx = await signIn("doc-v2-nda@example.com");
      const id = await uploadDocument(ctx, { title: "Mutual NDA", kind: "nda" }, PDF);
      const html = await documentPage(id, {});
      expect(actions(html)).toEqual(["Download", "Ask to sign", "More"]);
      expect(html).toContain('href="#signer-name"');
      const signatures = html.slice(html.indexOf('<section id="signatures"'));
      const rows = /<ul class="group-list plain">([\s\S]*?)<\/ul>/.exec(signatures)?.[1] ?? "";
      // Name and email say "(required)", as the fill form does: their placeholders don't.
      expect([...rows.matchAll(/<label for="([^"]*)">([\s\S]*?)<\/label>/g)].map((m) => `${m[1]} ${textOf(m[2])}`)).toEqual([
        "signer-name Signer's name (required)",
        "signer-email Signer's email (required)",
        "sign-days Open for",
      ]);
      expect(/<input [^>]*id="signer-name"[^>]*>/.exec(html)?.[0]).toContain('class="row-field');
      expect(/<input [^>]*id="signer-email"[^>]*>/.exec(html)?.[0]).toContain('placeholder="name@company.com"');
      expect(/<input [^>]*id="issuer"[^>]*>/.exec(html)?.[0]).toContain('placeholder="The other company"');
      // Today's page keeps its boxed form.
      vi.stubEnv("SHIPSHAPE_UI", "v1");
      expect(/<input [^>]*id="signer-name"[^>]*>/.exec(await documentPage(id, {}))?.[0]).toContain('class="input"');
    });

    it("an archived document says so in place of the primary and offers Restore; nothing to share and no More", async () => {
      const ctx = await signIn("doc-v2-archived@example.com");
      const id = await uploadDocument(ctx, { title: "Old permit", kind: "permit" }, PDF);
      await setArchived(ctx, id, true);
      const html = await documentPage(id, {});
      expect(primary(html)).toEqual([]);
      expect(actions(html)).toEqual(["Download"]);
      const restore = /<form[^>]*>([\s\S]*?)<\/form>/.exec(html.slice(html.indexOf(">Archived<") - 400))?.[1] ?? "";
      expect(restore).toContain('name="archived" value="0"');
      expect(textOf(restore)).toContain("Archived Restore");
    });

    it("History opens on the latest five entries and keeps the rest behind Show all N", async () => {
      const ctx = await signIn("doc-v2-history@example.com");
      const id = await uploadDocument(ctx, { title: "Lease", kind: "agreement" }, PDF);
      // An upload writes two entries (added, version 1); five views make seven.
      for (let i = 0; i < 5; i++) await asUser(ctx.userId, (tx) => tx.query("select app.audit_append($1, 'document.viewed', $2)", [ctx.orgId, id]));
      const html = await documentPage(id, {});
      const history = html.slice(html.indexOf("History (7)"));
      const lists = [...history.matchAll(/<ol>([\s\S]*?)<\/ol>/g)].map((m) => (m[1].match(/<li\b/g) ?? []).length);
      expect(lists).toEqual([5, 2]);
      expect(textOf(history)).toMatch(/^History \(7\) .* Show all 7 /);
    });

    it("marks the state chip for the in-place crossfade, and only Expires soon for its one pulse", async () => {
      const ctx = await signIn("doc-v2-motion@example.com");
      const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      const expiring = await uploadDocument(ctx, { title: "Liability certificate", kind: "coi", expires_on: soon }, PDF);
      const current = await uploadDocument(ctx, { title: "Contractor license", kind: "license", expires_on: "2030-01-31" }, PDF);
      const chip = (html: string) => /<span [^>]*vt-update="v2-chip"[^>]*>/.exec(html)?.[0] ?? "";
      expect(chip(await documentPage(expiring, {}))).toContain("data-pulse");
      const ok = chip(await documentPage(current, {}));
      expect(ok).toContain("bg-ok-soft");
      expect(ok).not.toContain("data-pulse");
    });

    it("a signature request's state is the app's dot chip and crossfades in place; the current look keeps a plain label", async () => {
      const ctx = await signIn("doc-v2-sign-label@example.com");
      const pdf = await PDFDocument.create();
      pdf.addPage([612, 792]);
      const id = await uploadDocument(ctx, { title: "Mutual NDA", kind: "nda" }, await pdf.save());
      // Asking for signatures is part of Pro.
      await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_V2sign', 'active', 'pro')", [ctx.orgId]));
      await requestSignature(ctx, { documentId: id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 }, "192.0.2.10");
      const label = (html: string) => /<span [^>]*>Waiting<\/span>/.exec(html)?.[0] ?? "";
      // Waiting is grey, as on Sent (Design #27 INFO).
      expect(label(await documentPage(id, {}))).toMatch(/^<span class="dot-chip"[^>]*vt-update="v2-chip"/);
      vi.stubEnv("SHIPSHAPE_UI", "v1");
      expect(label(await documentPage(id, {}))).toBe('<span class="shrink-0 text-xs text-ink-2">Waiting</span>');
    });

    it("a success notice carries the check it draws; empty rows say they can be filled", async () => {
      const ctx = await signIn("doc-v2-notice@example.com");
      const id = await uploadDocument(ctx, { title: "Site photo", kind: "other" }, PDF);
      const html = await documentPage(id, { added: "1" });
      const notice = /<div class="notice-ok[^"]*">([\s\S]*?)<\/div><\/div>/.exec(html)?.[1] ?? "";
      expect(notice).toMatch(/^<svg class="notice-icon"[^>]*aria-hidden="true"/);
      expect(textOf(notice)).toMatch(/^Added to your documents as version 1\./);
      const hint = (field: string) => /placeholder="([^"]*)"/.exec(new RegExp(`<input [^>]*id="${field}"[^>]*>`).exec(html)?.[0] ?? "")?.[1];
      // Nobody obvious issues an "other" document, so its Issued by just says it can be filled.
      expect([hint("issuer"), hint("counterparty")]).toEqual(["Add", "Add"]);
    });
  });
});

describe("error and not-found pages", () => {
  it("an error says in one line what happened, offers one button and where to write, and keeps the reference small", async () => {
    const html = await renderPage(ErrorPanel, { digest: "abc123", reset: () => {} });
    expect(textOf(html)).toBe("This page didn't load because of a problem on our side. Try again Still not working? Write to us and quote this reference. Reference for support: abc123");
    expect(actionsOf(html)).toEqual([
      { tag: "button", label: "Try again", href: undefined },
      { tag: "a", label: "Write to us", href: "/faq#support" },
    ]);
  });

  it("a missing document links back to the documents list, and nothing else", async () => {
    at.path = "/app/documents/00000000-0000-4000-8000-000000000000";
    const html = await renderPage(AppNotFound, {});
    expect(textOf(html)).toContain("This isn't in your workspace");
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Back to your documents", href: "/app/documents" }]);
  });
});
