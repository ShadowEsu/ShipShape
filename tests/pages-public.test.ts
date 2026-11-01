import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UpgradeForm } from "@/app/app/settings/billing-forms";
import CollectPage from "@/app/c/[id]/page";
import { POST as upload } from "@/app/c/[id]/upload/route";
import PassportPage from "@/app/p/[id]/page";
import { fmtDay } from "@/components/app-ui";
import SigningPage from "@/app/s/[id]/page";
import { SignButton } from "@/app/s/[id]/sign-form";
import { signIn } from "@/app/signin/actions";
import SignInPage from "@/app/signin/page";
import TermsPage from "@/app/terms/page";
import { addVendor, createVendorLink, receiveFile, revokeVendorLink } from "@/lib/server/collect";
import { sha256Hex } from "@/lib/server/crypto";
import { asAnon, asService, asUser } from "@/lib/server/db";
import { listDocuments } from "@/lib/server/documents";
import { completeSigning, requestSignature, revokeSignatureRequest, sendSigningCode } from "@/lib/server/esign";
import { rateLimited } from "@/lib/server/http";
import { createPassport, revokePassport } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { actionsOf, renderPage, textOf } from "./support/render";

/** The pages people outside a workspace open: each state says what it means and offers one way on. */

// The request's cookies and headers, as Next.js would hold them.
const jar = vi.hoisted(() => new Map<string, string>());
const visitor = vi.hoisted(() => ({ ip: "198.51.100.1" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": visitor.ip }),
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
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let db: TestDb;
let blobDir: string;
let sample: Ctx;
let visitors = 0;

async function sampleWorkspace(): Promise<Ctx> {
  const userId = await db.user(null);
  const [org] = await asService((tx) => tx.query<{ id: string }>("select app.create_sample_workspace($1, 'Harbor Plumbing (sample)') as id", [userId]));
  await asUser(userId, (tx) => seedSampleWorkspace(tx, org.id, userId));
  return { userId, demo: true, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Plumbing (sample)", role: "owner", today: isoToday() };
}

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-pages-"));
  setBlobStoreForTests(localBlobStore(blobDir));
  sample = await sampleWorkspace();
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

beforeEach(() => {
  // A new network per test, so no test inherits another's page-view count; no report link (CONTACT_EMAIL unset).
  visitor.ip = `198.51.100.${++visitors}`;
  vi.stubEnv("CONTACT_EMAIL", "");
});
afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

const props = (id: string, search: Record<string, string> = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });

const passportPage = (id: string) => renderPage(PassportPage, props(id));
const signingPage = (id: string) => renderPage(SigningPage, props(id));
const collectPage = (id: string, search: Record<string, string> = {}) => renderPage(CollectPage, props(id, search));

/** The page's text as read: no gap left before punctuation where React split the text around a value. */
const said = (html: string) => textOf(html).replace(/ ([.,;])/g, "$1");

/** The same token with its last character changed: well-formed, and wrong. */
const otherToken = (token: string) => token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

/** The one thing a closed link offers: a drafted email asking whoever sent it for a new one. */
function expectAskForNewLink(html: string) {
  const actions = actionsOf(html);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ tag: "a", label: "Ask for a new link" });
  expect(actions[0].href).toMatch(/^mailto:\?subject=/);
}

describe("a passport link (/p)", () => {
  it("opened from the full link, shows the page's frame and says what is opening while the link is checked", async () => {
    const docs = await listDocuments(sample);
    const { id } = await createPassport(sample, { label: "Opening", days: 30, documentIds: [docs[0].id] });
    const html = await passportPage(id);
    expect(html).toMatch(/<div aria-busy="true"[^>]*><p role="status"[^>]*>Opening the shared documents…<\/p>/);
  });

  it("shows each shared document with its status in words and its own download", async () => {
    const docs = await listDocuments(sample);
    const { id, token } = await createPassport(sample, { label: "For Northwind", days: 30, documentIds: docs.slice(0, 2).map((d) => d.id) });
    jar.set("ss_passport", token);
    const html = await passportPage(id);
    const text = textOf(html);
    expect(text).toContain("Harbor Plumbing (sample)");
    expect(text).toMatch(/Current|Expired|Expires soon|No expiry date/);
    expect(actionsOf(html).filter((a) => a.label === "Download")).toHaveLength(2);
  });

  it("once turned off, says so to the holder of the link, names the fix, and offers one action; no date, no sender", async () => {
    const docs = await listDocuments(sample);
    const { id, token } = await createPassport(sample, { label: "Turned off", days: 7, documentIds: [docs[0].id] });
    await revokePassport(sample, id);
    jar.set("ss_passport", token);
    const html = await passportPage(id);
    expect(textOf(html)).toContain("This link was turned off Whoever sent it turned it off. Ask them for a new one.");
    expect(textOf(html)).not.toContain("Turned off");
    expect(textOf(html)).not.toContain("Harbor Plumbing");
    expectAskForNewLink(html);
  });

  it("once past its end, tells the holder of the link when it stopped working; a wrong token learns nothing (Security row 18)", async () => {
    const docs = await listDocuments(sample);
    const { id, token } = await createPassport(sample, { label: "Ran out", days: 7, documentIds: [docs[0].id] });
    const [row] = await db.root((tx) =>
      tx.query<{ at: string }>("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 hour' where id = $1 returning expires_at::text as at", [id]),
    );
    jar.set("ss_passport", token);
    const html = await passportPage(id);
    expect(said(html)).toContain(`This link has expired It stopped working on ${fmtDay(row.at)}. Ask whoever sent it for a new one.`);
    expect(said(html)).not.toMatch(/\d:\d\d [AP]M/);
    expect(textOf(html)).not.toContain("Ran out");
    expectAskForNewLink(html);

    jar.set("ss_passport", otherToken(token));
    const wrong = await passportPage(id);
    expect(textOf(wrong)).toContain("This link has stopped working It has expired or been turned off. Ask whoever sent it for a new one.");
    expect(textOf(wrong)).not.toContain("stopped working on");
  });

  it("the database itself answers a link's state only for its own token hash, with a date for an expired link and none for a turned-off one", async () => {
    const docs = await listDocuments(sample);
    const off = await createPassport(sample, { label: "Off", days: 7, documentIds: [docs[0].id] });
    await revokePassport(sample, off.id);
    const state = (id: string, token: string) =>
      asAnon((tx) => tx.query<{ state: string; ended_at: string | null }>("select state, ended_at::text as ended_at from app.passport_state($1, $2)", [id, sha256Hex(token)]));
    expect(await state(off.id, off.token)).toEqual([{ state: "revoked", ended_at: null }]);
    expect(await state(off.id, otherToken(off.token))).toEqual([]);
    const live = await createPassport(sample, { label: "Live", days: 7, documentIds: [docs[0].id] });
    expect(await state(live.id, live.token)).toEqual([]);
  });

  it("after too many views from one network, says to wait and reload, not that the link is gone", async () => {
    const docs = await listDocuments(sample);
    const { id, token } = await createPassport(sample, { label: "Busy", days: 7, documentIds: [docs[0].id] });
    for (let i = 0; i < 60; i++) await rateLimited("passport-view", visitor.ip, 60, 600);
    jar.set("ss_passport", token);
    const html = await passportPage(id);
    expect(textOf(html)).toContain("Too many tries from this network Wait 10 minutes, then reload this page.");
    expect(textOf(html)).not.toContain("stopped working");
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Reload this page", href: `/p/${id}` }]);
  });
});

describe("a signing link (/s)", () => {
  const request = async () => {
    const nda = (await listDocuments(sample)).find((d) => d.kind === "nda");
    if (!nda) throw new Error("the sample workspace has no NDA");
    return requestSignature(sample, { documentId: nda.id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 });
  };

  it("while open, says until when it can be signed", async () => {
    const { id, token } = await request();
    jar.set("ss_sign", token);
    expect(said(await signingPage(id))).toMatch(/Harbor Plumbing \(sample\) asked Jordan Lee to sign this document\. You can sign until \w{3} \d{1,2}, \d{4}\./);
  });

  it("the button that signs names the document", async () => {
    const html = await renderPage(SignButton, { title: "Mutual NDA", busy: false, signing: false });
    expect(actionsOf(html)).toEqual([{ tag: "button", label: "Sign the Mutual NDA", href: undefined }]);
  });

  it("opened from the full link, shows the page's frame and says it's opening while the link is checked", async () => {
    const { id } = await request();
    const html = await signingPage(id);
    expect(html).toMatch(/<div aria-busy="true"[^>]*><p role="status"[^>]*>Opening the document to sign…<\/p>/);
  });

  it("once withdrawn, says so to the holder of the link, names the fix, and offers one action", async () => {
    const { id, token } = await request();
    await revokeSignatureRequest(sample, id);
    jar.set("ss_sign", token);
    const html = await signingPage(id);
    expect(textOf(html)).toContain("This signing link was turned off Whoever sent it turned it off. Ask them for a new one.");
    expectAskForNewLink(html);
  });

  it("once past its end while unsigned, tells the holder when it stopped working; a wrong token learns nothing", async () => {
    const { id, token } = await request();
    const [row] = await db.root((tx) =>
      tx.query<{ at: string }>("update app.signature_requests set created_at = now() - interval '2 days', expires_at = now() - interval '1 hour' where id = $1 returning expires_at::text as at", [id]),
    );
    jar.set("ss_sign", token);
    const html = await signingPage(id);
    expect(said(html)).toContain(`This signing link has expired It stopped working on ${fmtDay(row.at)}. Ask whoever sent it for a new one.`);
    expectAskForNewLink(html);
    jar.set("ss_sign", otherToken(token));
    expect(textOf(await signingPage(id))).toContain("This signing link has stopped working It has expired or been turned off.");
  });

  it("once signed, ends calmly: done, who has the record, until when this copy stays here, and one action", async () => {
    const { id, token } = await request();
    expect(await sendSigningCode(id, token)).toBe("ok");
    const [m] = await db.root((tx) => tx.query<{ body: string }>("select body from app.outbox where org_id = $1 order by created_at desc limit 1", [sample.orgId]));
    const code = /\b(\d{6})\b/.exec(m.body)?.[1] ?? "";
    expect(await completeSigning(id, token, { code, typedName: "Jordan Lee", consented: true, ip: visitor.ip })).toBe("ok");
    jar.set("ss_sign", token);
    const html = await signingPage(id);
    const text = said(html);
    expect(text).toContain("Signed");
    expect(text).toMatch(
      /There's nothing else you need to do\. Harbor Plumbing \(sample\) has the same signed copy, saved to their documents in ShipShape\. The certificate at the end records the name you typed, when you signed, that a code sent to your email confirmed it, and a fingerprint of your network connection \(not your address\)\. Download yours for your records; this link works until \w{3} \d{1,2}, \d{4}\./,
    );
    expect(actionsOf(html)).toEqual([{ tag: "a", label: "Download the signed copy", href: `/s/${id}/file` }]);

    // Once that day has passed, the signer learns when the copy stopped being here, not that it was withdrawn.
    const [row] = await db.root((tx) =>
      tx.query<{ at: string }>("update app.signature_requests set created_at = now() - interval '2 days', expires_at = now() - interval '1 hour' where id = $1 returning expires_at::text as at", [id]),
    );
    expect(said(await signingPage(id))).toContain(`This signing link has expired It stopped working on ${fmtDay(row.at)}.`);
  });
});

describe("an upload link (/c)", () => {
  const link = async (ctx: Ctx, name: string) => {
    const vendorId = await addVendor(ctx, { name, email: "", requested: ["w9", "coi"] });
    return createVendorLink(ctx, { vendorId, days: 30 });
  };

  it("after a file arrives, says what was received and what's left, then that it's all done", async () => {
    const { id, token } = await link(sample, "Rivera Electric");
    jar.set("ss_collect", token);
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: null })).toBe("sent");
    expect(said(await collectPage(id, { r: "sent-w9", k: "w9" }))).toContain("Sent. Harbor Plumbing (sample) now has your W-9. 1 more document to send below.");
    expect(await receiveFile(id, token, { kind: "coi", expiresOn: "", file: null })).toBe("sent");
    const done = said(await collectPage(id, { r: "sent-coi", k: "coi" }));
    expect(done).toContain("That's everything Harbor Plumbing (sample) asked for, so you can close this page.");
  });

  it("a refused file: the fix sits under that document's file field, which is marked and takes focus", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const owner = await db.user("owner@example.com");
    const [org] = await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Harbor Test Co') as id"));
    const real: Ctx = { userId: owner, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Test Co", role: "owner", today: isoToday() };
    const { id, token } = await link(real, "Summit Supply");
    jar.set("ss_collect", token);
    // A post with no length is refused as too big before its form is read; the answer still names the document's form.
    const res = await upload(
      new Request(`http://shipshape.test/c/${id}/upload?k=coi`, {
        method: "POST",
        headers: { origin: "http://shipshape.test", host: "shipshape.test", "sec-fetch-site": "same-origin", "x-forwarded-for": visitor.ip },
      }),
      { params: Promise.resolve({ id }) },
    );
    const back = new URL(res.headers.get("location") ?? "", "http://shipshape.test");
    expect(`${back.pathname}${back.search}`).toBe(`/c/${id}?r=too_big&k=coi`);
    const html = await collectPage(id, Object.fromEntries(back.searchParams));
    const coi = /<input[^>]*id="file-coi"[^>]*>/.exec(html)?.[0] ?? "";
    expect(coi).toContain('aria-invalid="true"');
    expect(coi).toContain('aria-describedby="file-coi-error"');
    expect(coi).toContain("autofocus");
    expect(textOf(/<p id="file-coi-error"[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "")).toBe(
      "That file is over 4 MB. Send a smaller copy, such as a PDF scanned at a lower resolution.",
    );
    expect(/<input[^>]*id="file-w9"[^>]*>/.exec(html)?.[0]).not.toContain("aria-invalid");
  });

  it("once turned off, says so to the holder of the link, names the fix, and offers one action", async () => {
    const { id, token } = await link(sample, "Bayside Drywall");
    await revokeVendorLink(sample, id);
    jar.set("ss_collect", token);
    const html = await collectPage(id);
    expect(textOf(html)).toContain("This upload link was turned off Whoever sent it turned it off. Ask them for a new one.");
    expect(textOf(html)).not.toContain("Bayside Drywall");
    expectAskForNewLink(html);
  });

  it("once past its end, tells the holder when it stopped working; a wrong token learns nothing", async () => {
    const { id, token } = await link(sample, "Bayside Drywall");
    const [row] = await db.root((tx) =>
      tx.query<{ at: string }>("update app.vendor_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 hour' where id = $1 returning expires_at::text as at", [id]),
    );
    jar.set("ss_collect", token);
    const html = await collectPage(id);
    expect(said(html)).toContain(`This upload link has expired It stopped working on ${fmtDay(row.at)}. Ask whoever sent it for a new one.`);
    expectAskForNewLink(html);
    jar.set("ss_collect", otherToken(token));
    expect(textOf(await collectPage(id))).toContain("This upload link has stopped working It has expired or been turned off.");
  });
});

