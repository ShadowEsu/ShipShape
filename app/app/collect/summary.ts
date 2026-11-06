import type { CollectState } from "@/lib/server/collect";

// Collect's tiles, counted over every active vendor by pageVendors (lib/server/collect.ts): "All current" counts vendors
// whose every document is current; the others count vendors with at least one document in that state, so one vendor can
// appear under two of them.
export const SUMMARY: { state: CollectState; title: string }[] = [
  { state: "ok", title: "All current" },
  { state: "expiring", title: "Expiring within 30 days" },
  { state: "missing", title: "Missing something" },
  { state: "expired", title: "Something lapsed" },
];
