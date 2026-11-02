import { fmtMonthDay } from "@/components/app-ui";
import type { AttentionRow } from "@/lib/server/documents";

/** What one "Needs attention" row on Home says and offers: its state sentence and its one action. */
export interface AttentionLine {
  renewal: boolean;
  state: string;
  href: string;
  action: string;
}

/**
 * The wording of a row on Home's "Needs attention", for both looks of Home. `today` is the viewer's day; `canUpload`
 * says whether this workspace can add the renewed copy (otherwise the action is to update the dates).
 */
export function attentionLine(d: AttentionRow, today: string, canUpload: boolean): AttentionLine {
  // Days from today to the date that put the document here (its expiry, or a renewal notice).
  const days = Math.round((Date.parse(d.attention_on) - Date.parse(today)) / 86_400_000);
  const renewal = d.attention_kind === "renewal";
  // A renewal row keeps one chip (its reason); an expiry within 30 days is named on the state line instead.
  const state = renewal
    ? `Renewal notice due ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}.${d.validity === "expiring" && d.expires_on ? ` Expires ${fmtMonthDay(d.expires_on)}.` : ""}`
    : d.validity === "expired"
      ? "It has lapsed."
      : days === 0
        ? "Expires today."
        : `${days} ${days === 1 ? "day" : "days"} left.`;
  return {
    renewal,
    state,
    href: renewal ? `/app/documents/${d.id}` : canUpload ? `/app/documents/${d.id}#version-file` : `/app/documents/${d.id}#expires_on`,
    action: renewal ? "Open it" : canUpload ? "Add the renewed copy" : "Update its dates",
  };
}
