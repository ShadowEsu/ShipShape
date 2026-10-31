"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROFILE_FIELDS, type ProfileKey } from "@/lib/profile-fields";
import { GateClosed } from "@/lib/server/flags";
import { NeedsRecentSignIn, revealEin, saveEin, saveProfile } from "@/lib/server/profile";
import { requireWorkspace } from "@/lib/server/session";

export interface FactsState {
  error?: string;
  saved?: boolean;
  ein?: string;
}

function message(e: unknown): string {
  if (e instanceof GateClosed || e instanceof NeedsRecentSignIn) return e.message;
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? "Check the form and try again.";
  throw e;
}

export async function saveFacts(_prev: FactsState, data: FormData): Promise<FactsState> {
  const ctx = await requireWorkspace();
  const input = Object.fromEntries([...PROFILE_FIELDS.map((f) => f.key), "entity_type"].map((k) => [k, String(data.get(k) ?? "")])) as Record<ProfileKey, string>;
  try {
    await saveProfile(ctx, input);
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/app/facts");
  return { saved: true };
}

export async function saveTaxId(_prev: FactsState, data: FormData): Promise<FactsState> {
  const ctx = await requireWorkspace();
  try {
    await saveEin(ctx, String(data.get("ein") ?? ""));
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/app/facts");
  return { saved: true };
}

export async function reveal(_prev: FactsState): Promise<FactsState> {
  const ctx = await requireWorkspace();
  try {
    const ein = await revealEin(ctx);
    return ein ? { ein } : { error: "No EIN saved yet." };
  } catch (e) {
    return { error: message(e) };
  }
}
