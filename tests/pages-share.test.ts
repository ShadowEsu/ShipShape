import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { askAction } from "@/app/app/ask/actions";
import AskPage from "@/app/app/ask/page";
import { addVendorAction } from "@/app/app/collect/actions";
import VendorPage from "@/app/app/collect/[id]/page";
import { GET as documentFile } from "@/app/app/documents/[id]/file/route";
import { VendorLinkReady } from "@/app/app/collect/forms";
import CollectPage from "@/app/app/collect/page";
import DeadlinesPage from "@/app/app/deadlines/page";
import PassportDetail from "@/app/app/passport/[id]/page";
import { makePassport } from "@/app/app/passport/actions";
import { NewPassportForm, PassportReady } from "@/app/app/passport/forms";
import PassportPage from "@/app/app/passport/page";
import PassportPreviewPage from "@/app/app/passport/preview/page";
import { deleteMyAccount, renameMyWorkspace, signOutSession, upgrade } from "@/app/app/settings/actions";
import { DeleteRefused } from "@/app/app/settings/forms";
import SettingsPage from "@/app/app/settings/page";
import { setAiProviderForTests } from "@/lib/server/ai";
import { addVendor, createVendorLink } from "@/lib/server/collect";
import { asService, asUser } from "@/lib/server/db";
import { DOC_KINDS, setArchived } from "@/lib/server/documents";
import { LINKS_BUSY, VENDORS_BUSY } from "@/lib/server/limits";
import { createPassport } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, finishSignIn, newSessionId, RECENT_AUTH_SECONDS, requireWorkspace, startSession, type SignedIn } from "@/lib/server/session";
import { fmtDay, plusDays, todayIn } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { fillBucket } from "./support/rate";
import { actionsOf, renderPage, textOf } from "./support/render";

/** What the sharing pages (Passport, Collect, Deadlines, Settings) show in each state, and the one thing each asks of you. */

// The request's cookies, as Next.js would hold them.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
// Like Next.js, redirect() and notFound() never return.
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

