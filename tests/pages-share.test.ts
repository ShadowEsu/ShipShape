import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { askAction } from "@/app/app/ask/actions";
import AskPage from "@/app/app/ask/page";
import { addVendorAction } from "@/app/app/collect/actions";
import VendorPage from "@/app/app/collect/[id]/page";
import { VendorLinkReady } from "@/app/app/collect/forms";
import CollectPage from "@/app/app/collect/page";
import DeadlinesPage from "@/app/app/deadlines/page";
import PassportDetail from "@/app/app/passport/[id]/page";
import { makePassport } from "@/app/app/passport/actions";
import { PassportReady } from "@/app/app/passport/forms";
import PassportPage from "@/app/app/passport/page";
import { deleteMyAccount } from "@/app/app/settings/actions";
import SettingsPage from "@/app/app/settings/page";
import { fmtDay } from "@/components/app-ui";
import { addVendor, createVendorLink } from "@/lib/server/collect";
import { asService, asUser } from "@/lib/server/db";
import { createPassport } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, finishSignIn, requireWorkspace, startSession } from "@/lib/server/session";
import { freshDb, type TestDb } from "./support/db";
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
async function signIn(email: string): Promise<Ctx> {
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

/** The labels of the page's primary buttons and button-styled links (class "btn"): the one thing it asks of you. */
const primary = (html: string) => [...html.matchAll(/<(a|button)\b[^>]*\bclass="btn"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => textOf(m[2]));

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

  it("with documents and no links yet: shows what a link will look like, and Make the link is the one action", async () => {
    const ctx = await signIn("passport-nolinks@example.com");
    await addDoc(ctx, "Liability certificate");
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain("No links yet");
    expect(textOf(html)).toContain("Each link you make shows here with who it's for, how often it was opened and the day it stops working");
    expect(primary(html)).toEqual(["Make the link"]);
  });

  it("under the 7/30/90-day choice, says the day the link will stop working for the chosen length (30 days at first)", async () => {
    const ctx = await signIn("passport-enddate@example.com");
    await addDoc(ctx, "Liability certificate");
    const html = await renderPage(PassportPage, none());
    const in30 = fmtDay(new Date(Date.now() + 30 * 86_400_000).toISOString());
    expect(textOf(html)).toContain(`7 days 30 days 90 days Stops working on ${in30}. You can turn it off sooner.`);
  });

  it("with a link: lists it instead of the example", async () => {
    const ctx = await signIn("passport-link@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    await createPassport(ctx, { label: "Northwind onboarding", days: 30, documentIds: [doc] });
    const html = await renderPage(PassportPage, none());
    expect(textOf(html)).toContain("Northwind onboarding ✓ Working 1 document · opened 0 times");
    expect(textOf(html)).not.toContain("No links yet");
  });

  it("a link past its planned end reads as ended, in neutral colours, not as an expired fault", async () => {
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

  it("a made link ends calmly: who it's for, what it shares, what happens next, and only Copy link", async () => {
    const html = await renderPage(PassportReady, { label: "Northwind onboarding", documents: 2, days: 30, url: "https://example.test/p/x#y" });
    expect(textOf(html)).toContain("Your link for Northwind onboarding is ready It shares 2 documents for 30 days.");
    expect(textOf(html)).toContain("Each time someone opens it, you'll see it under Your links.");
    expect(actionsOf(html).map((a) => a.label)).toEqual(["Copy link"]);
  });
});

describe("Collect", () => {
  it("with no vendors: a ghosted example vendor, and a button to the form's first field", async () => {
    await signIn("collect-empty@example.com");
    const html = await renderPage(CollectPage, {});
    expect(textOf(html)).toContain("No vendors yet Each vendor you add shows here with what you asked them for and where it stands.");
    const example = /<div aria-hidden="true"[^>]*>([\s\S]*?)<\/ul><\/div>/.exec(html)?.[1] ?? "";
    expect(textOf(example)).toBe("Example Ace Electric · W-9 ✓ · Insurance missing");
    expect(actionsOf(html).filter((a) => a.label === "Add your first vendor")).toEqual([{ tag: "button", label: "Add your first vendor", href: undefined }]);
    // The field it focuses is on the page; the form's own button stays the one primary action.
    expect(html).toContain('id="vendor-name"');
    expect(primary(html)).toEqual(["Add vendor"]);
  });

  it("a vendor without files or a link: says to make a link and send it", async () => {
    const ctx = await signIn("collect-nolink@example.com");
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({}) });
    expect(textOf(html)).toContain("Nothing received yet Make an upload link under Ask for the files and send it to Rivera Electric.");
    expect(textOf(html)).toContain("Links you make show here with the day they stop working.");
    expect(primary(html)).toEqual(["Make an upload link"]);
  });

  it("a vendor with a working link and no files yet: says it's waiting and until when", async () => {
    const ctx = await signIn("collect-waiting@example.com");
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    await createVendorLink(ctx, { vendorId, days: 7 });
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({}) });
    expect(textOf(html)).toMatch(/Waiting for Rivera Electric Your upload link works until \w{3} \d{1,2}, \d{4}\. Their files land here as soon as they send them/);
    expect(textOf(html)).not.toContain("Nothing received yet");
  });

  it("turning off an upload link that was already off says there's nothing more to do", async () => {
    const ctx = await signIn("collect-off@example.com");
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({ error: "off" }) });
    expect(textOf(html)).toContain("This link was already off, so nobody can use it. There's nothing more to do.");
  });

  it("an archived vendor says how to ask for files again", async () => {
    const ctx = await signIn("collect-archived@example.com");
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    await db.root((tx) => tx.query("update app.vendors set status = 'archived' where id = $1", [vendorId]));
    const html = await renderPage(VendorPage, { params: Promise.resolve({ id: vendorId }), searchParams: Promise.resolve({}) });
    expect(textOf(html)).toContain("Restore it to ask for files again.");
    expect(primary(html)).toEqual([]);
    expect(actionsOf(html).map((a) => a.label)).toContain("Restore");
  });

  it("a made upload link ends calmly: for whom, how long, what happens next, and only Copy link", async () => {
    const html = await renderPage(VendorLinkReady, { vendorName: "Rivera Electric", days: 30, url: "https://example.test/c/x#y" });
    expect(textOf(html)).toContain("Upload link for Rivera Electric is ready It works for 30 days.");
    expect(textOf(html)).toContain("The files they send land under Files received.");
    expect(actionsOf(html).map((a) => a.label)).toEqual(["Copy link"]);
  });
});

