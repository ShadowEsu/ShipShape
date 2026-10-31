import { fmtDay } from "@/components/app-ui";
import type { CollectState } from "@/lib/server/collect";

export const COLLECT_STATES: Record<CollectState, { label: string; cls: string; icon: string }> = {
  ok: { label: "Current", cls: "bg-ok-soft text-ok", icon: "✓" },
  expiring: { label: "Expires soon", cls: "bg-warn-soft text-warn", icon: "◷" },
  missing: { label: "Missing", cls: "bg-canvas text-ink-2 ring-1 ring-line ring-inset", icon: "○" },
  expired: { label: "Expired", cls: "bg-bad-soft text-bad", icon: "!" },
};

/** One requested document's state; colour always comes with an icon and words. */
export function CollectChip({ state, label, expiresOn }: { state: CollectState; label?: string; expiresOn?: string | null }) {
  const s = COLLECT_STATES[state];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      {label ? `${label}: ${s.label.toLowerCase()}` : s.label}
      {expiresOn && <span className="font-normal opacity-80">· {fmtDay(expiresOn)}</span>}
    </span>
  );
}