beforeEach(() => vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1"));
afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

/** Signs a new person in to a new (Free) workspace of their own, the way the sign-in page does. */
async function signIn(email: string): Promise<SignedIn> {
  await finishSignIn(await createLocalUser(email, false), { demo: false });
  return requireWorkspace();
}

/** A document in the workspace, expiring in `days` days (none: no expiry). */
async function addDoc(ctx: Ctx, title: string, days: number | null = null): Promise<string> {
  const [row] = await db.root((tx) =>
    tx.query<{ id: string }>("insert into app.documents (org_id, title, kind, expires_on) values ($1, $2, 'coi', current_date + $3::int) returning id", [ctx.orgId, title, days]),
  );
  return row.id;
}

/** The labels of the page's primary buttons and button-styled links (class "btn"; "btn press" in the redesigned app): the one thing it asks of you. */
const primary = (html: string) => [...html.matchAll(/<(a|button)\b[^>]*\bclass="btn(?: press)?"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => textOf(m[2]));

const none = () => ({ searchParams: Promise.resolve({}) });

describe("Passport", () => {
  it("with no documents: says a link needs one and offers only Add a document", async () => {
    await signIn("passport-empty@example.com");
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain("A link shares documents from this workspace, so it needs at least one.");
    expect(primary(html)).toEqual(["Add a document"]);
    expect(actionsOf(html).find((a) => a.label === "Add a document")?.href).toBe("/app/documents/new");
    expect(textOf(html)).not.toContain("make one");
  });

  it("with no documents before real documents open: says why, and offers no way to the closed Add page", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    await signIn("passport-empty-closed@example.com");
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain("A link shares documents from this workspace, so it needs at least one. Adding real documents opens after our security review.");
    expect(primary(html)).toEqual([]);
    expect(actionsOf(html).map((a) => a.href)).not.toContain("/app/documents/new");
  });

  it("with documents and no links yet: shows what a link will look like, and Make the link is the one action", async () => {
    const ctx = await signIn("passport-nolinks@example.com");
    await addDoc(ctx, "Liability certificate");
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain("No links yet");
    expect(textOf(html)).toContain("Each link you make shows here with who it's for, how often it was opened and the day it stops working");
    expect(primary(html)).toEqual(["Make the link"]);
  });

  it("under the 7/30/90-day choice, says the day the link will stop working for the chosen length (30 days at first), counted from today in UTC, not the browser's clock", async () => {
    const ctx = await signIn("passport-enddate@example.com");
    await addDoc(ctx, "Liability certificate");
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain(`7 days 30 days 90 days Stops working on ${fmtDay(plusDays(todayIn("UTC"), 30))}. You can turn it off sooner.`);
    // The form takes the date from the server: with a given day, the end day is fixed whatever the clock says.
    const form = await renderPage(NewPassportForm, { docs: [{ id: "d1", title: "Liability certificate", kindLabel: "Insurance certificate", note: null, holdsTaxId: false }], days: [7, 30, 90], preselected: [], today: "2026-12-31" });
    expect(textOf(form)).toContain("Stops working on Jan 30, 2027.");
  });

  it("before the link exists, says who can open it: how many documents are ticked, that a ticked W-9 shows the full tax id, and what stays private", async () => {
    const ctx = await signIn("passport-who@example.com");
    const coi = await addDoc(ctx, "Liability certificate");
    const [w9] = await db.root((tx) => tx.query<{ id: string }>("insert into app.documents (org_id, title, kind) values ($1, 'Form W-9', 'w9') returning id", [ctx.orgId]));
    const page = (docs?: string) => renderPage(PassportPage, { searchParams: Promise.resolve(docs ? { docs } : {}) });

    const nothing = textOf(await page());
    expect(nothing).toMatch(/Who can open it Anyone who has the link can view and download the documents you tick\s*\. Send it only to the person it's for\s*\./);
    expect(nothing).toContain("They can't see your other documents, business facts or history. You see each time it's opened.");
    expect(nothing).not.toContain("full EIN or SSN");

    const one = textOf(await page(coi));
    expect(one).toMatch(/view and download this document\s*\. Send it only to the person it's for\s*\./);
    expect(one).not.toContain("full EIN or SSN");

    const both = textOf(await page(`${coi},${w9.id}`));
    expect(both).toMatch(/view and download these 2 documents\s*\./);
    expect(both).toContain("Your W-9 shows your full EIN or SSN to whoever opens it.");
  });

  it("offers 'Preview what they'll see' once a document is ticked, carrying the form's state in the address", async () => {
    const ctx = await signIn("passport-preview-link@example.com");
    const coi = await addDoc(ctx, "Liability certificate");
    const untouched = await renderPage(PassportPage, none());
    expect(actionsOf(untouched).map((a) => a.label)).not.toContain("Preview what they'll see");
    const ticked = await renderPage(PassportPage, { searchParams: Promise.resolve({ docs: coi, label: "Northwind onboarding", days: "7" }) });
    expect(actionsOf(ticked).find((a) => a.label === "Preview what they'll see")?.href).toBe(`/app/passport/preview?docs=${coi}&amp;label=Northwind+onboarding&amp;days=7`);
    expect(ticked).toMatch(/<input[^>]*id="label"[^>]*value="Northwind onboarding"/);
    expect(ticked).toMatch(/<input[^>]*name="days"[^>]*checked=""[^>]*value="7"/);
  });

  it("the preview shows the recipient's page for the ticked documents only, from this workspace only, with the owner's own downloads and a way back", async () => {
    const other = await signIn("passport-preview-other@example.com");
    const theirs = await addDoc(other, "Someone else's certificate");
    const ctx = await signIn("passport-preview@example.com");
    const coi = await addDoc(ctx, "Liability certificate", 400);
    // A real document always has a stored copy; the preview's download is that latest copy.
    await db.root((tx) =>
      tx.query(
        "insert into app.document_versions (document_id, version, org_id, storage_path, mime, size_bytes, sha256, origin, created_by) values ($1, 1, $2, $3, 'application/pdf', 9, repeat('a', 64), 'upload', $4)",
        [coi, ctx.orgId, `${ctx.orgId}/${coi}/v1.pdf`, ctx.userId],
      ),
    );
    await addDoc(ctx, "Not ticked");
    const html = await renderPage(PassportPreviewPage, { searchParams: Promise.resolve({ docs: `${coi},${theirs}`, label: "Northwind onboarding", days: "7" }) });
    const text = textOf(html);
    expect(text).toContain("Preview what they'll see");
    expect(text).toContain("Nothing is shared yet: the link doesn't exist until you make it, and these downloads are your own copies.");
    expect(text).toContain(`${ctx.name} Northwind onboarding · this link works until ${fmtDay(new Date(Date.now() + 7 * 86_400_000).toISOString())}`);
    expect(text).toContain("Liability certificate");
    expect(text).not.toContain("Not ticked");
    expect(text).not.toContain("Someone else's certificate");
    // The download is the owner's latest copy through the documents file route: it must redirect to the file, not 404.
    const href = new RegExp(`<a href="(/app/documents/${coi}/file[^"]*)" aria-label="Download Liability certificate"`).exec(html)?.[1]?.replace(/&amp;/g, "&");
    expect(href).toBe(`/app/documents/${coi}/file?v=1&mode=download`);
    await expect(documentFile(new Request(`http://localhost${href}`), { params: Promise.resolve({ id: coi }) })).rejects.toThrow(/^redirect /);
    expect(actionsOf(html).find((a) => a.label === "← Back to the link")?.href).toBe(`/app/passport?docs=${coi}%2C${theirs}&amp;label=Northwind+onboarding&amp;days=7`);
    // One page, one h1: the embedded recipient's page keeps its heading, a level down.
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${ctx.name}</h2>`));

    const empty = textOf(await renderPage(PassportPreviewPage, { searchParams: Promise.resolve({}) }));
    expect(empty).toContain("No documents are ticked yet. Go back and tick at least one.");
  });

  it("with a link: lists it instead of the example", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier page's markup; the redesigned page's own test is under "redesigned"
    const ctx = await signIn("passport-link@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    await createPassport(ctx, { label: "Northwind onboarding", days: 30, documentIds: [doc] });
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain("Northwind onboarding ✓ Working 1 document · opened 0 times");
    expect(textOf(html)).not.toContain("No links yet");
  });

  it("a link past its planned end reads as ended, in neutral colours, not as an expired fault", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier page's markup; the redesigned page's own test is under "redesigned"
    const ctx = await signIn("passport-ended@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const { id } = await createPassport(ctx, { label: "Old link", days: 7, documentIds: [doc] });
    const [row] = await db.root((tx) =>
      tx.query<{ day: string }>("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1 returning expires_at::text as day", [id]),
    );
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain(`Old link ○ Ended ${fmtDay(row.day)} 1 document`);
    expect(textOf(html)).not.toContain("Expired");
    expect(html).toContain('bg-canvas text-ink-3"><span aria-hidden="true">○</span>Ended');
    expect(html).not.toContain("bg-bad-soft");
  });

  it("an expired link offers one fix: a new link with the same documents already chosen", async () => {
    const ctx = await signIn("passport-expired@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const { id } = await createPassport(ctx, { label: "Old link", days: 7, documentIds: [doc] });
    await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [id]));
    const html = await renderPage(PassportDetail, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    expect(textOf(html)).toContain("so nobody can open it. If they still need these documents, make a new link.");
    expect(primary(html)).toEqual(["Make a new link with these documents"]);
    expect(actionsOf(html).find((a) => a.label === "Make a new link with these documents")?.href).toBe(`/app/passport?docs=${doc}`);
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Turn off this link");
  });

  it("turning off a link that was already off says there's nothing more to do", async () => {
    const ctx = await signIn("passport-off@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const { id } = await createPassport(ctx, { label: "Off link", days: 7, documentIds: [doc] });
    await db.root((tx) => tx.query("update app.share_links set revoked_at = now() where id = $1", [id]));
    const html = await renderPage(PassportDetail, { params: Promise.resolve({ id }), searchParams: Promise.resolve({ error: "off" }) });
    expect(textOf(html)).toContain("This link was already off, so nobody can open it. There's nothing more to do.");
    expect(primary(html)).toEqual([]);
  });

  it("shows a link's end on the owner's day, not the UTC day: the list, its badge once ended, and the detail page", async () => {
    const ctx = await signIn("passport-zone@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const { id } = await createPassport(ctx, { label: "West coast", days: 7, documentIds: [doc] });
    // Ends at 01:00 UTC on the 8th: the 7th in Los Angeles, the 8th in Tokyo.
    await db.root((tx) => tx.query("update app.share_links set expires_at = '2026-11-08 01:00:00+00' where id = $1", [id]));
    const detail = () => renderPage(PassportDetail, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    jar.set("ss_tz", "America/Los_Angeles");
    expect(textOf(await detail())).toMatch(/Works until Nov 7, 2026 ?\./);
    expect(textOf(await renderPage(PassportPage, none()))).toContain("until Nov 7, 2026");
    jar.set("ss_tz", "Asia/Tokyo");
    expect(textOf(await detail())).toMatch(/Works until Nov 8, 2026 ?\./);
    expect(textOf(await renderPage(PassportPage, none()))).toContain("until Nov 8, 2026");
    // Once ended, the badge and the detail's notice say the same day.
    await db.root((tx) => tx.query("update app.share_links set created_at = '2026-10-25 01:00:00+00', expires_at = '2026-10-31 02:00:00+00' where id = $1", [id]));
    jar.set("ss_tz", "America/Los_Angeles");
    expect(textOf(await renderPage(PassportPage, none()))).toContain("Ended Oct 30, 2026");
    expect(textOf(await detail())).toMatch(/Expired Oct 30, 2026 ?, so nobody can open it\./);
    // Opens and "Turned off" are instants, shown as the owner's wall-clock time with the zone's name (Design, wave 8).
    await db.root((tx) =>
      tx.query("insert into app.share_access (link_id, org_id, action, visitor, at) values ($1, $2, 'opened', '0123456789abcdef', '2026-10-31 03:30:00+00')", [id, ctx.orgId]),
    );
    expect(textOf(await detail())).toContain("Oct 30, 2026, 8:30 PM PDT");
    // revoked_at is always now() (the lock_revocation trigger), so only the zone and shape can be pinned.
    await db.root((tx) => tx.query("update app.share_links set revoked_at = now() where id = $1", [id]));
    expect(textOf(await detail())).toMatch(/Turned off [A-Z][a-z]{2} \d{1,2}, 20\d\d, \d{1,2}:\d\d [AP]M P[SD]T ?\. Nobody can open it any more\./);
    jar.set("ss_tz", "Asia/Tokyo");
    expect(textOf(await detail())).toMatch(/Turned off [A-Z][a-z]{2} \d{1,2}, 20\d\d, \d{1,2}:\d\d [AP]M GMT\+9 ?\./);
  });

  it("turning off a working link asks first: the question names who loses access, with Turn off the link and Cancel", async () => {
    const ctx = await signIn("passport-confirm@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const { id } = await createPassport(ctx, { label: "Northwind Builders", days: 7, documentIds: [doc] });
    const html = await renderPage(PassportDetail, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    // Step 1 shows; step 2 is in the page, hidden until Turn off this link is pressed.
    expect(html).toMatch(/<button type="button" class="btn-ghost">Turn off this link<\/button>/);
    const step2 = /<form\b([^>]*)>([\s\S]*?)<\/form>/.exec(html.slice(html.indexOf("Turn off this link</button>")));
    expect(step2?.[1]).toMatch(/\bhidden=""/);
    expect(textOf(step2?.[2] ?? "")).toBe("Turn off this link? Northwind Builders won't be able to open it again. You can make a new link any time. Turn off the link Cancel");
    expect(actionsOf(step2?.[2] ?? "").map((a) => a.label)).toEqual(["Turn off the link", "Cancel"]);
  });

  it("a working link whose documents were all archived says it shows nothing, its documents card says why, and it keeps Turn off (W14-3)", async () => {
    const ctx = await signIn("passport-emptied@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const { id } = await createPassport(ctx, { label: "Northwind", days: 7, documentIds: [doc] });
    const detail = () => renderPage(PassportDetail, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
    const notice = "Every document on this link was archived, so it shows nothing. Turn it off, or make a new link.";
    const card = (html: string) => textOf(html.split("Documents on this link</h2>")[1]?.split("</section>")[0] ?? "");
    const before = await detail();
    expect(textOf(before)).not.toContain(notice);
    expect(card(before)).toBe("Liability certificate Insurance certificate");
    await setArchived(ctx, doc, true);
    const html = await detail();
    expect(textOf(html)).toContain(notice);
    expect(card(html)).toBe("None left. Archived documents come off for good.");
    expect(actionsOf(html).map((a) => a.label)).toContain("Turn off this link");
    // Restoring doesn't put it back, so the notice stays.
    await setArchived(ctx, doc, false);
    expect(textOf(await detail())).toContain(notice);
  });

  it("a made link ends calmly: who it's for, what it shares, what happens next, and only Copy link", async () => {
    const html = await renderPage(PassportReady, { label: "Northwind onboarding", documents: 2, days: 30, url: "https://example.test/p/x#y" });
    expect(textOf(html)).toContain("Your link for Northwind onboarding is ready It shares 2 documents for 30 days.");
    expect(textOf(html)).toContain("Each time someone opens it, you'll see it under Your links.");
    expect(actionsOf(html).map((a) => a.label)).toEqual(["Copy link"]);
  });

  describe("redesigned (SHIPSHAPE_UI=v2)", () => {
    beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", "v2"));
    /** The page's two sections, in the order they come. */
    const sections = (html: string) => [...html.matchAll(/<h2 id="(links|new-link)-title"/g)].map((m) => m[1]);
    /** Your links' rows, in order. */
    const linkRows = (html: string) => {
      const list = html.slice(html.indexOf('id="links-title"'));
      return [...list.slice(0, list.indexOf("</ul>")).matchAll(/<span class="hair-title">([^<]*)</g)].map((m) => m[1]);
    };

    it("one column: with no links the form comes first and what Your links will hold under it; once there are links they lead, working ones on top", async () => {
      const ctx = await signIn("passport-v2-order@example.com");
      const doc = await addDoc(ctx, "Liability certificate");
      const empty = await renderPage(PassportPage, none());
      expect(sections(empty)).toEqual(["new-link", "links"]);
      expect(textOf(empty)).toContain("No links yet. Each link you make shows here with who it's for, how often it was opened and the day it stops working");

      // Free keeps one link open at a time: the ended one is made (and ended) first, then the working one, made older.
      const ended = await createPassport(ctx, { label: "Newer but ended", days: 7, documentIds: [doc] });
      await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [ended.id]));
      const working = await createPassport(ctx, { label: "Working one", days: 30, documentIds: [doc] });
      await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '10 days' where id = $1", [working.id]));
      const html = await renderPage(PassportPage, none());
      expect(sections(html)).toEqual(["links", "new-link"]);
      // Newest first is the list's own order; a working link still comes before an ended newer one.
      expect(linkRows(html)).toEqual(["Working one", "Newer but ended"]);
      expect(textOf(html)).not.toContain("No links yet");
    });

    it("the form sends the same fields to the same action: who it's for, one box per document, and 7/30/90 days with the end day under them", async () => {
      const ctx = await signIn("passport-v2-form@example.com");
      await addDoc(ctx, "Liability certificate");
      await addDoc(ctx, "Contractor license");
      const html = await renderPage(PassportPage, none());
      expect(html).toMatch(/<input id="label" required="" maxLength="120"[^>]*class="row-field" name="label"/);
      const inputs = (type: string) => [...html.matchAll(new RegExp(`<input type="${type}"[^>]*>`, "g"))].map((m) => m[0]);
      expect(inputs("checkbox").filter((i) => i.includes('name="doc"'))).toHaveLength(2);
      const days = inputs("radio").filter((i) => i.includes('name="days"'));
      expect(days.map((i) => /value="(\d+)"/.exec(i)?.[1])).toEqual(["7", "30", "90"]);
      expect(days.filter((i) => i.includes('checked=""')).map((i) => /value="(\d+)"/.exec(i)?.[1])).toEqual(["30"]);
      expect(textOf(html)).toContain(`7 days 30 days 90 days Stops working on ${fmtDay(plusDays(todayIn("UTC"), 30))}. You can turn it off sooner.`);
      expect(textOf(html)).toContain("Who can open it Anyone who has the link can view and download the documents you tick");
      expect([...html.matchAll(/<button class="btn press"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["Make the link"]);
      // "Who is it for?" says it's required, as the fill form does; the placeholder is only an example. The earlier form as it was.
      expect(html).toContain('<label for="label">Who is it for?<span aria-hidden="true" class="text-ink-3"> (required)</span></label>');
      vi.stubEnv("SHIPSHAPE_UI", "v1");
      expect(await renderPage(PassportPage, none())).not.toContain("(required)");
    });

    it("a link's page keeps every fact: until when it works, its documents (each opening its page), who opened it, and Turn off at the foot", async () => {
      const ctx = await signIn("passport-v2-link@example.com");
      const doc = await addDoc(ctx, "Liability certificate");
      const { id } = await createPassport(ctx, { label: "Northwind Builders", days: 7, documentIds: [doc] });
      const html = await renderPage(PassportDetail, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
      const text = textOf(html);
      expect(text).toMatch(/Works until .* The link itself was shown once when you made it\./);
      expect(text).toContain("Documents on this link Liability certificate Insurance certificate");
      expect(actionsOf(html).find((a) => a.label.startsWith("Liability certificate"))?.href).toBe(`/app/documents/${doc}`);
      expect(text).toContain("When it was opened Nobody has opened this link yet.");
      expect(actionsOf(html).at(-3)?.label).toBe("Turn off this link");
    });
  });
});

// Every state and word holds in both looks: the redesigned pages are the same pages, re-laid.
describe.each([
  ["earlier (SHIPSHAPE_UI=v1)", "v1"],
  ["redesigned (the default, SHIPSHAPE_UI unset)", ""],
])("Collect, %s", (_look, ui) => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", ui));
  /** A sign-in address of this look's own: each test makes a new person. */
  const mail = (name: string) => `${ui || "v2"}-${name}@example.com`;

  it("with no vendors: a ghosted example vendor, and a button to the form's first field", async () => {
    await signIn(mail("collect-empty"));
    const html = await renderPage(CollectPage, {});
    expect(textOf(html)).toContain("No vendors yet Each vendor you add shows here with what you asked them for and where it stands.");
    const example = /<div aria-hidden="true"[^>]*>([\s\S]*?)<\/ul><\/div>/.exec(html)?.[1] ?? "";
    expect(textOf(example)).toBe("Example Ace Electric · W-9 ✓ · Insurance missing");
    expect(actionsOf(html).filter((a) => a.label === "Add your first vendor")).toEqual([{ tag: "button", label: "Add your first vendor", href: undefined }]);
    // The field it focuses is on the page; the form's own button stays the one primary action.
    expect(html).toContain('id="vendor-name"');
    expect(primary(html)).toEqual(["Add vendor"]);
    // The redesigned form's Vendor row says it's required, as the fill form does; the earlier form as it was. Both keep `required`.
    if (ui === "v1") expect(html).not.toContain("(required)");
    else expect(html).toContain('<label for="vendor-name">Vendor<span aria-hidden="true" class="text-ink-3"> (required)</span></label>');
    expect(/<input [^>]*id="vendor-name"[^>]*>/.exec(html)?.[0]).toContain('required=""');
  });

  it("with only archived vendors: the empty state says 'active', and the button doesn't call the next one the first (W10-11)", async () => {
    const ctx = await signIn(mail("collect-only-archived"));
    const vendorId = await addVendor(ctx, { name: "Old Supplier", email: "", requested: ["w9"] });
    await db.root((tx) => tx.query("update app.vendors set status = 'archived' where id = $1", [vendorId]));
    const html = await renderPage(CollectPage, {});
    expect(textOf(html)).toContain("No active vendors Each vendor you add shows here");
    expect(textOf(html)).not.toContain("No vendors yet");
    expect(actionsOf(html).map((a) => a.label)).toContain("Add a vendor");
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Add your first vendor");
    expect(textOf(html)).toMatch(/Archived vendors \( ?1 ?\)/);
  });

  it("a vendor without files or a link: says to make a link and send it", async () => {
    const ctx = await signIn(mail("collect-nolink"));
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({}) });
    expect(textOf(html)).toContain("Nothing received yet Make an upload link under Ask for the files and send it to Rivera Electric.");
    expect(textOf(html)).toContain("Links you make show here with the day they stop working.");
    expect(primary(html)).toEqual(["Make an upload link"]);
    // 7, 30 or 90 days; 30 unless another is picked.
    const days = [...html.matchAll(/<input type="radio"[^>]*name="days"[^>]*>/g)].map((m) => ({ value: /value="(\d+)"/.exec(m[0])?.[1], on: m[0].includes('checked=""') }));
    expect(days.map((d) => d.value)).toEqual(["7", "30", "90"]);
    expect(days.filter((d) => d.on).map((d) => d.value)).toEqual(["30"]);
  });

  it("a vendor with a working link and no files yet: says it's waiting and until when", async () => {
    const ctx = await signIn(mail("collect-waiting"));
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    const { id } = await createVendorLink(ctx, { vendorId, days: 7 });
    await db.root((tx) => tx.query("update app.vendor_links set expires_at = '2026-11-08 01:00:00+00' where id = $1", [id]));
    jar.set("ss_tz", "America/Los_Angeles");
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({}) });
    // The end is an instant (01:00 UTC on the 8th): the owner in Los Angeles reads the 7th.
    expect(textOf(html)).toContain("Waiting for Rivera Electric Your upload link works until Nov 7, 2026. Their files land here as soon as they send them");
    expect(textOf(html)).toContain("until Nov 7, 2026");
    expect(textOf(html)).not.toContain("Nothing received yet");
  });

  it("turning off an upload link that was already off says there's nothing more to do", async () => {
    const ctx = await signIn(mail("collect-off"));
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({ error: "off" }) });
    expect(textOf(html)).toContain("This link was already off, so nobody can use it. There's nothing more to do.");
  });

  it("an archived vendor says how to ask for files again", async () => {
    const ctx = await signIn(mail("collect-archived"));
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    await db.root((tx) => tx.query("update app.vendors set status = 'archived' where id = $1", [vendorId]));
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({}) });
    expect(textOf(html)).toContain("This vendor is archived: its upload links are off, and it isn't counted on the Collect page. Restoring it turns its unexpired links back on.");
    expect(primary(html)).toEqual([]);
    expect(actionsOf(html).map((a) => a.label)).toContain("Restore");
  });

  it("an archived vendor's unexpired link reads 'Off while archived' with no Turn off; restored, it's Working again (W10-1)", async () => {
    const ctx = await signIn(mail("collect-archived-link"));
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    await createVendorLink(ctx, { vendorId, days: 7 });
    await db.root((tx) => tx.query("update app.vendors set status = 'archived' where id = $1", [vendorId]));
    const page = () => renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({}) });
    const archived = await page();
    expect(textOf(archived)).toContain("Off while archived Made");
    expect(textOf(archived)).not.toContain("Working");
    expect(actionsOf(archived).map((a) => a.label)).not.toContain("Turn off");
    await db.root((tx) => tx.query("update app.vendors set status = 'active' where id = $1", [vendorId]));
    const restored = await page();
    expect(textOf(restored)).toContain("Working Made");
    expect(actionsOf(restored).map((a) => a.label)).toContain("Turn off");
  });

  it("a made upload link ends calmly: for whom, how long, what happens next, and only Copy link", async () => {
    const html = await renderPage(VendorLinkReady, { vendorName: "Rivera Electric", days: 30, url: "https://example.test/c/x#y", v2: ui !== "v1" });
    expect(textOf(html)).toContain("Upload link for Rivera Electric is ready It works for 30 days.");
    expect(textOf(html)).toContain("The files they send land under Files received.");
    expect(actionsOf(html).map((a) => a.label)).toEqual(["Copy link"]);
  });
});

describe("Collect, redesigned only", () => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", "v2"));

  it("the four counts as tiles, each vendor a row with its chips, then Add a vendor as field rows sending the same fields", async () => {
    // The sample's vendors: Summit all current; Rivera with a certificate expiring and its license not in; Bayside missing its
    // W-9 with a lapsed certificate. Plus one with nothing in. One vendor can count under two states.
    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await finishSignIn(userId, { demo: true });
    await addVendor(await requireWorkspace(), { name: "Ace Electric", email: "", requested: ["w9"] });
    const html = await renderPage(CollectPage, {});
    const text = textOf(html);

    const tiles = [...html.matchAll(/<div class="tile gap-1"><dt[^>]*>([^<]*)<\/dt><dd[^>]*><span[^>]*>(\d+)<\/span>/g)].map((m) => `${m[1]}: ${m[2]}`);
    expect(tiles).toEqual(["All current: 1", "Expiring within 30 days: 1", "Missing something: 3", "Something lapsed: 1"]);
    expect(text).toContain("Sample workspace: these vendors are made up");
    expect(text).toMatch(/Bayside Drywall \(sample\) \d+ open links? ○ W-9: missing ! Insurance certificate: expired/);
    expect(text).toContain("Ace Electric 0 open links ○ W-9: missing");
    // Counts, then the vendors, then the form.
    expect(text.indexOf("Something lapsed")).toBeLessThan(text.indexOf("Ace Electric"));
    expect(text.indexOf("Ace Electric")).toBeLessThan(text.indexOf("Add a vendor Vendor"));

    expect(html).toMatch(/<input id="vendor-name" required="" maxLength="120"[^>]*class="row-field" name="name"/);
    expect(html).toMatch(/<input id="vendor-email" type="email"[^>]*aria-describedby="vendor-email-note"[^>]*name="email"/);
    expect(text).toContain("Email is optional, only for you; ShipShape doesn't email vendors.");
    // One box per kind of document; W-9 and insurance are ticked to start with, as on the current form.
    const kinds = [...html.matchAll(/<input type="checkbox"[^>]*name="kind"[^>]*>/g)].map((m) => ({ value: /value="(\w+)"/.exec(m[0])?.[1], on: m[0].includes('checked=""') }));
    expect(kinds.map((k) => k.value)).toEqual(Object.keys(DOC_KINDS));
    expect(kinds.filter((k) => k.on).map((k) => k.value)).toEqual(Object.keys(DOC_KINDS).filter((k) => k === "w9" || k === "coi"));
    expect(primary(html)).toEqual(["Add vendor"]);
  });
});

describe("Deadlines", () => {
  it("with no dates: shows what will appear and one verb button, and on Free doesn't promise reminders ShipShape won't send", async () => {
    await signIn("deadlines-empty@example.com");
    const html = await renderPage(DeadlinesPage, none());
    expect(textOf(html)).toContain("No dates yet Expiry and renewal dates from your certificates, licenses and agreements show here, soonest first");
    expect(primary(html)).toEqual(["Add an expiry date"]);
    expect(textOf(html)).toContain("Add these dates to your calendar. The calendar file includes alerts 30 and 7 days before, while there's still time.");
    expect(textOf(html)).not.toContain("Owners and admins get a reminder");
    expect(textOf(html)).toContain("Nothing here: on the Free plan ShipShape doesn't send reminders.");
  });

  it("with no documents before real documents open: no action, since there's nothing to add a date to", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    await signIn("deadlines-empty-closed@example.com");
    const html = await renderPage(DeadlinesPage, none());
    expect(primary(html)).toEqual([]);
    expect(actionsOf(html).map((a) => a.href)).not.toContain("/app/documents");
  });

  it("with a document but no dates: the action goes to that document's expiry field, by name", async () => {
    const ctx = await signIn("deadlines-nodates@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const html = await renderPage(DeadlinesPage, none());
    expect(primary(html)).toEqual(["Add an expiry date to Liability certificate"]);
    expect(actionsOf(html).find((a) => a.label === "Add an expiry date to Liability certificate")?.href).toBe(`/app/documents/${doc}#expires_on`);
  });

  it("with nothing in the next 90 days: says so calmly, with the reminder that's really coming", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier page's markup; the redesigned page's own test is under "redesigned"
    const ctx = await signIn("deadlines-quiet@example.com");
    await addDoc(ctx, "Liability certificate", 120);
    const html = await renderPage(DeadlinesPage, none());
    expect(textOf(html)).toContain("Nothing expires in the next 90 days. Add these dates to your calendar and set reminders there for 30 and 7 days before.");
    expect(primary(html)).toEqual([]);
  });

  it("with something due within 90 days: no all-clear", async () => {
    const ctx = await signIn("deadlines-due@example.com");
    await addDoc(ctx, "Liability certificate", 60);
    const html = await renderPage(DeadlinesPage, none());
    expect(textOf(html)).not.toContain("Nothing expires in the next 90 days");
  });

  it("dates a sent reminder in the owner's wall-clock time with the zone's name (Design, wave 8)", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v1"); // the earlier page's markup; the redesigned page's own test is under "redesigned"
    const ctx = await signIn("deadlines-sent-zone@example.com");
    await db.root((tx) =>
      tx.query("insert into app.outbox (org_id, to_email, subject, body, created_at) values ($1, 'me@example.com', 'Liability certificate expires in 7 days', 'x', '2026-11-01 03:30:00+00')", [ctx.orgId]),
    );
    jar.set("ss_tz", "America/Los_Angeles");
    expect(textOf(await renderPage(DeadlinesPage, none()))).toContain("Liability certificate expires in 7 days Oct 31, 2026, 8:30 PM PDT");
    jar.delete("ss_tz");
    expect(textOf(await renderPage(DeadlinesPage, none()))).toContain("Liability certificate expires in 7 days Nov 1, 2026, 3:30 AM UTC");
  });

  it("on Pro (the sample workspace): says ShipShape sends the reminders", async () => {
    // As "Try the sample" signs in: an anonymous user, then the seeded sample workspace.
    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await finishSignIn(userId, { demo: true });
    const html = await renderPage(DeadlinesPage, none());
    expect(textOf(html)).toContain("Owners and admins get a reminder 90, 30 and 7 days before, and on the day something lapses. You'll find them under Reminders sent.");
    // The sample workspace shows its signing codes too (0039).
    expect(textOf(html)).toContain("During the preview ShipShape doesn't send email; reminders and signing codes land here instead.");
  });

  it("Reminders sent: an owner reads them, with real documents' signing codes not shown; a member is told only owners and admins see them, and gets no list (0039, Design 3a)", async () => {
    const owner = await signIn("deadlines-team-owner@example.com");
    await db.root((tx) =>
      tx.query("insert into app.outbox (org_id, to_email, subject, body) values ($1, 'deadlines-team-owner@example.com', 'Liability certificate expires in 7 days', 'x')", [owner.orgId]),
    );
    const ownerText = textOf(await renderPage(DeadlinesPage, none()));
    expect(ownerText).toContain("During the preview, ShipShape doesn't send email: reminders land here instead, and signing codes for real documents aren't shown.");
    expect(ownerText).toContain("Liability certificate expires in 7 days");

    const member = await createLocalUser("deadlines-team-member@example.com", false);
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'member')", [owner.orgId, member]));
    await finishSignIn(member, { demo: false });
    const memberText = textOf(await renderPage(DeadlinesPage, none()));
    expect(memberText).toContain("Reminders sent Reminders go to owners and admins, and only they can see what was sent.");
    expect(memberText).not.toContain("Liability certificate expires in 7 days");
    expect(memberText).not.toContain("During the preview");
    expect(memberText).not.toContain("Nothing here");
  });

  describe("redesigned (SHIPSHAPE_UI=v2)", () => {
    beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", "v2"));
    /** A permit with an expiry and a renewal date, each that many days from the page's own today (null: none). */
    const dated = (ctx: Ctx, title: string, expires: number | null, renews: number | null = null) =>
      db.root((tx) =>
        tx.query("insert into app.documents (org_id, title, kind, expires_on, renews_on) values ($1, $2, 'permit', $3::date + $4::int, $3::date + $5::int)", [
          ctx.orgId,
          title,
          ctx.today,
          expires,
          renews,
        ]),
      );
    /** The dated rows, in order: "<title> expires|renewal notice". */
    const rows = (html: string) =>
      [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)]
        .map((m) => textOf(m[1]))
        .filter((t) => t.includes("Permit ·"))
        .map((t) => /^(.*?) Permit · (expires|renewal notice)/.exec(t)?.slice(1).join(" "));
    /** The count a group's heading gives. */
    const count = (html: string, title: string) => new RegExp(`<h2[^>]*>${title}<span[^>]*>(\\d+)</span>`).exec(html)?.[1];
    const page = (soon?: string) => renderPage(DeadlinesPage, { searchParams: Promise.resolve(soon ? { soon } : {}) });

    it("?soon=1 (Home's See all) keeps exactly the dates that put a document on Home: lapsed expiries and anything due within 30 days", async () => {
      const ctx = await signIn("deadlines-v2-soon@example.com");
      await dated(ctx, "Lapsed expiry", -5);
      await dated(ctx, "Due expiry", 30);
      await dated(ctx, "Later expiry", 31);
      await dated(ctx, "Renewal today", null, 0);
      await dated(ctx, "Renewal due", null, 30);
      await dated(ctx, "Renewal passed", null, -1);
      await dated(ctx, "Renewal far", null, 31);

      const soon = await page("1");
      expect(rows(soon)).toEqual(["Lapsed expiry expires", "Renewal today renewal notice", "Due expiry expires", "Renewal due renewal notice"]);
      expect([count(soon, "Lapsed"), count(soon, "Next 30 days"), count(soon, "Later")]).toEqual(["1", "3", undefined]);
      expect(textOf(soon)).toContain("Showing what has lapsed or is due in the next 30 days. Show every date");
      expect(actionsOf(soon).find((a) => a.label === "Show every date")?.href).toBe("/app/deadlines");

      const every = await page();
      expect(rows(every)).toEqual([
        "Lapsed expiry expires",
        "Renewal passed renewal notice",
        "Renewal today renewal notice",
        "Due expiry expires",
        "Renewal due renewal notice",
        "Later expiry expires",
        "Renewal far renewal notice",
      ]);
      expect([count(every, "Lapsed"), count(every, "Next 30 days"), count(every, "Later")]).toEqual(["2", "3", "2"]);
      expect(textOf(every)).not.toContain("Show every date");
    });

    it("each date's chip is the state as a dot and a word, then how far off it is (Design #26 MUST-2)", async () => {
      const ctx = await signIn("deadlines-v2-chips@example.com");
      await dated(ctx, "Lapsed expiry", -5);
      await dated(ctx, "Due expiry", 30);
      await dated(ctx, "Later expiry", 31);
      await dated(ctx, "Renewal today", null, 0);
      const html = await page();
      /** A row's chip: its dot colour, then its words. */
      const chip = (title: string) => {
        const row = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]).find((r) => textOf(r).startsWith(`${title} `)) ?? "";
        const c = /<span class="hair-chip">([\s\S]*?)<\/span><span class="hair-chev">/.exec(row)?.[1] ?? "";
        return `${/data-validity="(\w+)"/.exec(c)?.[1]} ${textOf(c)}`;
      };
      expect(["Lapsed expiry", "Renewal today", "Due expiry", "Later expiry"].map(chip)).toEqual([
        "expired Expired · 5 days ago",
        "expiring Renewal notice · today",
        "expiring Expires soon · in 30 days",
        "ok Current · in 31 days",
      ]);
      expect(html).not.toMatch(/bg-(ok|warn|bad)-soft/);
    });

    it("?soon=1 with nothing due says so and keeps the way back; the calendar stays the one primary", async () => {
      const ctx = await signIn("deadlines-v2-calm@example.com");
      await dated(ctx, "Later expiry", 120);
      const html = await page("1");
      expect(rows(html)).toEqual([]);
      expect(textOf(html)).toContain("Nothing has lapsed or is due in the next 30 days. Show every date");
      // The all-clear belongs to the whole list, not the filtered one.
      expect(textOf(html)).not.toContain("Nothing expires in the next 90 days");
      expect(actionsOf(html).find((a) => a.label === "Add to my calendar")).toEqual({ tag: "a", label: "Add to my calendar", href: "/app/deadlines/calendar.ics" });
    });

    it("each reminder sent opens in place: subject, to and when in the row, the email behind Show the email, closed at first", async () => {
      const ctx = await signIn("deadlines-v2-sent@example.com");
      await db.root((tx) =>
        tx.query("insert into app.outbox (org_id, to_email, subject, body, created_at) values ($1, 'me@example.com', 'Liability certificate expires in 7 days', 'Renew it.', '2026-11-01 03:30:00+00')", [ctx.orgId]),
      );
      const html = await page();
      const sent = /<details\b([^>]*)>([\s\S]*?)<\/details>/.exec(html);
      expect(sent?.[1]).not.toContain("open");
      expect(textOf(sent?.[2] ?? "")).toBe("Liability certificate expires in 7 days To me@example.com · Nov 1, 2026, 3:30 AM UTC Show the email Hide the email Renew it.");
    });

    it("SHIPSHAPE_UI=v1 brings back the earlier page: ?soon=1 changes nothing there", async () => {
      vi.stubEnv("SHIPSHAPE_UI", "v1");
      const ctx = await signIn("deadlines-v2-off@example.com");
      await dated(ctx, "Later expiry", 31);
      const html = await page("1");
      expect(textOf(html)).toContain("Later expiry");
      expect(html).not.toContain("<details");
    });

    it("with email on (SHIPSHAPE_EMAIL=1, B12), an owner reads that reminders are emailed; off, the earlier look and the sample keep saying email is off", async () => {
      const off = "During the preview, ShipShape doesn't send email: reminders land here instead, and signing codes for real documents aren't shown.";
      const on = "ShipShape emails each reminder";
      await signIn("deadlines-v2-email@example.com");
      expect(textOf(await page())).toContain(off);

      vi.stubEnv("SHIPSHAPE_EMAIL", "1");
      vi.stubEnv("SHIPSHAPE_EMAIL_FROM", "reminders@shipshape.example");
      vi.stubEnv("AWS_REGION", "us-east-1");
      vi.stubEnv("SHIPSHAPE_SES_EVENTS_TOPIC_ARN", "arn:aws:sns:us-east-1:111122223333:shipshape-mail-events");
      vi.stubEnv("CONTACT_EMAIL", "help@shipshape.example");
      const emailed = textOf(await page());
      expect(emailed).toContain(on);
      expect(emailed).not.toContain("doesn't send email");

      // A setting missing: email isn't really on, so the page doesn't say it is.
      vi.stubEnv("SHIPSHAPE_SES_EVENTS_TOPIC_ARN", "");
      expect(textOf(await page())).toContain(off);
      vi.stubEnv("SHIPSHAPE_SES_EVENTS_TOPIC_ARN", "arn:aws:sns:us-east-1:111122223333:shipshape-mail-events");

      // The earlier look renders exactly as before.
      vi.stubEnv("SHIPSHAPE_UI", "v1");
      expect(textOf(await page())).toContain(off);
      vi.stubEnv("SHIPSHAPE_UI", "v2");

      // The sample never emails.
      const userId = await createLocalUser(null, true);
      const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
      await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
      await finishSignIn(userId, { demo: true });
      const sample = textOf(await page());
      expect(sample).toContain("During the preview ShipShape doesn't send email; reminders and signing codes land here instead.");
      expect(sample).not.toContain("ShipShape emails each reminder");
    });
  });
});

