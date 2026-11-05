"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { PlanLimit, UserError } from "@/lib/server/errors";
import { createPassport, listPassports, revokePassport } from "@/lib/server/passport";
import { requireWorkspace } from "@/lib/server/session";
import { markStart } from "@/lib/server/start-here";

/** The new-link form's fields, as its error messages name them. */
export type PassportField = "label" | "docs" | "days";

export interface PassportFormState {
  /** A problem with the whole request (a plan limit, documents gone), shown above the button. */
  error?: string;
  /** The one link that fixes `error`, when there is one. */
  fix?: { href: string; label: string };
  /** What to change in each field, shown next to it. */
  fieldErrors?: Partial<Record<PassportField, string>>;
  created?: { id: string; token: string; label: string; documents: number; days: number };
  /** What was chosen, sent back with an error so the form shows it again after React resets it. */
  values?: { label: string; days: string; docs: string[] };
}

const FIELD: Record<string, PassportField> = { label: "label", documentIds: "docs", days: "days" };

export async function makePassport(_prev: PassportFormState, data: FormData): Promise<PassportFormState> {
  const ctx = await requireWorkspace();
  const docs = data.getAll("doc").map(String);
  const values = { label: String(data.get("label") ?? ""), days: String(data.get("days") ?? ""), docs };
  try {
    const created = await createPassport(ctx, { label: data.get("label"), days: data.get("days"), documentIds: docs });
    revalidatePath("/app/passport");
    // In a sample, a link made is Start here's second step.
    await markStart(ctx, 2);
    return { created: { ...created, label: values.label.trim(), documents: new Set(docs).size, days: Number(values.days) } };
  } catch (e) {
    if (e instanceof PlanLimit) {
      // The Free plan's one open link: its page has the button that turns it off.
      const open = (await listPassports(ctx)).find((l) => !l.revoked_at && new Date(l.expires_at).getTime() > Date.now());
      return { error: e.message, fix: open && { href: `/app/passport/${open.id}`, label: "Turn off your open link" }, values };
    }
    if (e instanceof UserError) return { error: e.message, values };
    if (e instanceof z.ZodError) {
      const fieldErrors: Partial<Record<PassportField, string>> = {};
      for (const issue of e.issues) {
        const key = String(issue.path[0]);
        const field = Object.hasOwn(FIELD, key) ? FIELD[key] : "label";
        fieldErrors[field] ??= issue.message;
      }
      return { fieldErrors, values };
    }
    throw e;
  }
}

export async function turnOff(data: FormData) {
  const ctx = await requireWorkspace();
  const id = String(data.get("id") ?? "");
  const valid = z.uuid().safeParse(id).success;
  // Back to where it was turned off: the link's page, or (`back=sent`) its detail on Sent, which shows its new state.
  // On the link's page ?error=off says it was already off (ERRORS in [id]/page.tsx); the plain address drops a message
  // from an earlier attempt.
  const fromSent = valid && data.get("back") === "sent";
  const page = !valid ? "/app/passport" : fromSent ? `/app/sent?open=link-${id}` : `/app/passport/${id}`;
  try {
    await revokePassport(ctx, id);
  } catch (e) {
    // Already off: a second click, or turned off in another tab.
    if (e instanceof UserError) redirect(fromSent ? page : `${page}?error=off`, RedirectType.replace);
    throw e;
  }
  revalidatePath("/app/passport");
  revalidatePath(`/app/passport/${id}`);
  revalidatePath("/app/sent");
  redirect(page, RedirectType.replace);
}
