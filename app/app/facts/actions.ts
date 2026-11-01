"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROFILE_FIELDS, type ProfileKey } from "@/lib/profile-fields";
import { GateClosed } from "@/lib/server/flags";
import { NeedsRecentSignIn, revealEin, saveEin, saveProfile } from "@/lib/server/profile";
import { requireWorkspace } from "@/lib/server/session";

export interface FactsState {
  error?: string;
  /** The field the error is about (its input's name): the form shows the message there and moves focus to it. */
  field?: string;
  /** The error is fixed by signing in again (showing the EIN needs a recent sign-in). */
  reauth?: boolean;
  saved?: boolean;
  ein?: string;
  /** What was typed, sent back with an error so the form shows it again after React resets it. */
  values?: Record<ProfileKey, string>;
  /** The EIN as typed, sent back when it was refused so the person can correct it. */
  typed?: string;
}

function problem(e: unknown): Pick<FactsState, "error" | "field" | "reauth"> {
  if (e instanceof NeedsRecentSignIn) return { error: e.message, reauth: true };
  if (e instanceof GateClosed) return { error: e.message };
  if (e instanceof z.ZodError) {
    const issue = e.issues[0];
    const field = issue?.path[0];
    return { error: issue?.message ?? "Check the form and try again.", field: typeof field === "string" ? field : undefined };
  }
  throw e;
}

export async function saveFacts(_prev: FactsState, data: FormData): Promise<FactsState> {
  const ctx = await requireWorkspace();
  const input = Object.fromEntries([...PROFILE_FIELDS.map((f) => f.key), "entity_type"].map((k) => [k, String(data.get(k) ?? "")])) as Record<ProfileKey, string>;
  try {
    await saveProfile(ctx, input);
  } catch (e) {
    return { ...problem(e), values: input };
  }
  revalidatePath("/app/facts");
  return { saved: true };
}

export async function saveTaxId(_prev: FactsState, data: FormData): Promise<FactsState> {
  const ctx = await requireWorkspace();
  const typed = String(data.get("ein") ?? "");
  try {
    await saveEin(ctx, typed);
  } catch (e) {
    // The number itself was refused: its message goes under the EIN field, with what was typed.
    return e instanceof z.ZodError ? { ...problem(e), field: "ein", typed } : problem(e);
  }
  revalidatePath("/app/facts");
  return { saved: true };
}

export async function reveal(_prev: FactsState): Promise<FactsState> {
  const ctx = await requireWorkspace();
  try {
    const ein = await revealEin(ctx);
    return ein ? { ein } : { error: "No EIN is saved yet. Add it below." };
  } catch (e) {
    return problem(e);
  }
}
