import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as exportHistory } from "@/app/app/history/export/route";
import HistoryPage from "@/app/app/history/page";
import { turnOff } from "@/app/app/passport/actions";
import SentPage from "@/app/app/sent/page";
import SignedPage from "@/app/app/signed/page";
import { Icon, type IconName } from "@/components/icons";
import { historyIcon, historyLabel } from "@/lib/history";
import {
  listHistory,
  listSent,
  listSignedCopies,
  readsAllHistory,
  sentLink,
  sentSignature,
  type HistoryQuery,
  type SentLink,
  type SentSignature,
} from "@/lib/server/activity";
import { csvCell } from "@/lib/server/csv";
import { asService, asUser } from "@/lib/server/db";
import { setArchived } from "@/lib/server/documents";
import { completeSigning, createSignatureRequest, sendSigningCode } from "@/lib/server/esign";
import { visitorId } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { SAMPLE_ACTIVITY, seedSampleActivity, seedSampleWorkspace } from "@/lib/server/sample";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";
import { actionsOf, renderPage, textOf } from "./support/render";

/**
 * Sent, Signed copies and History (calm v2, PR 4; Security S1-S6): each workspace sees only its own; owners and admins
 * read all of History and export it, a member only its documents' rows; a link's visitors are counted, never named;
 * a signer is the name the sender typed; an archived document's rows lose their title; Export is exactly what's shown.
 */

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
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.45" }),
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
let blobDir: string;
/** The sample workspace's owner, with the sample's activity seeded; `sessions` holds each person's cookie. */
let owner: Ctx;
const sessions = new Map<string, Map<string, { value: string; options?: Record<string, unknown> }>>();

async function sampleOwner(): Promise<Ctx> {
  const userId = await createLocalUser(null, true);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  await seedSampleActivity(org.id, userId);
  return signedIn(userId, true);
}

/** Signs `userId` in (the cookie jar, as the sign-in page does) and keeps the cookie so `as` can switch back. */
async function signedIn(userId: string, demo: boolean): Promise<Ctx> {
  jar.clear();
  await finishSignIn(userId, { demo });
  sessions.set(userId, new Map(jar));
  return requireWorkspace();
}

function as(ctx: Ctx) {
  jar.clear();
  for (const [k, v] of sessions.get(ctx.userId) ?? []) jar.set(k, v);
}

/** Someone added to the owner's workspace with this role, signed in. */
async function teammate(role: "admin" | "member", email: string): Promise<Ctx> {
  const userId = await db.user(email);
  await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, $3)", [owner.orgId, userId, role]));
  const ctx = await signedIn(userId, false);
  // Someone who joined a workspace signs in to it, not to a new one of their own.
  expect([ctx.orgId, ctx.role]).toEqual([owner.orgId, role]);
  return ctx;
}

const exportRequest = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://localhost/app/history/export", { method: "POST", headers: { origin: "http://localhost", host: "localhost" }, body: form });
};

function params<T>(v: T) {
  return { searchParams: Promise.resolve(v) };
}

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-activity-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  owner = await sampleOwner();
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

describe("the sample's activity (seeded through the real functions)", () => {
  it("has a link opened three times by two visitors and downloaded from, a signed NDA and a request still waiting, all marked (sample)", async () => {
    const sent = await listSent(owner, null);
    const links = sent.filter((r): r is SentLink => r.kind === "link");
    const signatures = sent.filter((r): r is SentSignature => r.kind === "signature");
    expect(links.map((l) => [l.label, l.documents, l.opens, l.downloads])).toEqual([[SAMPLE_ACTIVITY.link, 3, 3, 2]]);
    expect(new Map(signatures.map((s) => [s.signerName, s.status]))).toEqual(
      new Map([
        [SAMPLE_ACTIVITY.waiting.name, "pending"],
        [SAMPLE_ACTIVITY.signed.name, "signed"],
      ]),
    );
    expect(signatures).toHaveLength(2);
    expect([...links.map((l) => l.label), ...signatures.map((s) => s.signerName), ...signatures.map((s) => s.title)].every((t) => t.endsWith("(sample)"))).toBe(true);

    const [copy] = await listSignedCopies(owner);
    expect([copy.signerName, copy.signedVersion, copy.title]).toEqual([SAMPLE_ACTIVITY.signed.name, 2, expect.stringContaining("(sample)")]);
    const emails = await db.root((tx) => tx.query<{ e: string }>("select signer_email as e from app.signature_requests where org_id = $1", [owner.orgId]));
    expect(emails.every((r) => r.e.endsWith(".example"))).toBe(true);
  });
});

