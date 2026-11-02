import type { CollectState, VendorRow } from "@/lib/server/collect";

// "All current" counts vendors whose every document is current; the others count vendors with at
// least one document in that state, so one vendor can appear under two of them.
export const SUMMARY: { state: CollectState; title: string }[] = [
  { state: "ok", title: "All current" },
  { state: "expiring", title: "Expiring within 30 days" },
  { state: "missing", title: "Missing something" },
  { state: "expired", title: "Something lapsed" },
];

export function summaryCounts(vendors: VendorRow[]): Record<string, number> {
  return Object.fromEntries(
    SUMMARY.map((s) => [s.state, vendors.filter((v) => (s.state === "ok" ? v.state === "ok" : v.items.some((i) => i.state === s.state))).length]),
  );
}
