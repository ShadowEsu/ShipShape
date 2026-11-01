"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteAccount } from "@/lib/server/account";
import { openPortal, startCheckout } from "@/lib/server/billing";
import { UserError } from "@/lib/server/errors";
import { NeedsRecentSignIn, renameWorkspace } from "@/lib/server/profile";
import { endAllSessions, endOneSession, endSession, requireWorkspace } from "@/lib/server/session";

export interface RenameState {
  error?: string;
  saved?: boolean;
  /** The name that was refused, so the field keeps it after React resets the form. */
  name?: string;
}

export async function renameMyWorkspace(_prev: RenameState, data: FormData): Promise<RenameState> {
  const ctx = await requireWorkspace();
  try {
    await renameWorkspace(ctx, data.get("name"));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, name: String(data.get("name") ?? "") };
    throw e;
  }
  // The name shows in the header of every app page.
  revalidatePath("/app", "layout");
  return { saved: true };
}

export interface DeleteState {
  error?: string;
  /** The error is about the confirm field: shown next to it. */
  field?: "confirm";
  /** The sign-in is too old for this: the fix is signing in again. */
  reauth?: boolean;
  /** What was typed in the confirm field, so it keeps it after React resets the form. */
  typed?: string;
}

export async function deleteMyAccount(_prev: DeleteState, data: FormData): Promise<DeleteState> {
  const ctx = await requireWorkspace();
  const typed = String(data.get("confirm") ?? "");
  if (typed.trim() !== "DELETE") return { error: "Type DELETE, in capitals, to confirm.", field: "confirm", typed };
  try {
    await deleteAccount(ctx);
  } catch (e) {
    if (e instanceof NeedsRecentSignIn) return { error: e.message, reauth: true };
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  await endSession();
  redirect("/signin?deleted=1");
}

/** Lost a device or saw a sign-in you don't recognize: ends every session, this one included (Security E9). */
export async function signOutEverywhere() {
  const ctx = await requireWorkspace();
  await endAllSessions(ctx.userId);
  redirect("/signin?signed_out=everywhere");
}

// Any 32 hex digits in uuid form: session ids are 128 random bits, so z.uuid()'s version check would refuse them.
const SessionId = z.guid();

/** "Sign out" on one row of Where you're signed in (Design row 34). On this browser's own row, it signs out here. */
export async function signOutSession(data: FormData) {
  const ctx = await requireWorkspace();
  const id = SessionId.safeParse(data.get("id"));
  if (!id.success) return;
  await endOneSession(ctx, id.data);
  if (id.data === ctx.sessionId) redirect("/");
  revalidatePath("/app/settings");
}

export interface BillingState {
  error?: string;
}

export async function upgrade(_prev: BillingState, data: FormData): Promise<BillingState> {
  const ctx = await requireWorkspace();
  let url: string;
  try {
    url = await startCheckout(ctx, data.get("agree") === "on");
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(url);
}

export async function manageBilling(_prev: BillingState): Promise<BillingState> {
  const ctx = await requireWorkspace();
  let url: string;
  try {
    url = await openPortal(ctx);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(url);
}
