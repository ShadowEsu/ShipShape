"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { addVendor, createVendorLink, deleteVendorFile, revokeVendorLink, setVendorArchived } from "@/lib/server/collect";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";

export interface CollectFormState {
  error?: string;
  /** A new upload link, shown once. */
  link?: { id: string; token: string };
  /** What was typed into the new-vendor form, sent back with an error so the form shows it again. */
  values?: { name: string; email: string; kinds: string[] };
}

function problem(e: unknown): CollectFormState {
  if (e instanceof UserError || e instanceof GateClosed) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Check the form and try again." };
  throw e;
}

export async function addVendorAction(_prev: CollectFormState, data: FormData): Promise<CollectFormState> {
  const ctx = await requireWorkspace();
  let vendorId: string;
  try {
    vendorId = await addVendor(ctx, { name: data.get("name"), email: data.get("email") ?? "", requested: data.getAll("kind") });
  } catch (e) {
    return { ...problem(e), values: { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), kinds: data.getAll("kind").map(String) } };
  }
  revalidatePath("/app/collect");
  redirect(`/app/collect/${vendorId}`);
}

export async function makeVendorLink(_prev: CollectFormState, data: FormData): Promise<CollectFormState> {
  const ctx = await requireWorkspace();
  try {
    const link = await createVendorLink(ctx, { vendorId: data.get("vendor"), days: data.get("days") });
    revalidatePath("/app/collect");
    return { link };
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
