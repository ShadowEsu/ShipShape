"use server";

import { redirect } from "next/navigation";
import { fillTemplate } from "@/lib/server/documents";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import { formValues } from "@/lib/server/fill";
import { requireWorkspace } from "@/lib/server/session";
import { templateById } from "@/lib/templates/catalog";

export interface FillState {
  errors?: Record<string, string>;
  error?: string;
}

// The template id comes from a hidden field, not `fill.bind(...)`: in Next.js 16.4.3 a bound action
// used with useActionState hangs the server when the form posts before JavaScript has loaded.
export async function fill(_prev: FillState, data: FormData): Promise<FillState> {
  const ctx = await requireWorkspace();
  const t = templateById(String(data.get("template") ?? ""));
  if (!t) return { error: "Unknown template." };
  const values = formValues(t, data);
  let id: string;
  try {
    const res = await fillTemplate(ctx, t.id, values, data.get("ack") === "on");
    if (!res.ok) return { errors: res.errors };
    id = res.id;
  } catch (e) {
    if (e instanceof GateClosed || e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`/app/documents/${id}?made=1`);
}
