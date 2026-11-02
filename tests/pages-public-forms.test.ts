import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isValidElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CollectPage from "@/app/c/[id]/page";
import { SendButton } from "@/app/c/[id]/send-button";
import PassportPage from "@/app/p/[id]/page";
import { signProblem } from "@/app/s/[id]/messages";
import SigningPage from "@/app/s/[id]/page";
import { SignFormView } from "@/app/s/[id]/sign-form";
import { dayOf } from "@/lib/today";
import { addVendor, createVendorLink, receiveFile } from "@/lib/server/collect";
import { asService, asUser } from "@/lib/server/db";
import { listDocuments } from "@/lib/server/documents";
import { requestSignature } from "@/lib/server/esign";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-limit";
import { createPassport } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { seedSampleWorkspace } from "@/lib/server/sample";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";
import { actionsOf, renderPage, textOf } from "./support/render";

/** The forms on the pages people outside a workspace open: each answer sits where the fix is, and the dates and labels say what's true. */

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
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-forms-"));
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

/** The page's text as read: no gap left before punctuation where React split the text around a value. */
const said = (html: string) => textOf(html).replace(/ ([.,;])/g, "$1");

/** The opening tag of the input with this id ("" when there is none). */
const inputTag = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";

/** The text of the message paragraph with this id. */
const messageText = (html: string, id: string) => textOf(new RegExp(`<p id="${id}"[^>]*>[\\s\\S]*?</p>`).exec(html)?.[0] ?? "");

