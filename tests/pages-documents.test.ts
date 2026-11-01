import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import DocumentPage from "@/app/app/documents/[id]/page";
import { addDocument, saveDetails } from "@/app/app/documents/actions";
import DocumentsPage from "@/app/app/documents/page";
import FactsPage from "@/app/app/facts/page";
import FillPage from "@/app/app/make/[template]/page";
import { fill } from "@/app/app/make/actions";
import AppNotFound from "@/app/app/not-found";
import AppHome from "@/app/app/page";
import { ErrorPanel } from "@/components/error-panel";
import { DOCUMENTS_PAGE_SIZE, fillTemplate, uploadDocument } from "@/lib/server/documents";
import { requestSignature } from "@/lib/server/esign";
import { saveEin } from "@/lib/server/profile";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";
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

const documentsPage = (searchParams: { q?: string; kind?: string; archived?: string; page?: string }) => renderPage(DocumentsPage, { searchParams: Promise.resolve(searchParams) });

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

  it("with no documents and uploads not open yet: Fill your first W-9 only, no link to the closed upload page", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    await signIn("docs-empty-closed@example.com");
    const html = await documentsPage({});
    expect(primaryActions(html)).toEqual([{ label: "Fill your first W-9", href: "/app/make/irs-w9" }]);
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Upload a document");
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
    const ctx = await signIn("docs-archived@example.com");
    await uploadDocument(ctx, { title: "Business license", kind: "license" }, PDF);
    const html = await documentsPage({ archived: "1" });
    const text = textOf(html);
    expect(text).toContain("No archived documents");
    expect(text).toContain("Documents you archive will be listed here");
    expect(primaryActions(html)).toEqual([{ label: "Go to current documents", href: "/app/documents" }]);
    expect(actionsOf(html).filter((a) => a.href === "/app/documents")).toHaveLength(1);
  });

  it("on Pro, lists 50 documents at a time in the list's order, says which are shown, and pages with the filter kept; a page past the end shows the last", async () => {
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
});

const homePage = () => renderPage(AppHome, {});

describe("home", () => {
  it("on a first visit teaches what will appear, counts only real progress, and offers one action: the next step", async () => {
    await signIn("home-first@example.com");
    const html = await homePage();
    const text = textOf(html);
    expect(text).toContain("0 of 6 done");
    expect(text).toContain("this page lists only what needs you");
    expect(text).toContain("Documents that have expired or expire in the next 30 days will be listed here");
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
    expect(text).toContain("It has lapsed. Renew it with the issuer, then add the new copy and its new date, so your passport links share the current one.");
    expect(text).not.toContain("Nothing has expired");
    const attention = html.slice(html.indexOf("Needs attention"));
    expect(actionsOf(attention).filter((a) => a.href?.startsWith(`/app/documents/${id}`))).toEqual([
      { tag: "a", label: "Add the renewed copy", href: `/app/documents/${id}#version-file` },
    ]);
  });

  it("on Pro with many lapsing documents: lists the 20 soonest, counts them all, and points at the list for the rest", async () => {
    const ctx = await signIn("home-many@example.com");
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_HomeMany', 'active', 'pro')", [ctx.orgId]));
    // 22 lapsing (days 1..22 from today), 3 current (one dated far off, two undated).
    await db.root(async (tx) => {
      for (let i = 1; i <= 22; i++) {
        await tx.query("insert into app.documents (org_id, title, kind, expires_on) values ($1, $2, 'license', current_date + $3::int)", [ctx.orgId, `License ${String(i).padStart(2, "0")}`, i]);
      }
      await tx.query("insert into app.documents (org_id, title, kind, expires_on) values ($1, 'Far-off permit', 'permit', current_date + 400)", [ctx.orgId]);
      await tx.query("insert into app.documents (org_id, title, kind) values ($1, 'Undated A', 'other'), ($1, 'Undated B', 'other')", [ctx.orgId]);
    });
    const html = await homePage();
    const text = textOf(html);
    expect(text).toMatch(/3 of 25 documents current/);
    expect(text).toContain("License 01");
    expect(text).toContain("License 20");
    expect(text).not.toContain("License 21");
    expect(text).toContain("The 20 soonest are listed; 2 more need attention.");
    expect(actionsOf(html).filter((a) => a.label === "See all documents")).toEqual([{ tag: "a", label: "See all documents", href: "/app/documents" }]);
    // The setup list reads the same summary: a document exists, with a date, and the first in list order is the soonest.
    expect(text).not.toContain("Add an expiry date (to do)");
  });

  it("with up to 20 lapsing documents lists them all and says nothing about more; at 21 it says '1 more needs attention'", async () => {
    const ctx = await signIn("home-twenty@example.com");
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_HomeTwenty', 'active', 'pro')", [ctx.orgId]));
    await db.root((tx) =>
      tx.query("insert into app.documents (org_id, title, kind, expires_on) select $1, 'Permit ' || lpad(n::text, 2, '0'), 'permit', current_date + n from generate_series(1, 20) n", [ctx.orgId]),
    );
    const text = textOf(await homePage());
    expect(text).toMatch(/0 of 20 documents current/);
    expect(text).toContain("Permit 01");
    expect(text).toContain("Permit 20");
    expect(text).not.toContain("need attention");
    await db.root((tx) => tx.query("insert into app.documents (org_id, title, kind, expires_on) values ($1, 'Permit 21', 'permit', current_date + 21)", [ctx.orgId]));
    expect(textOf(await homePage())).toContain("The 20 soonest are listed; 1 more needs attention.");
  });
});

