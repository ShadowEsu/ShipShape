import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { turnOffVendorLink } from "@/app/app/collect/actions";
import { archive, askToSign } from "@/app/app/documents/actions";
import { addVendor, createVendorLink } from "@/lib/server/collect";
import { getDocument, setArchived, uploadDocument } from "@/lib/server/documents";
import { createLocalUser, finishSignIn, requireWorkspace } from "@/lib/server/session";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { freshDb } from "./support/db";

// The request's cookies, as Next.js would hold them, with the options each was set with.
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
// Like Next.js, redirect() never returns.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  RedirectType: { push: "push", replace: "replace" },
}));
// revalidatePath needs the store Next.js keeps for a request; what it refreshes isn't under test here.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");
let blobDir: string;

beforeAll(async () => {
  await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-blobs-"));
  setBlobStoreForTests(localBlobStore(blobDir));
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

beforeEach(() => vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1"));
afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

/** Signs a new person in to a new (Free) workspace of their own, the way the sign-in page does. */
async function signIn(email: string) {
  await finishSignIn(await createLocalUser(email, false), { demo: false });
  return requireWorkspace();
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

/** Where a plain form action sent the person (its redirect), or what it threw instead. */
async function sentTo(action: Promise<void>): Promise<string> {
  try {
    await action;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("redirect ")) return e.message.slice("redirect ".length);
    throw e;
  }
  throw new Error("The action finished without sending the person anywhere.");
}

describe("plain form actions", () => {
  it("restoring a document on a Free workspace at its 10 documents comes back to its page with the limit message, still archived", async () => {
    const ctx = await signIn("limit@example.com");
    const first = await uploadDocument(ctx, { title: "Old permit", kind: "permit" }, PDF);
    for (let i = 2; i <= 10; i++) await uploadDocument(ctx, { title: `Document ${i}`, kind: "other" }, PDF);
    await setArchived(ctx, first, true);
    await uploadDocument(ctx, { title: "Document 11", kind: "other" }, PDF);

    expect(await sentTo(archive(form({ id: first, archived: "0" })))).toBe(`/app/documents/${first}?error=limit`);
    expect((await getDocument(ctx, first))?.doc.status).toBe("archived");
  });

  it("turning off a vendor's upload link twice says the second time that it was already off", async () => {
    const ctx = await signIn("twice@example.com");
    const vendorId = await addVendor(ctx, { name: "Rivera Electric", email: "", requested: ["w9"] });
    const link = await createVendorLink(ctx, { vendorId, days: 7 });
    const turnOff = form({ id: link.id, vendor: vendorId });

    expect(await sentTo(turnOffVendorLink(turnOff))).toBe(`/app/collect/${vendorId}`);
    expect(await sentTo(turnOffVendorLink(turnOff))).toBe(`/app/collect/${vendorId}?error=off`);
  });

  it("a signing request with a bad email names the email field and keeps what was typed; a workspace-wide problem names no field", async () => {
    const ctx = await signIn("signer@example.com");
    const id = await uploadDocument(ctx, { title: "Lease", kind: "agreement" }, PDF);

    const bad = await askToSign({}, form({ id, signer_name: "Pat Lee", signer_email: "pat-at-example", days: "14" }));
    expect(bad).toEqual({
      error: "Enter the signer's email address.",
      field: "signer_email",
      values: { signer_name: "Pat Lee", signer_email: "pat-at-example", days: "14" },
    });

    const noName = await askToSign({}, form({ id, signer_name: " ", signer_email: "pat@example.com", days: "14" }));
    expect(noName.field).toBe("signer_name");
    expect(noName.error).toBe("Who should sign?");

    // A valid form on a Free workspace meets the plan gate: nothing on the form is wrong, so the message stands on its own.
    const gated = await askToSign({}, form({ id, signer_name: "Pat Lee", signer_email: "pat@example.com", days: "14" }));
    expect(gated).toEqual({
      error: "Asking for signatures is part of Pro.",
      field: undefined,
      values: { signer_name: "Pat Lee", signer_email: "pat@example.com", days: "14" },
    });
  });
});