describe("Sent", () => {
  it("counts a link's opens and visitors and never names one (S3)", async () => {
    const [link] = (await listSent(owner, null)).filter((r) => r.kind === "link");
    const detail = await sentLink(owner, link.id);
    expect(detail?.opened).toMatchObject({ count: 3, visitors: 2 });
    expect(detail?.downloads.map((d) => d.count)).toEqual([1, 1]);
    const shown = JSON.stringify(detail);
    for (const ip of SAMPLE_ACTIVITY.visitors) {
      expect(shown).not.toContain(ip);
      expect(shown).not.toContain(visitorId(ip));
    }
    as(owner);
    const page = textOf(await renderPage(SentPage, params({ open: `link-${link.id}` })));
    expect(page).toContain("3 times, 2 visitors");
    expect(page).toContain("A link can be opened by anyone who has it, so opens are counted, not named.");
  });

  it("names a signer as the sender typed them, never by the name they signed with or their email (S4)", async () => {
    const [nda] = await db.root((tx) => tx.query<{ id: string }>("select id from app.documents where org_id = $1 and template_id = 'common-paper-mnda'", [owner.orgId]));
    const req = await createSignatureRequest(owner, { documentId: nda.id, signerName: "Pat Example (sample)", signerEmail: "pat.private@northwind.example", days: 7 });
    expect(await sendSigningCode(req.id, req.token)).toBe("ok");
    const [m] = await db.root((tx) => tx.query<{ body: string }>("select body from app.outbox where org_id = $1 and to_email = $2", [owner.orgId, "pat.private@northwind.example"]));
    const code = /\bis (\d{6})\./.exec(m.body)?.[1] ?? "";
    expect(await completeSigning(req.id, req.token, { code, typedName: "Patricia Quill Typed", consented: true, ip: "192.0.2.77" })).toBe("ok");

    const everything = JSON.stringify([await listSent(owner, null), await sentSignature(owner, req.id), await listSignedCopies(owner), await listHistory(owner, { tab: "all", mine: false, days: 7 })]);
    expect(everything).toContain("Pat Example (sample)");
    expect(everything).not.toContain("Patricia Quill Typed");
    expect(everything).not.toContain("pat.private@");
    as(owner);
    expect(textOf(await renderPage(SignedPage, {}))).toContain("Signed by Pat Example (sample)");
  });

  it("turns a working link off from its detail and comes back to it, now Turned off; a second try lands there too", async () => {
    as(owner);
    const [link] = (await listSent(owner, null)).filter((r) => r.kind === "link");
    const detailOf = async () => renderPage(SentPage, params({ open: `link-${link.id}` }));
    expect(actionsOf(await detailOf()).map((a) => a.label)).toContain("Turn off this link");
    const form = new FormData();
    form.set("id", link.id);
    form.set("back", "sent");
    // Exact messages: toThrow(string) matches a substring, which a trailing ?error=off would still pass.
    await expect(turnOff(form)).rejects.toMatchObject({ message: `redirect /app/sent?open=link-${link.id}` });
    const after = await detailOf();
    expect(actionsOf(after).map((a) => a.label)).not.toContain("Turn off this link");
    expect(textOf(after)).toContain("Turned off");
    await expect(turnOff(form)).rejects.toMatchObject({ message: `redirect /app/sent?open=link-${link.id}` });
    // From the link's own page (no back), the already-off words, as before.
    form.delete("back");
    await expect(turnOff(form)).rejects.toMatchObject({ message: `redirect /app/passport/${link.id}?error=off` });
  });

  it("shows nothing of another workspace: lists, details, History and its export (S1)", async () => {
    const [link] = (await listSent(owner, null)).filter((r) => r.kind === "link");
    const [sig] = (await listSent(owner, null)).filter((r) => r.kind === "signature");
    const other = await signedIn(await createLocalUser("activity-other@example.com", false), false);
    expect(other.orgId).not.toBe(owner.orgId);
    expect(await listSent(other, null)).toEqual([]);
    expect(await listSignedCopies(other)).toEqual([]);
    expect(await sentLink(other, link.id)).toBeNull();
    expect(await sentSignature(other, sig.id)).toBeNull();
    const { rows } = await listHistory(other, { tab: "all", mine: false, days: 90 });
    expect(rows.some((r) => r.what.includes("(sample)"))).toBe(false);
    const csv = await (await exportHistory(exportRequest({ tab: "all", who: "anyone", days: "90" }))).text();
    expect(csv).not.toContain("(sample)");
    expect(textOf(await renderPage(SentPage, params({ open: `link-${link.id}` })))).not.toContain(SAMPLE_ACTIVITY.link);
  });
});