describe("the signing form's messages (/s)", () => {
  const sender = "Harbor Plumbing (sample)";
  const view = (state: { codeSent: boolean; sent: string | null; error: { field: "consent" | "name" | "code" | null; message: string } | null }) =>
    renderPage(SignFormView, {
      title: "Mutual NDA",
      signerName: "Jordan Lee",
      email: "j•••@northwind.example",
      consentText: "I agree to sign electronically.",
      demo: false,
      ready: true,
      consented: false,
      name: "",
      code: "",
      busy: null,
      onConsent: () => {},
      onName: () => {},
      onCode: () => {},
      onSendCode: () => {},
      onSign: () => {},
      ...state,
    });
  const FIELDS = { consent: "sign-consent", name: "typed-name", code: "code" };

  it.each<[string, keyof typeof FIELDS]>([
    ["needs_consent", "consent"],
    ["needs_name", "name"],
    ["bad_code", "code"],
  ])("%s: the message sits under the %s field, which is marked and points at it; no other field is", async (result, field) => {
    const error = signProblem(result, sender);
    expect(error.field).toBe(field);
    const html = await view({ codeSent: true, sent: null, error });
    const id = FIELDS[field];
    expect(inputTag(html, id)).toContain('aria-invalid="true"');
    expect(inputTag(html, id)).toContain(`aria-describedby="${id}-error"`);
    expect(messageText(html, `${id}-error`)).toBe(error.message);
    for (const other of Object.values(FIELDS).filter((o) => o !== id)) {
      expect(inputTag(html, other)).not.toContain("aria-invalid");
      expect(inputTag(html, other)).not.toContain("aria-describedby");
    }
    expect(html).not.toContain('role="alert"');
  });

  it("a message about the whole form is an alert box, and no field is marked", async () => {
    const error = signProblem("invalid", sender);
    expect(error.field).toBeNull();
    const html = await view({ codeSent: true, sent: null, error });
    expect(textOf(/<p role="alert"[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? "")).toBe(`This signing link has stopped working. Ask ${sender} for a new one.`);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("the line that says a code was sent is a live region there before the code is asked for, so its text is read out when it arrives", async () => {
    const before = await view({ codeSent: false, sent: null, error: null });
    expect(before).toMatch(/<p role="status" class="sr-only"><\/p>/);
    const after = await view({ codeSent: true, sent: "We sent a 6-digit code to j•••@northwind.example. It works for 10 minutes.", error: null });
    expect(textOf(/<p role="status"[^>]*>[\s\S]*?<\/p>/.exec(after)?.[0] ?? "")).toBe("We sent a 6-digit code to j•••@northwind.example. It works for 10 minutes.");
  });
});

describe("an upload link's answers (/c)", () => {
  const link = async (ctx: Ctx, name: string) => {
    const vendorId = await addVendor(ctx, { name, email: "", requested: ["w9", "coi"] });
    return createVendorLink(ctx, { vendorId, days: 30 });
  };
  const collectPage = (id: string, search: Record<string, string> = {}) => renderPage(CollectPage, props(id, search));

  // A real workspace: a sample link has no file field, so file problems only show under a field here.
  let real: Ctx | null = null;
  async function realWorkspace(): Promise<Ctx> {
    if (real) return real;
    const owner = await db.user("forms-owner@example.com");
    const [org] = await asUser(owner, (tx) => tx.query<{ id: string }>("select app.create_workspace('Harbor Forms Co') as id"));
    real = { userId: owner, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Harbor Forms Co", role: "owner", today: isoToday() };
    return real;
  }
  let shared: { id: string; token: string } | null = null;
  async function realLink() {
    shared ??= await link(await realWorkspace(), "Summit Supply");
    return shared;
  }
  beforeEach(() => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
  });

  /** The notice that took focus at the top of the page, with its role; null when there is none. */
  const focusedNotice = (html: string) => {
    const m = /<div role="(alert|status)" tabindex="-1"[^>]*><div class="[^"]*">([\s\S]*?)<\/div><\/div>/.exec(html);
    return m ? { role: m[1], text: said(m[2]) } : null;
  };

  it.each([
    ["empty", "file-coi", "Choose a file to send."],
    ["type", "file-coi", "That file isn't a PDF, PNG or JPEG. Save it as one of those, then send it again."],
    ["active", "file-coi", "That PDF launches other programs or carries embedded files, so nothing was sent. Print it to a new PDF, then send that."],
    ["date", "expires-coi", "Enter the end date as a full date, or leave it empty."],
  ])("%s: the fix sits under that document's field, which is marked and takes focus; nothing at the top", async (r, id, sentence) => {
    const { id: linkId, token } = await realLink();
    jar.set("ss_collect", token);
    const html = await collectPage(linkId, { r, k: "coi" });
    expect(inputTag(html, id)).toContain('aria-invalid="true"');
    expect(inputTag(html, id)).toContain(`aria-describedby="${id}-error"`);
    expect(inputTag(html, id)).toContain("autofocus");
    expect(messageText(html, `${id}-error`)).toBe(sentence);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
    expect(focusedNotice(html)).toBeNull();
  });

  it.each([
    ["closed", "This link stopped working before your file arrived, so nothing was sent. Ask Harbor Forms Co for a new link."],
    ["gate", "Harbor Forms Co can't take files through ShipShape yet, so nothing was sent. Send it to them another way."],
    ["kind", "That document isn't on the list for this link, so nothing was sent. Send one of the documents below."],
    ["link_full", "This link has taken all the files it can (25), so nothing was sent. Ask Harbor Forms Co for a new link."],
    ["workspace_full", "Harbor Forms Co has no room left for files, so nothing was sent. Let them know."],
  ])("%s: the answer is an alert at the top that takes focus; no field is marked", async (r, sentence) => {
    const { id, token } = await realLink();
    jar.set("ss_collect", token);
    const html = await collectPage(id, { r, k: "coi" });
    expect(focusedNotice(html)).toEqual({ role: "alert", text: sentence });
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("no answer: nothing at the top takes focus", async () => {
    const { id, token } = await realLink();
    jar.set("ss_collect", token);
    const html = await collectPage(id);
    expect(focusedNotice(html)).toBeNull();
    expect(html).not.toContain('tabindex="-1"');
  });

  it("a file sent: the answer is a status at the top that takes focus", async () => {
    const { id, token } = await link(sample, "Rivera Electric");
    jar.set("ss_collect", token);
    expect(await receiveFile(id, token, { kind: "coi", expiresOn: "", file: null })).toBe("sent");
    const html = await collectPage(id, { r: "sent-coi", k: "coi" });
    expect(focusedNotice(html)).toEqual({ role: "status", text: "Sent. Harbor Plumbing (sample) now has your Insurance certificate. 1 more document to send below." });
  });

  it("each send button knows the 4 MB cap and opens the page the upload route sends a too-big file to, so a larger file never reaches Vercel's 413", async () => {
    const { id, token } = await realLink();
    jar.set("ss_collect", token);
    /** The props of every element of `type` in a rendered tree. */
    const propsOf = (node: unknown, type: unknown): Record<string, unknown>[] => {
      if (Array.isArray(node)) return node.flatMap((n) => propsOf(n, type));
      if (!isValidElement<Record<string, unknown>>(node)) return [];
      return [...(node.type === type ? [node.props] : []), ...propsOf(node.props.children, type)];
    };
    const tree = await CollectPage(props(id));
    expect(propsOf(tree, SendButton)).toEqual([
      { label: "Send", maxBytes: MAX_UPLOAD_BYTES, tooBigHref: `/c/${id}?r=too_big&k=w9` },
      { label: "Send", maxBytes: MAX_UPLOAD_BYTES, tooBigHref: `/c/${id}?r=too_big&k=coi` },
    ]);
    expect(MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    // That address puts the too-big sentence under the document's file field.
    const html = await collectPage(id, { r: "too_big", k: "coi" });
    expect(messageText(html, "file-coi-error")).toBe("That file is over 4 MB. Send a smaller copy, such as a PDF scanned at a lower resolution.");
  });

  it("a document already sent says when it was received, and its button offers a newer one", async () => {
    const { id, token } = await link(await realWorkspace(), "Lopez Roofing");
    const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
    expect(await receiveFile(id, token, { kind: "w9", expiresOn: "", file: { name: "W9 Lopez.pdf", bytes: PDF } })).toBe("sent");
    const [row] = await db.root((tx) =>
      tx.query<{ at: string }>(
        "select f.received_at::text as at from app.vendor_files f join app.vendor_links l on l.vendor_id = f.vendor_id where l.id = $1 and f.kind = 'w9' order by f.received_at desc limit 1",
        [id],
      ),
    );
    jar.set("ss_collect", token);
    const html = await collectPage(id);
    const rows = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    const w9 = rows.find((r) => r.includes('id="file-w9"')) ?? "";
    const coi = rows.find((r) => r.includes('id="file-coi"')) ?? "";
    expect(said(w9)).toContain(`W-9 ✓ Received ${dayOf(row.at, "UTC")}`);
    expect(actionsOf(w9)).toEqual([{ tag: "button", label: "Send a newer one", href: undefined }]);
    expect(said(coi)).toContain("Insurance certificate Not sent yet");
    expect(actionsOf(coi)).toEqual([{ tag: "button", label: "Send", href: undefined }]);
  });
});

describe("the dates and labels on a passport and a signing page", () => {
  it("a passport says until when its link works, to the day, and each download names its document", async () => {
    const docs = (await listDocuments(sample)).slice(0, 2);
    const { id, token } = await createPassport(sample, { label: "For Northwind", days: 30, documentIds: docs.map((d) => d.id) });
    const [row] = await db.root((tx) => tx.query<{ at: string }>("select expires_at::text as at from app.share_links where id = $1", [id]));
    jar.set("ss_passport", token);
    const html = await renderPage(PassportPage, props(id));
    expect(said(html)).toContain(`For Northwind · this link works until ${dayOf(row.at, "UTC")}`);
    const labels = [...html.matchAll(/<a [^>]*aria-label="([^"]*)"[^>]*>\s*Download\s*<\/a>/g)].map((m) => textOf(m[1]));
    expect(labels.toSorted()).toEqual(docs.map((d) => `Download ${d.title}`).toSorted());
  });

  it("a signing page says until when it can be signed, to the day", async () => {
    const nda = (await listDocuments(sample)).find((d) => d.kind === "nda");
    if (!nda) throw new Error("the sample workspace has no NDA");
    const { id, token } = await requestSignature(sample, { documentId: nda.id, signerName: "Jordan Lee", signerEmail: "jordan@northwind.example", days: 7 }, "192.0.2.10");
    const [row] = await db.root((tx) => tx.query<{ at: string }>("select expires_at::text as at from app.signature_requests where id = $1", [id]));
    jar.set("ss_sign", token);
    expect(said(await renderPage(SigningPage, props(id)))).toContain(`Harbor Plumbing (sample) asked Jordan Lee to sign this document. You can sign until ${dayOf(row.at, "UTC")}.`);
  });
});
