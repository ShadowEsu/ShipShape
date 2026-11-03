import { fmtDay } from "@/lib/today";
import type { CollectState } from "@/lib/server/collect";

export const COLLECT_STATES: Record<CollectState, { label: string; cls: string; icon: string; dot: "ok" | "expiring" | "expired" | "none" }> = {
  ok: { label: "Current", cls: "bg-ok-soft text-ok", icon: "✓", dot: "ok" },
  expiring: { label: "Expires soon", cls: "bg-warn-soft text-warn", icon: "◷", dot: "expiring" },
  missing: { label: "Missing", cls: "bg-canvas text-ink-2 ring-1 ring-line ring-inset", icon: "○", dot: "none" },
  expired: { label: "Expired", cls: "bg-bad-soft text-bad", icon: "!", dot: "expired" },
};

/**
 * One requested document's state; colour always comes with an icon and words. The redesigned app (`.validity-chip` in
 * app/globals.css) shows it as Documents' dot and word in a hairline pill, without the icon (Design #26 MUST-2).
 */
export function CollectChip({ state, label, expiresOn }: { state: CollectState; label?: string; expiresOn?: string | null }) {
  const s = COLLECT_STATES[state];
  return (
    <span data-validity={s.dot} className={`validity-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}>
      <span aria-hidden="true" className="validity-icon">
        {s.icon}
      </span>
      {label ? `${label}: ${s.label.toLowerCase()}` : s.label}
      {expiresOn && <span className="font-normal">· {fmtDay(expiresOn)}</span>}
    </span>
  );
}
