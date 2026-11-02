import type { VendorLink } from "@/lib/server/collect";

/** True to collect_open/collect_receive (0008/0012): a link works only while unrevoked, unexpired and the vendor is active. */
export function linkStatus(l: VendorLink, archived: boolean) {
  if (l.revoked_at) return "Turned off";
  if (new Date(l.expires_at).getTime() < Date.now()) return "Expired";
  return archived ? "Off while archived" : "Working";
}

// A non-breaking space keeps "1 KB" on one line at 390 wide (Design).
export const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}\u00A0KB` : `${(bytes / 1024 / 1024).toFixed(1)}\u00A0MB`);

/** What went wrong in a form posted from the vendor page (see backToVendor in ../actions.ts). */
export const ERRORS: Record<string, string> = {
  off: "This link was already off, so nobody can use it. There's nothing more to do.",
};