describe("History", () => {
  it("gives owners and admins every row, the Account tab and Export; a member only its documents' rows (S2)", async () => {
    const admin = await teammate("admin", "activity-admin@example.com");
    const member = await teammate("member", "activity-member@example.com");
    expect([readsAllHistory(owner), readsAllHistory(admin), readsAllHistory(member)]).toEqual([true, true, false]);

    const ownerRows = (await listHistory(owner, { tab: "all", mine: false, days: 30 })).rows;
    const adminRows = (await listHistory(admin, { tab: "all", mine: false, days: 30 })).rows;
    expect(adminRows.map((r) => r.seq)).toEqual(ownerRows.map((r) => r.seq));
    expect(new Set(ownerRows.map((r) => r.tab))).toEqual(new Set(["documents", "links", "signatures", "account"]));
    expect((await listHistory(owner, { tab: "account", mine: false, days: 30 })).rows.every((r) => r.tab === "account")).toBe(true);

    const memberRows = (await listHistory(member, { tab: "all", mine: false, days: 30 })).rows;
    expect(memberRows.length).toBeGreaterThan(0);
    expect(memberRows.every((r) => r.tab !== "account" && r.href?.startsWith("/app/documents/"))).toBe(true);
    expect(memberRows.length).toBeLessThan(ownerRows.length);
    // Asking for the Account tab gives a member what All gives them, nothing more.
    expect((await listHistory(member, { tab: "account", mine: false, days: 30 })).rows.map((r) => r.seq)).toEqual(memberRows.map((r) => r.seq));

    as(member);
    const memberPage = await renderPage(HistoryPage, params({}));
    expect(actionsOf(memberPage).map((a) => a.label)).not.toContain("Export");
    expect(actionsOf(memberPage).map((a) => a.label)).not.toContain("Account");
    await expect(exportHistory(exportRequest({ tab: "all", who: "anyone", days: "30" }))).rejects.toThrow("redirect /app/history?error=role");

    as(admin);
    const adminPage = await renderPage(HistoryPage, params({}));
    expect(actionsOf(adminPage).map((a) => a.label)).toEqual(expect.arrayContaining(["Export", "Account"]));
  });

  it("names a kept person on their People rows, and only while they're kept (0046 keeps the name out of the audit row)", async () => {
    const [priya] = await db.root((tx) => tx.query<{ id: string }>("select id from app.contacts where org_id = $1 and name = 'Priya Shah (sample)'", [owner.orgId]));
    const added = () => listHistory(owner, { tab: "account", mine: false, days: 30 }).then(({ rows }) => rows.filter((r) => r.what.startsWith("Added to People")));
    expect((await added()).find((r) => r.href === `/app/people/${priya.id}`)?.what).toBe("Added to People · Priya Shah (sample)");
    await db.root((tx) => tx.query("delete from app.contacts where id = $1", [priya.id]));
    const after = await added();
    expect(after.some((r) => r.what.includes("Priya"))).toBe(false);
    expect(after.filter((r) => r.href === null).map((r) => r.what)).toEqual(["Added to People"]);
  });

  it("gives each row the icon of the sidebar item it belongs to: People, Collect, Business facts; Settings only for the workspace's own", async () => {
    const rows = (await listHistory(owner, { tab: "all", mine: false, days: 30 })).rows;
    const iconsOf = (start: string) => [...new Set(rows.filter((r) => r.what.startsWith(start)).map((r) => r.icon))];
    expect(iconsOf("Added to People")).toEqual(["people"]);
    expect(iconsOf("Vendor added")).toEqual(["collect"]);
    expect(iconsOf("Collect link made")).toEqual(["collect"]);
    expect(iconsOf("A vendor sent a document")).toEqual(["collect"]);
    expect(iconsOf("Business facts changed")).toEqual(["facts"]);
    expect(iconsOf("Workspace created")).toEqual(["settings"]);
    const byTab = (tab: string) => [...new Set(rows.filter((r) => r.tab === tab).map((r) => r.icon))];
    expect([byTab("documents"), byTab("links"), byTab("signatures")]).toEqual([["documents"], ["passport"], ["sign"]]);
    // And the page draws each row's own icon.
    as(owner);
    const html = await renderPage(HistoryPage, params({}));
    const rowOf = (start: string) => html.split('<li class="history-row">').find((r) => textOf(r).includes(start)) ?? "";
    const svg = (name: IconName) => renderToStaticMarkup(createElement(Icon, { name, size: 17 }));
    expect([rowOf("Added to People").includes(svg("people")), rowOf("Vendor added").includes(svg("collect")), rowOf("Workspace created").includes(svg("settings"))]).toEqual([
      true,
      true,
      true,
    ]);
    expect(historyIcon("ai.request_read", "account")).toBe("check");
    expect([historyLabel("vendor.archived", null), historyLabel("vendor.restored", null), historyLabel("esign.declined", null)]).toEqual([
      "Vendor archived",
      "Vendor restored",
      "Signer declined",
    ]);
  });

  it("'You' shows only what the viewer did", async () => {
    const mine = (await listHistory(owner, { tab: "all", mine: true, days: 30 })).rows;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.who === "You")).toBe(true);
    const all = (await listHistory(owner, { tab: "all", mine: false, days: 30 })).rows;
    expect(all.some((r) => r.who === "Signer")).toBe(true);
    // The sample's made-up vendor uploads are stored by its setup, as the owner; they're still the vendor's.
    const received = all.filter((r) => r.what === "A vendor sent a document");
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((r) => r.who === "Vendor")).toBe(true);
    expect(mine.some((r) => r.what === "A vendor sent a document")).toBe(false);
  });

  it("exports exactly the rows and columns shown, logs the export, and refuses another site (S6)", async () => {
    as(owner);
    const choice: HistoryQuery = { tab: "signatures", mine: false, days: 30 };
    const { rows } = await listHistory(owner, choice);
    const res = await exportHistory(exportRequest({ tab: "signatures", who: "anyone", days: "30" }));
    expect(rows.length).toBeGreaterThan(0);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="shipshape-history-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await res.text()).split("\r\n");
    // One line per row shown, in order: when (UTC), the sentence, who; nothing else (no ids, no visitor, no email).
    expect(lines).toEqual(["when,what,who", ...rows.map((r) => [new Date(r.at).toISOString(), r.what, r.who].map(csvCell).join(",")), ""]);
    const [logged] = await db.root((tx) => tx.query<{ n: number }>("select count(*)::int as n from app.audit_log where org_id = $1 and action = 'workspace.exported'", [owner.orgId]));
    expect(logged.n).toBe(1);

    const cross = new Request("http://localhost/app/history/export", { method: "POST", headers: { origin: "https://evil.example", host: "localhost" }, body: new FormData() });
    expect((await exportHistory(cross)).status).toBe(403);
  });

  it("keeps an archived document's rows without its title or link, and drops its signatures from Sent and Signed copies (S5)", async () => {
    const [nda] = await db.root((tx) => tx.query<{ id: string; title: string }>("select id, title from app.documents where org_id = $1 and template_id = 'common-paper-mnda'", [owner.orgId]));
    await setArchived(owner, nda.id, true);
    expect((await listSent(owner, null)).filter((r) => r.kind === "signature")).toEqual([]);
    expect(await listSignedCopies(owner)).toEqual([]);
    const { rows } = await listHistory(owner, { tab: "signatures", mine: false, days: 30 });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(nda.title);
    expect(rows.some((r) => r.what.endsWith("· a document") && r.href === null)).toBe(true);
    as(owner);
    expect(textOf(await renderPage(SignedPage, {}))).toContain("When someone signs a document you sent for signature");
  });
});

describe("History's day", () => {
  it("reads today's rows in the default 30 days", async () => {
    as(owner);
    const text = textOf(await renderPage(HistoryPage, params({ who: "me" })));
    expect(text).toContain(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }));
  });
});
