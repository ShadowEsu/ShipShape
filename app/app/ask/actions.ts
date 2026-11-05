"use server";

import { headers } from "next/headers";
import { aiEnabled, readRequest } from "@/lib/server/ai";
import { UserError } from "@/lib/server/errors";
import { GateClosed } from "@/lib/server/flags";
import { clientIp } from "@/lib/server/http";
import { readRequestByNames, RequestInputError, type ReadBy, type RequestItem } from "@/lib/server/request-check";
import { requireWorkspace } from "@/lib/server/session";

export interface AskState {
  error?: string;
  /** The field `error` is about, shown next to it; none: a problem with the whole request. */
  field?: "text" | "consent";
  items?: RequestItem[];
  /** Who found the items, so the answer says how it was read. */
  by?: ReadBy;
  /** The pasted text, so the form keeps it after an error. */
  text?: string;
  /** Whether the consent box was ticked, so a refusal about something else doesn't untick it (W10-7). */
  consent?: boolean;
}

/**
 * Check a request. With AI on, the AI reads it (only with this check's box ticked). With AI off, the plain reader
 * matches document names and nothing is sent anywhere, so there's no box to tick (ledger 461). The server decides,
 * never the form, so a check can't reach the AI without its consent or skip it while AI is on.
 */
export async function askAction(_prev: AskState, form: FormData): Promise<AskState> {
  const ctx = await requireWorkspace();
  const text = String(form.get("text") ?? "");
  const consent = form.get("consent") === "yes";
  const network = clientIp(await headers());
  try {
    if (!aiEnabled()) return { items: await readRequestByNames(ctx, text, network), by: "names", text };
    const items = await readRequest(ctx, { text, consent }, network);
    return { items, by: "ai", text };
  } catch (e) {
    if (e instanceof RequestInputError) return { error: e.message, field: e.field, text, consent };
    if (e instanceof UserError || e instanceof GateClosed) return { error: e.message, text, consent };
    throw e;
  }
}
