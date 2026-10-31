"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { UserError } from "@/lib/server/errors";
import { createPassport, revokePassport } from "@/lib/server/passport";
import { requireWorkspace } from "@/lib/server/session";

export interface PassportFormState {
  error?: string;
  created?: { id: string; token: string };
  /** What was chosen, sent back with an error so the form shows it again after React resets it. */
  values?: { label: string; days: string; docs: string[] };
}

export async function makePassport(_prev: PassportFormState, data: FormData): Promise<PassportFormState> {
  const ctx = await requireWorkspace();
  try {
    const created = await createPassport(ctx, {
      label: data.get("label"),
      days: data.get("days"),
      documentIds: data.getAll("doc"),
    });
    revalidatePath("/app/passport");
    return { created };
  } catch (e) {
    const values = { label: String(data.get("label") ?? ""), days: String(data.get("days") ?? ""), docs: data.getAll("doc").map(String) };
    if (e instanceof UserError) return { error: e.message, values };
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Check the form and try again.", values };
    throw e;
  }
}

export async function turnOff(data: FormData) {
  const ctx = await requireWorkspace();
  const id = String(data.get("id") ?? "");
  // Back to the link's page; ?error=off makes it say the link was already off (ERRORS in [id]/page.tsx),
  // and the plain address drops a message from an earlier attempt.
  const page = z.uuid().safeParse(id).success ? `/app/passport/${id}` : "/app/passport";
  try {
    await revokePassport(ctx, id);
  } catch (e) {
    // Already off: a second click, or turned off in another tab.
    if (e instanceof UserError) redirect(`${page}?error=off`, RedirectType.replace);
    throw e;
  }
  revalidatePath("/app/passport");
  revalidatePath(`/app/passport/${id}`);
  redirect(page, RedirectType.replace);
}
