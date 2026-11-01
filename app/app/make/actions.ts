"use server";

import { redirect } from "next/navigation";
import { checkFill, fillTemplate } from "@/lib/server/documents";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import { formValues } from "@/lib/server/fill";
import { requireWorkspace } from "@/lib/server/session";
import { templateById } from "@/lib/templates/catalog";

export interface FillState {
  errors?: Record<string, string>;
  error?: string;
  /** Every value passed its checks: the form shows them, with their sources, for the person to approve. */
  review?: boolean;
}

// The template id comes from a hidden field, not `fill.bind(...)`: in Next.js 16.4.3 a bound action
// used with useActionState hangs the server when the form posts before JavaScript has loaded.
// The review button posts `step=review`: the values are checked and nothing is saved. Approving posts without it.
export async function fill(_prev: FillState, data: FormData): Promise<FillState> {
  const ctx = await requireWorkspace();
  const t = templateById(String(data.get("template") ?? ""));
  if (!t) return { error: "ShipShape doesn't fill that form. Pick one from Make a document." };
  const values = formValues(t, data);
  let id: string;
  try {
    if (data.get("step") === "review") {
      const errors = await checkFill(ctx, t.id, values);
      return Object.keys(errors).length ? { errors } : { review: true };
    }
    const res = await fillTemplate(ctx, t.id, values, data.get("ack") === "on");
    // Only the approval box left unticked: stay on the review, where the box is.
    if (!res.ok) return { errors: res.errors, review: Object.keys(res.errors).every((k) => k === "_ack") };
    id = res.id;
  } catch (e) {
    if (e instanceof GateClosed || e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`/app/documents/${id}?made=1`);
}
