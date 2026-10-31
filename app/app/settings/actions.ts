"use server";

import { redirect } from "next/navigation";
import { deleteAccount } from "@/lib/server/account";
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
    if (e instanceof NeedsRecentSignIn) return { error: e.message };
    throw e;
  }
  await endSession();
  redirect("/signin?deleted=1");
}
