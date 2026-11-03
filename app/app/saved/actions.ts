"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { UserError } from "@/lib/server/errors";
import { setSaved } from "@/lib/server/saved";
import { requireWorkspace } from "@/lib/server/session";

/**
 * The Save / Saved button on a document's or a passport link's page (save-toggle.tsx). The form sends the
 * kind, the id (hidden fields, as archive in ../documents/actions.ts) and the state asked for ("1" save,
 * "0" unsave), then lands back on the page it came from.
 */
export async function toggleSaved(data: FormData) {
  const ctx = await requireWorkspace();
  let page: string;
  try {
    page = await setSaved(ctx, { kind: data.get("kind"), id: data.get("id"), saved: data.get("saved") === "1" });
  } catch (e) {
    // Not a form this app sends: the Saved page.
    if (e instanceof z.ZodError) redirect("/app/saved", RedirectType.replace);
    // Gone, or archived since the page loaded: its page says which.
    if (e instanceof UserError) {
      const kind = data.get("kind") === "link" ? "passport" : "documents";
      redirect(`/app/${kind}/${String(data.get("id"))}`, RedirectType.replace);
    }
    throw e;
  }
  revalidatePath("/app/saved");
  revalidatePath(page);
  redirect(page, RedirectType.replace);
}