describe.each([
  ["earlier (SHIPSHAPE_UI=v1)", "v1"],
  ["redesigned (the default, SHIPSHAPE_UI unset)", ""],
])("What are they asking for?, %s", (_look, ui) => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", ui));

  it("with AI switched off: one line on what that means, and one way forward", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "");
    await signIn(`${ui || "v2"}-ask-off@example.com`);
    const html = await renderPage(AskPage, {});
    expect(textOf(html)).toContain("Reading requests with AI is switched off right now, so check the request against your documents yourself");
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Open your documents", href: "/app/documents" }]);
  });

  it("with AI on: the consent box claims only what Anthropic says, and names the source and when it was checked", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-a-key");
    await signIn(`${ui || "v2"}-ask-on@example.com`);
    const html = await renderPage(AskPage, {});
    const text = textOf(html);
    expect(text).toContain("and nothing from your documents is sent. Anthropic says that by default it doesn't train on what its API receives.");
    expect(text).not.toContain("Anthropic doesn't train on it");
    expect(text).toMatch(/Source:\s*Anthropic's privacy center\s*, checked Oct 31, 2026\s*\./);
    expect(html).toMatch(/<a href="https:\/\/privacy\.claude\.com\/en\/articles\/7996868-is-my-data-used-for-model-training"[^>]*rel="noopener noreferrer"/);
    expect(html).toMatch(/<input[^>]*aria-describedby="consent-source"[^>]*name="consent"/);
    // The consent isn't ticked for you, and the one send action is the same in both looks.
    expect(/<input[^>]*name="consent"[^>]*>/.exec(html)?.[0]).not.toContain("checked");
    expect(textOf(html)).toContain("Read the request");
  });
});

