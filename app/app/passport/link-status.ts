import { dayOf } from "@/lib/today";

/** A link reaching its planned end is expected, not a fault: neutral like Turned off (red stays for lapsed documents). Both looks. */
export function linkStatus(l: { revoked_at: string | null; expires_at: string }, zone: string) {
  if (l.revoked_at) return { label: "Turned off", cls: "bg-canvas text-ink-3", icon: "○", working: false };
  if (new Date(l.expires_at).getTime() < Date.now()) return { label: `Ended ${dayOf(l.expires_at, zone)}`, cls: "bg-canvas text-ink-3", icon: "○", working: false };
  return { label: "Working", cls: "bg-ok-soft text-ok", icon: "✓", working: true };
}