describe("Deadlines", () => {
  it("with no dates: shows what will appear and one verb button, and on Free doesn't promise reminders ShipShape won't send", async () => {
    await signIn("deadlines-empty@example.com");
    const html = await renderPage(DeadlinesPage, {});
    expect(textOf(html)).toContain("No dates yet Expiry and renewal dates from your certificates, licenses and agreements show here, soonest first");
    expect(primary(html)).toEqual(["Add an expiry date"]);
    expect(textOf(html)).toContain("Add them to your calendar and it reminds you 30 and 7 days before.");
    expect(textOf(html)).not.toContain("ShipShape reminds owners and admins");
    expect(textOf(html)).toContain("Nothing here: on the Free plan ShipShape doesn't send reminders.");
  });

  it("with a document but no dates: the action goes to that document's expiry field, by name", async () => {
    const ctx = await signIn("deadlines-nodates@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const html = await renderPage(DeadlinesPage, {});
    expect(primary(html)).toEqual(["Add an expiry date to Liability certificate"]);
    expect(actionsOf(html).find((a) => a.label === "Add an expiry date to Liability certificate")?.href).toBe(`/app/documents/${doc}#expires_on`);
  });

  it("with nothing in the next 90 days: says so calmly, with the reminder that's really coming", async () => {
    const ctx = await signIn("deadlines-quiet@example.com");
    await addDoc(ctx, "Liability certificate", 120);
    const html = await renderPage(DeadlinesPage, {});
    expect(textOf(html)).toContain("Nothing expires in the next 90 days. Add these dates to your calendar and it reminds you 30 and 7 days before.");
    expect(primary(html)).toEqual([]);
  });

  it("with something due within 90 days: no all-clear", async () => {
    const ctx = await signIn("deadlines-due@example.com");
    await addDoc(ctx, "Liability certificate", 60);
    const html = await renderPage(DeadlinesPage, {});
    expect(textOf(html)).not.toContain("Nothing expires in the next 90 days");
  });

  it("on Pro (the sample workspace): says ShipShape sends the reminders", async () => {
    // As "Try the sample" signs in: an anonymous user, then the seeded sample workspace.
    const userId = await createLocalUser(null, true);
    const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Sample') as id", [userId]));
    await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
    await finishSignIn(userId, { demo: true });
    const html = await renderPage(DeadlinesPage, {});
    expect(textOf(html)).toContain("ShipShape reminds owners and admins 90, 30 and 7 days before");
  });
});

describe("What are they asking for?", () => {
  it("with AI switched off: one line on what that means, and one way forward", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "");
    await signIn("ask-off@example.com");
    const html = await renderPage(AskPage, {});
    expect(textOf(html)).toContain("Reading requests with AI is switched off right now, so check the request against your documents yourself");
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Open your documents", href: "/app/documents" }]);
  });
});