describe("business facts", () => {
  it("with nothing confirmed says so, what the facts are for, and offers one action: save them", async () => {
    await signIn("facts-empty@example.com");
    const html = await renderPage(FactsPage, {});
    expect(textOf(html)).toContain("Nothing is confirmed yet: fill in what you know, then choose Save and confirm.");
    expect(primaryActions(html)).toEqual([{ label: "Save and confirm", href: undefined }]);
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
    const made = await fillTemplate(ctx, "irs-w9", w9, true);
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

describe("a document's page", () => {
  const documentPage = (id: string, searchParams: { error?: string; added?: string }) => renderPage(DocumentPage, { params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

  it("after adding a document says it's done and that its expiry date is the next step", async () => {
    const ctx = await signIn("doc-added@example.com");
    const id = await uploadDocument(ctx, { title: "Business license", kind: "license" }, PDF);
    expect(textOf(await documentPage(id, { added: "1" }))).toContain(
      "Added to your documents as version 1. Every view and download goes into its history. Next: add its expiry date under Details, so Home can warn you before it lapses.",
    );
  });

  it("at the plan's limit says why the document stays archived and links to the one fix", async () => {
    const ctx = await signIn("doc-limit@example.com");
    const id = await uploadDocument(ctx, { title: "Old permit", kind: "permit" }, PDF);
    const html = await documentPage(id, { error: "limit" });
    expect(textOf(html)).toContain("The Free plan holds 10 active documents, so this one stays archived. Archive another one, then restore this one.");
    expect(actionsOf(html).filter((a) => a.label === "Choose one to archive")).toEqual([{ tag: "a", label: "Choose one to archive", href: "/app/documents" }]);
  });

  it("withdrawing a signature request asks first: the question names the signer, with Withdraw the request and Cancel", async () => {
    const ctx = await signIn("doc-withdraw@example.com");
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const id = await uploadDocument(ctx, { title: "Mutual NDA", kind: "nda" }, await pdf.save());
    // Asking for signatures is part of Pro.
    await db.root((tx) => tx.query("insert into app.billing (org_id, stripe_customer_id, status, plan) values ($1, 'cus_W1', 'active', 'pro')", [ctx.orgId]));
    await requestSignature(ctx, { documentId: id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 });
    const html = await documentPage(id, {});
    // Step 1 shows; step 2 is in the page, hidden until Withdraw is pressed.
    expect(html).toMatch(/<button type="button" class="[^"]*">Withdraw<\/button>/);
    const step2 = /<form\b([^>]*)>([\s\S]*?)<\/form>/.exec(html.slice(html.indexOf(">Withdraw</button>")));
    expect(step2?.[1]).toMatch(/\bhidden=""/);
    expect(textOf(step2?.[2] ?? "")).toBe("Withdraw this request? Jordan Lee won't be able to sign. You can make a new link any time. Withdraw the request Cancel");
  });
});

describe("error and not-found pages", () => {
  it("an error says in one line what happened, offers one button, and keeps the reference small", async () => {
    const html = await renderPage(ErrorPanel, { digest: "abc123", reset: () => {} });
    expect(textOf(html)).toBe("This page didn't load because of a problem on our side. Try again Reference for support: abc123");
    expect(actionsOf(html)).toEqual([{ tag: "button", label: "Try again", href: undefined }]);
  });

  it("a missing document links back to the documents list, and nothing else", async () => {
    at.path = "/app/documents/00000000-0000-4000-8000-000000000000";
    const html = await renderPage(AppNotFound, {});
    expect(textOf(html)).toContain("This isn't in your workspace");
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Back to your documents", href: "/app/documents" }]);
  });
});
