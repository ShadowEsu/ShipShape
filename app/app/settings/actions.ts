"use server";

import { redirect } from "next/navigation";
import { deleteAccount } from "@/lib/server/account";
import { openPortal, startCheckout } from "@/lib/server/billing";
import { UserError } from "@/lib/server/errors";
import { NeedsRecentSignIn } from "@/lib/server/profile";
import { endSession, requireWorkspace } from "@/lib/server/session";

export interface DeleteState {
  error?: string;
}

export async function deleteMyAccount(_prev: DeleteState, data: FormData): Promise<DeleteState> {
  const ctx = await requireWorkspace();
  if (String(data.get("confirm") ?? "").trim() !== "DELETE") return { error: "Type DELETE in capitals to confirm." };
  try {
    await deleteAccount(ctx);
  } catch (e) {
    if (e instanceof NeedsRecentSignIn || e instanceof UserError) return { error: e.message };
    throw e;
  }
  await endSession();
  redirect("/signin?deleted=1");
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
