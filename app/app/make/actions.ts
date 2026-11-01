"use server";

import { redirect } from "next/navigation";
import { checkFill, fillTemplate } from "@/lib/server/documents";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import { formValues } from "@/lib/server/fill";
import { requireWorkspace } from "@/lib/server/session";
import { stepOf, templateById } from "@/lib/templates/catalog";
import type { TemplateInfo } from "@/lib/templates/types";

export interface FillState {
  errors?: Record<string, string>;
  error?: string;
  /** Every value passed its checks: the form shows them, with their sources, for the person to approve. */
  review?: boolean;
  /** The step (0-based) to show: the next one after a step passed its checks, or the first one with an error. */
  at?: number;
}

/** The lowest step any of these errors is on (the approval box counts as the first). */
function firstStep(t: TemplateInfo, errors: Record<string, string>): number {
  return Math.min(...Object.keys(errors).map((k) => stepOf(t, k)));
}

// The template id comes from a hidden field, not `fill.bind(...)`: in Next.js 16.4.3 a bound action
// used with useActionState hangs the server when the form posts before JavaScript has loaded.
// Continue posts `step=next` with `at` (the step being left): only that step's values are checked, and the
// next step comes back. The review button posts `step=review`: everything is checked and nothing is
// saved. Approving posts without a step.
export async function fill(_prev: FillState, data: FormData): Promise<FillState> {
  const ctx = await requireWorkspace();
  const t = templateById(String(data.get("template") ?? ""));
  if (!t) return { error: "ShipShape doesn't fill that form. Pick one from Make a document." };
  const values = formValues(t, data);
  let id: string;
  try {
    const step = data.get("step");
    if (step === "next") {
      const at = Math.max(0, Math.trunc(Number(data.get("at")) || 0));
      const all = await checkFill(ctx, t.id, values);
      const own = Object.fromEntries(Object.entries(all).filter(([k]) => stepOf(t, k) === at));
      return Object.keys(own).length ? { errors: own, at } : { at: at + 1 };
    }
    if (step === "review") {
      const errors = await checkFill(ctx, t.id, values);
      return Object.keys(errors).length ? { errors, at: firstStep(t, errors) } : { review: true };
    }
    const res = await fillTemplate(ctx, t.id, values, data.get("ack") === "on");
    // Only the approval box left unticked: stay on the review, where the box is.
    if (!res.ok) {
      const ackOnly = Object.keys(res.errors).every((k) => k === "_ack");
      return ackOnly ? { errors: res.errors, review: true } : { errors: res.errors, at: firstStep(t, res.errors) };
    }
    id = res.id;
  } catch (e) {
    if (e instanceof GateClosed || e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`/app/documents/${id}?made=1`);
}
