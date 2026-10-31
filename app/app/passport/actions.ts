"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UserError } from "@/lib/server/documents";
import { createPassport, revokePassport } from "@/lib/server/passport";
import { requireWorkspace } from "@/lib/server/session";

export interface PassportFormState {
  error?: string;
  created?: { id: string; token: string };
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
    if (e instanceof UserError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Check the form and try again." };
    throw e;
  }
}

export async function turnOff(data: FormData) {
  const ctx = await requireWorkspace();
  const id = String(data.get("id") ?? "");
  await revokePassport(ctx, id);
  revalidatePath("/app/passport");
  revalidatePath(`/app/passport/${id}`);
}