describe("What are they asking for?, redesigned only", () => {
  it("reads in the 720 column: the request in a hairline well, the consent as a row with the tick first (as Home), and Read the request green until an answer shows", async () => {
    vi.stubEnv("SHIPSHAPE_UI", "v2");
    vi.stubEnv("SHIPSHAPE_AI", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-not-a-key");
    await signIn("v2-ask-look@example.com");
    const html = await renderPage(AskPage, {});
    expect(html).toMatch(/^<div class="mx-auto max-w-\[720px\] space-y-6">/);
    expect(html).not.toMatch(/<form[^>]*class="card/);
    expect(/<textarea[^>]*>/.exec(html)?.[0]).toContain('class="request-well"');
    expect(html).toMatch(/<label class="group-row[^"]*"><input[^>]*name="consent"[^>]*\/><span[^>]*>Send the text above to Anthropic&#x27;s Claude[^<]*<\/span>/);
    expect(html).toMatch(/<button class="btn-accent press">Read the request<\/button>/);
  });
});

// As Collect: every state and word holds in both looks.
describe.each([
  ["earlier (SHIPSHAPE_UI=v1)", "v1"],
  ["redesigned (the default, SHIPSHAPE_UI unset)", ""],
])("Settings, %s", (_look, ui) => {
  beforeEach(() => vi.stubEnv("SHIPSHAPE_UI", ui));
  /** A sign-in address of this look's own: each test makes a new person. */
  const mail = (name: string) => `${ui || "v2"}-${name}@example.com`;
  const v2 = ui !== "v1";
  // Two-step sign-in's status: a line in the earlier look, a row (the method, then On) in the redesigned app.
  const mfaOn = v2 ? "Authenticator app On" : "On · authenticator app";
  const settings = (error?: string) => renderPage(SettingsPage, { searchParams: Promise.resolve(error ? { error } : {}) });
  const afterCheckout = () => renderPage(SettingsPage, { searchParams: Promise.resolve({ billing: "success" }) });
  const bill = (ctx: Ctx, status: string) =>
    db.root((tx) =>
      tx.query("insert into app.billing (org_id, stripe_customer_id, stripe_subscription_id, status, plan, past_due_since) values ($1, $2, $3, $4, 'pro', $5)", [
        ctx.orgId,
        `cus_${ctx.orgId.replaceAll("-", "")}`,
        `sub_${ctx.orgId.replaceAll("-", "")}`,
        status,
        status === "past_due" ? new Date().toISOString() : null,
      ]),
    );

  it("back from checkout before Stripe confirms: says what's happening, with one way to check again", async () => {
    await signIn(mail("settings-pending"));
    const html = await afterCheckout();
    expect(textOf(html)).toContain("Thanks. Pro switches on as soon as Stripe confirms the payment, usually within seconds. Check again");
    expect(actionsOf(html).find((a) => a.label === "Check again")?.href).toBe("/app/settings?billing=success");
  });

  it("says up front which actions need a recent sign-in and how recent, and that a W-9 carries the full EIN (W14-1)", async () => {
    await signIn(mail("settings-rule"));
    const html = await settings();
    expect(textOf(html)).toContain(
      `Showing your full EIN in Business facts, exporting and deleting need a sign-in from the last ${RECENT_AUTH_SECONDS / 60} minutes; otherwise ShipShape asks you to sign in again first. A W-9 you made carries the full number, as the IRS form requires, so anyone in this workspace who opens it can read it.`,
    );
    expect(RECENT_AUTH_SECONDS / 60).toBe(10);
  });

  it("shows two-step sign-in as On with an authenticator app for an account that signs in through Cognito; a local account is told it has no second step", async () => {
    const ctx = await signIn(mail("settings-mfa"));
    const local = textOf(await settings());
    expect(local).toContain("Two-step sign-in This is a local sign-in without a second step; accounts on ShipShape itself sign in with a password and an authenticator app.");
    expect(local).not.toContain(mfaOn);

    await db.root((tx) => tx.query("insert into app.identities (provider, subject, user_id) values ('cognito', gen_random_uuid()::text, $1)", [ctx.userId]));
    const cognito = textOf(await settings());
    expect(cognito).toContain(`Two-step sign-in ${mfaOn} Every ShipShape account signs in with a password and a 6-digit code from an authenticator app. There's no way to turn it off.`);
    expect(cognito).not.toContain("Turn on");
  });

  it("back from checkout once Stripe confirmed: says it's done and what changed, nothing else", async () => {
    const ctx = await signIn(mail("settings-pro"));
    await bill(ctx, "active");
    const html = await afterCheckout();
    expect(textOf(html)).toContain("You're on Pro now. The limits are gone and reminders are on; they land under Deadlines.");
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Check again");
  });

  it("a failed payment: what it means, how long Pro lasts, and the one fix: the card while payments are on, writing to us while they're off (W9-4)", async () => {
    const ctx = await signIn(mail("settings-pastdue"));
    await bill(ctx, "past_due");
    vi.stubEnv("CONTACT_EMAIL", "help@shipshape.example");
    const off = await settings();
    expect(textOf(off)).toContain(
      "Your last payment didn't go through. Pro stays on for 7 days after a failed payment. Card updates are paused on our side right now; if Pro ends before they're back, write to help@shipshape.example.",
    );
    expect(textOf(off)).toContain("Payments are switched off right now, so the plan can't change.");
    // Payments on: the Manage billing button is below, so the notice may point at it.
    vi.stubEnv("BILLING_ENABLED", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", `sk_test_${"a".repeat(24)}`);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_testsecret123");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_Pro1");
    vi.stubEnv("SHIPSHAPE_APP_URL", "http://127.0.0.1:3917");
    const on = await settings();
    expect(textOf(on)).toContain("Pro stays on for 7 days after a failed payment. Update your card with Manage billing below.");
    expect(actionsOf(on).map((a) => a.label)).toContain("Manage billing");
  });

  it("Free's plan line says what Pro adds today; the agreement names sales tax only with Stripe Tax on; paused offers no checkout (Security MUST-3, SHOULD-3, SHOULD-8)", async () => {
    await signIn(mail("settings-upgrade"));
    vi.stubEnv("BILLING_ENABLED", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", `sk_test_${"a".repeat(24)}`);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_testsecret123");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_Pro1");
    vi.stubEnv("SHIPSHAPE_APP_URL", "http://127.0.0.1:3917");
    // The plan section only: the workspace-name help elsewhere mentions signature requests people send.
    const plan = (text: string) => text.slice(text.indexOf("Plan Free"), text.indexOf("Export everything"));
    const open = plan(textOf(await settings()));
    expect(open).toContain("Pro ($ 15 /month) removes the limits and adds deadline reminders on your Deadlines page.");
    expect(open).not.toMatch(/email|signature requests/i);
    expect(open).toContain("including $15 a month until I cancel, and the refund policy.");
    vi.stubEnv("STRIPE_AUTOMATIC_TAX", "1");
    // Design's wording with tax (PR 17 delta): the refund policy can't read as lasting until you cancel.
    expect(plan(textOf(await settings()))).toContain("I agree to the Terms and the refund policy: $15 a month, plus any sales tax, until I cancel.");
    vi.stubEnv("SHIPSHAPE_CHECKOUT_PAUSED", "1");
    const paused = await settings();
    expect(textOf(paused)).toContain("New Pro subscriptions are paused for now.");
    expect(actionsOf(paused).map((a) => a.label)).not.toContain("Move to Pro, $15/month");
  });

  it("export needing a fresh sign-in: one line, and Sign in again in place of the download", async () => {
    await signIn(mail("settings-reauth"));
    const html = await settings("reauth");
    expect(textOf(html)).toContain("For your security, sign in again before you export.");
    const labels = actionsOf(html).map((a) => a.label);
    expect(labels).toContain("Sign in again");
    expect(actionsOf(html).find((a) => a.label === "Sign in again")?.href).toBe("/signin?next=export");
    expect(labels).not.toContain("Download the export");
  });

  it("export by someone who can't: says who can, and offers no download", async () => {
    await signIn(mail("settings-role"));
    const html = await settings("role");
    expect(textOf(html)).toContain("Only owners and admins can export this workspace. Ask one of them for the file.");
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Download the export");
  });

  it("export too large: says how large, and the one way forward (write to us when there's an address)", async () => {
    await signIn(mail("settings-size"));
    const without = await settings("size");
    expect(textOf(without)).toContain("This workspace is over 200 MB, too large to export in one file. Download what you need from each document's page.");
    expect(actionsOf(without).find((a) => a.label === "Open your documents")?.href).toBe("/app/documents");
    expect(actionsOf(without).map((a) => a.label)).not.toContain("Download the export");

    vi.stubEnv("CONTACT_EMAIL", "help@shipshape.example");
    const withContact = await settings("size");
    expect(textOf(withContact)).toContain("Write to us and we'll send it another way.");
    expect(actionsOf(withContact).find((a) => a.label === "Write to us")?.href).toMatch(/^mailto:help@shipshape\.example\?subject=/);
    expect(actionsOf(withContact).map((a) => a.label)).not.toContain("Open your documents");
  });

  it("no error: the download, and the delete step names the workspace it deletes", async () => {
    const ctx = await signIn(mail("settings-plain"));
    const html = await settings();
    expect(actionsOf(html).map((a) => a.label)).toContain("Download the export");
    expect(textOf(html)).toContain(`Deleted with everything in it ${ctx.name}`);
    expect(textOf(html)).toContain("Payments are switched off right now, so the plan can't change.");
  });

  it("while real documents are closed, an owner can still name the workspace (Security 0715 #3), with no 'opens after' notice", async () => {
    await signIn(mail("settings-gate"));
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "");
    const html = await settings();
    expect(actionsOf(html).map((a) => a.label)).toContain("Save name");
    expect(html).toContain('maxLength="80"');
    expect(textOf(html)).not.toContain("Naming the workspace opens after our security review.");
    expect(await renameMyWorkspace({}, form({ name: "Harbor Plumbing" }))).toEqual({ saved: true });
    expect(await renameMyWorkspace({}, form({ name: "x".repeat(81) }))).toEqual({ error: "Use 80 characters or fewer.", name: "x".repeat(81) });
  });

  it("the export card lists what the ZIP holds, and Sign out everywhere no longer promises a password change (W9-11, W9-13)", async () => {
    await signIn(mail("settings-export-list"));
    const text = textOf(await settings());
    expect(text).toContain(
      "One ZIP file with: every version of every document, with its details and fingerprint your business facts (the tax ID only as its last 4 digits; a W-9 you made holds the full number) your vendors and the files they sent your passport links, with when they were opened and what was downloaded your signature requests the browsers you've signed in on and the agreements you've accepted the workspace history",
    );
    expect(text).toContain("This ends every session, here and everywhere else.");
    expect(text).not.toContain("change your password");
  });

  describe("Where you're signed in (Design row 34)", () => {
    /** The card's own HTML, so the Sign out card further down doesn't count. */
    const card = (html: string) => {
      const start = html.indexOf('id="sessions"');
      return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
    };
    /** A session of `userId`'s on another browser, last used `idle` ago (a Postgres interval). */
    const otherBrowser = async (userId: string, family: string, idle: string) => {
      const id = newSessionId();
      await asUser(userId, (tx) => tx.query("select app.start_session($1, $2)", [id, family]));
      await db.root((tx) => tx.query("update app.sessions set created_at = now() - $2::interval, last_seen_at = now() - $2::interval where id = $1", [id, idle]));
      return id;
    };

    it("lists this person's live sessions: this browser marked, the others with when they were last active, and a Sign out on each other browser's row (on this browser's too in today's look)", async () => {
      const someoneElse = await signIn(mail("settings-sessions-other"));
      await otherBrowser(someoneElse.userId, "Edge on Android", "1 hour");
      const ctx = await signIn(mail("settings-sessions"));
      await db.root((tx) => tx.query("update app.sessions set ua_family = 'Safari on a Mac' where id = $1", [ctx.sessionId]));
      const phone = await otherBrowser(ctx.userId, "Chrome on an iPhone", "2 days 3 hours");
      const tablet = await otherBrowser(ctx.userId, "Safari on an iPad", "3 hours 20 minutes");
      const recent = await otherBrowser(ctx.userId, "Firefox on Linux", "25 minutes");
      // Signed out, and past its 12 hours: neither is listed.
      const gone = await otherBrowser(ctx.userId, "Firefox on Windows", "1 day");
      await asUser(ctx.userId, (tx) => tx.query("select app.end_session($1)", [gone]));
      const old = await otherBrowser(ctx.userId, "Opera on Windows", "13 hours");
      await db.root((tx) => tx.query("update app.sessions set expires_at = now() - interval '1 hour' where id = $1", [old]));

      const html = card(await settings());
      const text = textOf(html);
      expect(text).toContain("Where you're signed in");
      // This browser's row: no button in the redesigned app, where the Sign out section below is the one way (Design 02 Nov).
      expect(text).toMatch(v2 ? /Safari on a Mac\s*·\s*this browser\s*Firefox on Linux/ : /Safari on a Mac\s*·\s*this browser\s*Sign out/);
      expect(text).toMatch(/Firefox on Linux\s*·\s*last active less than an hour ago/);
      expect(text).toMatch(/Safari on an iPad\s*·\s*last active 3 hours ago/);
      expect(text).toMatch(/Chrome on an iPhone\s*·\s*last active 2 days ago/);
      expect(text.match(/this browser/g)).toHaveLength(1);
      expect(text).not.toMatch(/Firefox on Windows|Opera on Windows|Edge on Android/);
      // This browser first, then the most recently used; one Sign out for each other browser (and this one, today), naming its own session.
      const others = [recent, tablet, phone];
      expect(actionsOf(html).map((a) => a.label)).toEqual(Array(v2 ? 3 : 4).fill("Sign out"));
      expect([...html.matchAll(/name="id" value="([^"]+)"/g)].map((m) => m[1])).toEqual(v2 ? others : [ctx.sessionId, ...others]);
      expect(html.includes('aria-label="Sign out Safari on a Mac (this browser)"')).toBe(!v2);
      expect(html).toContain('aria-label="Sign out Chrome on an iPhone"');
    });

    it("Sign out on a row ends that browser and leaves this one; on this browser's own row it signs out here", async () => {
      const someoneElse = await signIn(mail("settings-sessions-signout-other"));
      const theirs = await otherBrowser(someoneElse.userId, "Edge on Android", "1 hour");
      const ctx = await signIn(mail("settings-sessions-signout"));
      const phone = await otherBrowser(ctx.userId, "Chrome on an iPhone", "1 day");

      await signOutSession(form({ id: phone }));
      expect(textOf(card(await settings()))).not.toContain("Chrome on an iPhone");
      // Junk does nothing; another person's session is refused by the database.
      await signOutSession(form({ id: "not-a-session" }));
      await expect(signOutSession(form({ id: theirs }))).rejects.toMatchObject({ code: "42501" });
      expect(textOf(card(await settings()))).toMatch(/this browser/);

      await expect(signOutSession(form({ id: ctx.sessionId }))).rejects.toThrow("redirect /");
      expect(jar.has("ss_session")).toBe(false);
    });

    it("shows in a sample workspace too: its visitor's one browser, marked as this one", async () => {
      const userId = await createLocalUser(null, true);
      const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
      await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
      await finishSignIn(userId, { demo: true });
      const html = await settings();
      const text = textOf(card(html));
      expect(text).toMatch(v2 ? /Where you're signed in.*A browser\s*·\s*this browser$/ : /Where you're signed in.*A browser\s*·\s*this browser\s*Sign out/);
      expect(html.includes('aria-label="Sign out a browser (this browser)"')).toBe(!v2);
    });
  });
});

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(name, v);
  return data;
};

describe("form errors name the field to fix", () => {
  it("a new passport link: each refusal goes to its field, and what was typed comes back", async () => {
    await signIn("form-passport@example.com");
    expect(await makePassport({}, form({ label: " ", days: "30" }))).toEqual({
      fieldErrors: { label: "Name the link, e.g. who it's for.", docs: "Pick at least one document." },
      values: { label: " ", days: "30", docs: [] },
    });
  });

  it("a second passport link on Free: the limit, and the one fix (turn the open link off); 'move to Pro' only while payments are on", async () => {
    const ctx = await signIn("form-passport-limit@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const made = await makePassport({}, form({ label: "First", days: "30", doc }));
    expect(made.created).toMatchObject({ label: "First", documents: 1, days: 30 });
    // Payments off (no Stripe config in tests): nobody can move to Pro, so the message doesn't offer it.
    const refused = await makePassport({}, form({ label: "Second", days: "30", doc }));
    expect(refused.error).toBe("The Free plan has 1 passport link open at a time. Turn one off to make room.");
    expect(refused.fix).toEqual({ href: `/app/passport/${made.created?.id}`, label: "Turn off your open link" });
    // Payments on: the Pro half comes back.
    vi.stubEnv("BILLING_ENABLED", "1");
    vi.stubEnv("STRIPE_SECRET_KEY", `sk_test_${"a".repeat(24)}`);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_testsecret123");
    vi.stubEnv("STRIPE_PRICE_PRO", "price_Pro1");
    vi.stubEnv("SHIPSHAPE_APP_URL", "http://127.0.0.1:3917");
    const paid = await makePassport({}, form({ label: "Second", days: "30", doc }));
    expect(paid.error).toBe("The Free plan has 1 passport link open at a time. Turn one off, or move to Pro for more.");
  });

  it("a new vendor: a mistyped email goes to the email field", async () => {
    await signIn("form-vendor@example.com");
    expect(await addVendorAction({}, form({ name: "Rivera Electric", email: "ap at rivera", kind: "w9" }))).toEqual({
      fieldErrors: { email: "That email address doesn't look right. Check it, or leave the field empty." },
      values: { name: "Rivera Electric", email: "ap at rivera", kinds: ["w9"] },
    });
  });

  it("W15-2: past the hourly limits, a new link or vendor is refused above the button, and what was typed comes back", async () => {
    const ctx = await signIn("form-busy@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    await fillBucket(db, "links", ctx.userId, 30, 3600);
    expect(await makePassport({}, form({ label: "Northwind", days: "30", doc }))).toEqual({ error: LINKS_BUSY, values: { label: "Northwind", days: "30", docs: [doc] } });
    await fillBucket(db, "vendors", ctx.userId, 30, 3600);
    expect(await addVendorAction({}, form({ name: "Rivera Electric", email: "ap@rivera.example", kind: "w9" }))).toEqual({
      error: VENDORS_BUSY,
      values: { name: "Rivera Electric", email: "ap@rivera.example", kinds: ["w9"] },
    });
  });

  it("reading a request: the missing tick goes to the box, the pasted text stays", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key");
    await signIn("form-ask@example.com");
    const text = "Before your first job we need a W-9 and a certificate of insurance.";
    expect(await askAction({}, form({ text }))).toEqual({ error: "Check the box to send this text to Anthropic's Claude.", field: "consent", text, consent: false });
    // A refusal about the text keeps the tick, so the retry isn't refused for the box (W10-7).
    expect(await askAction({}, form({ text: "too short", consent: "yes" }))).toEqual({
      error: "Paste the request: the email or checklist that asks for your documents.",
      field: "text",
      text: "too short",
      consent: true,
    });
  });

  it("reading a request: a completed check sends no tick back, so the box comes back unticked for the next text (Security SHOULD-V2a)", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "made-up-test-key");
    setAiProviderForTests(async () => ({ text: JSON.stringify({ items: [{ kind: "w9", label: "W-9", quote: "a W-9" }] }), inputTokens: 500, outputTokens: 100, truncated: false }));
    try {
      await signIn("form-ask-done@example.com");
      const text = "Before your first job we need a W-9 and a certificate of insurance.";
      const done = await askAction({}, form({ text, consent: "yes" }));
      expect(done.items?.map((i) => i.label)).toEqual(["W-9"]);
      expect(done).not.toHaveProperty("consent");
      expect(done).not.toHaveProperty("error");
    } finally {
      setAiProviderForTests(null);
    }
  });

  it("deleting the account: a wrong confirmation goes to its field and keeps what was typed", async () => {
    await signIn("form-delete@example.com");
    expect(await deleteMyAccount({}, form({ confirm: "delete" }))).toEqual({ error: "Type DELETE, in capitals, to confirm.", field: "confirm", typed: "delete" });
  });

  it("deleting the account after an old sign-in: says why, and the fix is signing in again", async () => {
    const ctx = await signIn("form-delete-old@example.com");
    await startSession({ userId: ctx.userId, demo: false, authAt: Math.floor(Date.now() / 1000) - 3600, sessionId: ctx.sessionId });
    // Every refusal keeps what was typed, so the retry the message asks for isn't refused for an empty field (W9-5).
    expect(await deleteMyAccount({}, form({ confirm: "DELETE" }))).toEqual({ error: "For your security, sign in again to delete your account.", reauth: true, typed: "DELETE" });
  });

  it("Move to Pro: an unticked box is the only refusal that marks the box; a ticked box stays ticked through any other refusal (W9-6)", async () => {
    await signIn("form-upgrade@example.com");
    expect(await upgrade({}, form({}))).toEqual({ error: "Check the box to agree to the Terms, including billing and refunds.", field: "agree" });
    // Payments are off in this test file: the refusal is about payments, not the box, and the tick comes back.
    expect(await upgrade({}, form({ agree: "on" }))).toEqual({ error: "Payments aren't switched on yet.", agreed: true });
  });

  it("deleting the account while billing is off and a subscription we know is running: nothing is deleted, and the fix is writing to us at the address when one is set", async () => {
    const ctx = await signIn("form-delete-sub@example.com");
    await db.root((tx) =>
      tx.query("insert into app.billing (org_id, stripe_customer_id, stripe_subscription_id, status, plan) values ($1, 'cus_FormDeleteSub', 'sub_FormDeleteSub', 'active', 'pro')", [ctx.orgId]),
    );
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("CONTACT_EMAIL", "help@shipshape.example");
    expect(await deleteMyAccount({}, form({ confirm: "DELETE" }))).toEqual({
      error: "Your subscription couldn't be cancelled automatically, so nothing was deleted.",
      write: { contact: "help@shipshape.example" },
      typed: "DELETE",
    });
    vi.stubEnv("CONTACT_EMAIL", "");
    expect(await deleteMyAccount({}, form({ confirm: "DELETE" }))).toMatchObject({ write: { contact: null } });
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [ctx.orgId]))).toHaveLength(1);
  });
});

describe("the deletion refusal box", () => {
  const still = "Your subscription couldn't be cancelled automatically, so nothing was deleted.";

  it("names the one next step: sign in again, write to us at the address, or wait for payments", async () => {
    const old = await renderPage(DeleteRefused, { error: "For your security, sign in again to delete your account.", reauth: true });
    expect(old).toMatch(/<div[^>]*role="alert"[^>]*tabindex="-1"/);
    expect(actionsOf(old)).toEqual([{ tag: "a", label: "Sign in again", href: "/signin?next=delete" }]);

    const write = await renderPage(DeleteRefused, { error: still, write: { contact: "help@shipshape.example" } });
    expect(textOf(write)).toBe(`${still} Write to us and we'll cancel it; then delete your account.`);
    expect(actionsOf(write)).toEqual([{ tag: "a", label: "Write to us", href: "mailto:help@shipshape.example?subject=Cancel%20my%20ShipShape%20subscription" }]);

    const wait = await renderPage(DeleteRefused, { error: still, write: { contact: null } });
    expect(textOf(wait)).toBe(`${still} ShipShape can't cancel it until payments are back on. Try again later: deleting cancels it for you.`);
    expect(actionsOf(wait)).toEqual([]);
  });
});
