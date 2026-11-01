"use server";

import { headers } from "next/headers";
import { readRequest, RequestInputError, type RequestItem } from "@/lib/server/ai";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import { clientIp } from "@/lib/server/http";
import { requireWorkspace } from "@/lib/server/session";

export interface AskState {
  error?: string;
  /** The field `error` is about, shown next to it; none: a problem with the whole request. */
  field?: "text" | "consent";
  items?: RequestItem[];
  /** The pasted text, so the form keeps it after an error. */
  text?: string;
}

export async function askAction(_prev: AskState, form: FormData): Promise<AskState> {
  const ctx = await requireWorkspace();
  const text = String(form.get("text") ?? "");
  try {
    const items = await readRequest(ctx, { text, consent: form.get("consent") === "yes" }, clientIp(await headers()));
    return { items, text };
  } catch (e) {
    if (e instanceof RequestInputError) return { error: e.message, field: e.field, text };
    if (e instanceof UserError || e instanceof GateClosed) return { error: e.message, text };
    throw e;
  }
}