describe("signing in (/signin)", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };

  it("an unticked box: the message is about that box, and the email typed stays", async () => {
    expect(await signIn({}, form({ mode: "email", email: "owner@harbor.example" }))).toEqual({
      error: "Check the box to agree to the Terms and Privacy Policy.",
      field: "terms",
      email: "owner@harbor.example",
      terms: false,
    });
  });

  it("an email that isn't one: the message shows how one looks, next to the email field, and the tick stays", async () => {
    expect(await signIn({}, form({ mode: "email", email: "owner at harbor", terms: "on" }))).toEqual({
      error: "Enter your email address, like you@business.com.",
      field: "email",
      email: "owner at harbor",
      terms: true,
    });
  });

  it("an account sign-in that came back refused says what happened and what to do", async () => {
    const html = await renderPage(SignInPage, { searchParams: Promise.resolve({ error: "taken" }) });
    expect(textOf(/<p role="alert"[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "")).toBe(
      "This email already belongs to another ShipShape account, so we didn't sign you in. Sign in with a different email address.",
    );
  });
});

describe("terms (/terms)", () => {
  it("the upgrade box's refund link lands on the Terms' refund section, which names the address once there is one", async () => {
    const upgrade = await renderPage(UpgradeForm, { price: 19 });
    expect(actionsOf(upgrade).find((a) => a.label === "refund policy")?.href).toBe("/terms#refunds");

    const without = await renderPage(TermsPage, {});
    expect(without).toMatch(/<h2[^>]*\bid="refunds"/);
    expect(textOf(without)).toContain("refunded in full if you ask within 14 days of it. The address to ask will be listed here");

    vi.stubEnv("CONTACT_EMAIL", "help@shipshape.example");
    const withContact = await renderPage(TermsPage, {});
    expect(textOf(withContact)).toMatch(/refunded in full if you ask within 14 days of it\. To ask, write to help@shipshape\.example\s*\./);
    expect(actionsOf(withContact).find((a) => a.label === "help@shipshape.example")?.href).toBe("mailto:help@shipshape.example");
  });
});
