"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

export async function turnOffVendorLink(data: FormData) {
  const ctx = await requireWorkspace();
  await revokeVendorLink(ctx, String(data.get("id") ?? ""));
  revalidatePath(`/app/collect/${String(data.get("vendor") ?? "")}`);
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
  await setVendorArchived(ctx, id, data.get("archive") === "1");
  revalidatePath("/app/collect");
  revalidatePath(`/app/collect/${id}`);
}