describe("Settings", () => {
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
    await signIn("settings-pending@example.com");
    const html = await afterCheckout();
    expect(textOf(html)).toContain("Thanks. Pro switches on as soon as Stripe confirms the payment, usually within seconds. Check again");
    expect(actionsOf(html).find((a) => a.label === "Check again")?.href).toBe("/app/settings?billing=success");
  });

  it("back from checkout once Stripe confirmed: says it's done and what changed, nothing else", async () => {
    const ctx = await signIn("settings-pro@example.com");
    await bill(ctx, "active");
    const html = await afterCheckout();
    expect(textOf(html)).toContain("You're on Pro now. The limits are gone and email reminders are on.");
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Check again");
  });

  it("a failed payment: what it means, how long Pro lasts, and the one fix", async () => {
    const ctx = await signIn("settings-pastdue@example.com");
    await bill(ctx, "past_due");
    const html = await settings();
    expect(textOf(html)).toContain(
      "Your last payment didn't go through. Pro stays on for 7 days after a payment fails; update your card with Manage billing below.",
    );
  });

  it("export needing a fresh sign-in: one line, and Sign in again in place of the download", async () => {
    await signIn("settings-reauth@example.com");
    const html = await settings("reauth");
    expect(textOf(html)).toContain("For your security, sign in again before you export.");
    const labels = actionsOf(html).map((a) => a.label);
    expect(labels).toContain("Sign in again");
    expect(actionsOf(html).find((a) => a.label === "Sign in again")?.href).toBe("/signin");
    expect(labels).not.toContain("Download the export");
  });

  it("export by someone who can't: says who can, and offers no download", async () => {
    await signIn("settings-role@example.com");
    const html = await settings("role");
    expect(textOf(html)).toContain("Only owners and admins can export this workspace. Ask one of them for the file.");
    expect(actionsOf(html).map((a) => a.label)).not.toContain("Download the export");
  });

  it("export too large: says how large, and the one way forward (write to us when there's an address)", async () => {
    await signIn("settings-size@example.com");
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
    const ctx = await signIn("settings-plain@example.com");
    const html = await settings();
    expect(actionsOf(html).map((a) => a.label)).toContain("Download the export");
    expect(textOf(html)).toContain(`Deleted with everything in it ${ctx.name}`);
    expect(textOf(html)).toContain("Payments aren't switched on yet, so the plan can't change for now.");
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

  it("a second passport link on Free: the limit, and the one fix (turn the open link off)", async () => {
    const ctx = await signIn("form-passport-limit@example.com");
    const doc = await addDoc(ctx, "Liability certificate");
    const made = await makePassport({}, form({ label: "First", days: "30", doc }));
    expect(made.created).toMatchObject({ label: "First", documents: 1, days: 30 });
    const refused = await makePassport({}, form({ label: "Second", days: "30", doc }));
    expect(refused.error).toBe("The Free plan has 1 passport link open at a time. Turn one off, or move to Pro for more.");
    expect(refused.fix).toEqual({ href: `/app/passport/${made.created?.id}`, label: "Turn off your open link" });
  });

  it("a new vendor: a mistyped email goes to the email field", async () => {
    await signIn("form-vendor@example.com");
    expect(await addVendorAction({}, form({ name: "Rivera Electric", email: "ap at rivera", kind: "w9" }))).toEqual({
      fieldErrors: { email: "That email address doesn't look right. Check it, or leave the field empty." },
      values: { name: "Rivera Electric", email: "ap at rivera", kinds: ["w9"] },
    });
  });

  it("reading a request: the missing tick goes to the box, the pasted text stays", async () => {
    vi.stubEnv("SHIPSHAPE_AI", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key");
    await signIn("form-ask@example.com");
    const text = "Before your first job we need a W-9 and a certificate of insurance.";
    expect(await askAction({}, form({ text }))).toEqual({ error: "Check the box to send this text to Anthropic's Claude.", field: "consent", text });
  });

  it("deleting the account: a wrong confirmation goes to its field and keeps what was typed", async () => {
    await signIn("form-delete@example.com");
    expect(await deleteMyAccount({}, form({ confirm: "delete" }))).toEqual({ error: "Type DELETE, in capitals, to confirm.", field: "confirm", typed: "delete" });
  });

  it("deleting the account after an old sign-in: says why, and the fix is signing in again", async () => {
    const ctx = await signIn("form-delete-old@example.com");
    await startSession({ userId: ctx.userId, demo: false, authAt: Math.floor(Date.now() / 1000) - 3600 });
    expect(await deleteMyAccount({}, form({ confirm: "DELETE" }))).toEqual({ error: "For your security, sign in again to delete your account.", reauth: true });
  });
});
