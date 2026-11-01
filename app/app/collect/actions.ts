"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { addVendor, createVendorLink, deleteVendorFile, revokeVendorLink, setVendorArchived } from "@/lib/server/collect";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";

/** The new-vendor form's fields, as its error messages name them. */
export type VendorField = "name" | "email" | "kinds";

export interface CollectFormState {
  /** A problem with the whole request, shown above the button. */
  error?: string;
  /** What to change in each field, shown next to it. */
  fieldErrors?: Partial<Record<VendorField, string>>;
  /** A new upload link, shown once, and how many days it works. */
  link?: { id: string; token: string; days: number };
  /** What was typed into the new-vendor form, sent back with an error so the form shows it again. */
  values?: { name: string; email: string; kinds: string[] };
}

function problem(e: unknown): CollectFormState {
  if (e instanceof UserError || e instanceof GateClosed) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Check the form and try again." };
  throw e;
}

const VENDOR_FIELD: Record<string, VendorField> = { name: "name", email: "email", requested: "kinds" };

export async function addVendorAction(_prev: CollectFormState, data: FormData): Promise<CollectFormState> {
  const ctx = await requireWorkspace();
  let vendorId: string;
  try {
    vendorId = await addVendor(ctx, { name: data.get("name"), email: data.get("email") ?? "", requested: data.getAll("kind") });
  } catch (e) {
    const values = { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), kinds: data.getAll("kind").map(String) };
    if (e instanceof z.ZodError) {
      const fieldErrors: Partial<Record<VendorField, string>> = {};
      for (const issue of e.issues) {
        const key = String(issue.path[0]);
        const field = Object.hasOwn(VENDOR_FIELD, key) ? VENDOR_FIELD[key] : "name";
        fieldErrors[field] ??= issue.message;
      }
      return { fieldErrors, values };
    }
    return { ...problem(e), values };
  }
  revalidatePath("/app/collect");
  redirect(`/app/collect/${vendorId}`);
}

export async function makeVendorLink(_prev: CollectFormState, data: FormData): Promise<CollectFormState> {
  const ctx = await requireWorkspace();
  try {
    const link = await createVendorLink(ctx, { vendorId: data.get("vendor"), days: data.get("days") });
    revalidatePath("/app/collect");
    // The vendor's page lists its links: the new one shows there under Upload links.
    revalidatePath(`/app/collect/${String(data.get("vendor"))}`);
    return { link: { ...link, days: Number(data.get("days")) } };
  } catch (e) {
    return problem(e);
  }
}

/**
 * Back to the vendor's page after a plain form post. A code makes the page say what went wrong
 * (ERRORS in [id]/page.tsx); without one, a message from an earlier attempt leaves the address.
 */
function backToVendor(vendorId: string, error?: "off"): never {
  const page = z.uuid().safeParse(vendorId).success ? `/app/collect/${vendorId}` : "/app/collect";
  redirect(error ? `${page}?error=${error}` : page, RedirectType.replace);
}

export async function turnOffVendorLink(data: FormData) {
  const ctx = await requireWorkspace();
  const vendorId = String(data.get("vendor") ?? "");
  try {
    await revokeVendorLink(ctx, String(data.get("id") ?? ""));
  } catch (e) {
    // Already off: a second click, or turned off in another tab.
    if (e instanceof UserError) backToVendor(vendorId, "off");
    throw e;
  }
  revalidatePath(`/app/collect/${vendorId}`);
  backToVendor(vendorId);
}

export async function deleteVendorFileAction(_prev: CollectFormState, data: FormData): Promise<CollectFormState> {
  const ctx = await requireWorkspace();
  try {
    const vendorId = await deleteVendorFile(ctx, String(data.get("id") ?? ""));
    revalidatePath("/app/collect");
    revalidatePath(`/app/collect/${vendorId}`);
    return {};
  } catch (e) {
    return problem(e);
  }
}

export async function archiveVendor(data: FormData) {
  const ctx = await requireWorkspace();
  const id = String(data.get("id") ?? "");
  try {
    await setVendorArchived(ctx, id, data.get("archive") === "1");
  } catch (e) {
    // The vendor isn't in this workspace any more, which its page shows.
    if (e instanceof UserError) backToVendor(id);
    throw e;
  }
  revalidatePath("/app/collect");
  revalidatePath(`/app/collect/${id}`);
  backToVendor(id);
}
