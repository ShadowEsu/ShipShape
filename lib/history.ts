// The words for audit log rows, wherever they're shown: a document's own History (both looks) and the History page.

const ACTIONS: Record<string, string> = {
  "document.created": "Added to documents",
  "document.version_added": "Version added",
  "document.updated": "Details changed",
  "document.archived": "Archived",
  "document.restored": "Restored",
  "document.deleted": "Deleted",
  "document.acknowledged": "Reviewed and acknowledged",
  "document.viewed": "Opened",
  "document.downloaded": "Downloaded",
  "document.signed_version_added": "Signed copy added",
  "esign.requested": "Signature requested",
  "esign.opened": "Signer opened the link",
  "esign.code_sent": "Signing code sent",
  "esign.signed": "Signed",
  "esign.revoked": "Signature request withdrawn",
  "esign.review_downloaded": "File sent for signing downloaded",
  "passport.created": "Passport link made",
  "passport.updated": "Passport link changed",
  "passport.revoked": "Passport link turned off",
  "passport.deleted": "Passport link deleted",
  "workspace.created": "Workspace created",
  "workspace.renamed": "Workspace renamed",
  "workspace.exported": "Workspace exported",
  "profile.updated": "Business facts changed",
  "profile.tax_id_revealed": "Tax ID shown",
  "vendor.added": "Vendor added",
  "vendor.updated": "Vendor changed",
  "collect.link_created": "Collect link made",
  "collect.link_updated": "Collect link changed",
  "collect.link_revoked": "Collect link turned off",
  "collect.received": "A vendor sent a document",
  "collect.file_downloaded": "Vendor's file downloaded",
  "collect.file_deleted": "Vendor's file deleted",
  "ai.request_read": "Request read by AI",
};

/**
 * An outsider's row says who or which when the row knows it (`about_name`, 0038): the signer's name, the passport
 * link's label. Without it (the link or request is gone), the plain label.
 */
export function historyLabel(action: string, about: string | null): string {
  switch (action) {
    case "document.link_viewed":
      return about ? `Viewed through a passport link: ${about}` : "Viewed through a passport link";
    case "document.link_downloaded":
      return about ? `Downloaded through a passport link: ${about}` : "Downloaded through a passport link";
    case "esign.file_downloaded":
      return `${about ?? "Signer"} downloaded the file to sign`;
    case "esign.signed_copy_downloaded":
      return `${about ?? "Signer"} downloaded the signed copy`;
    default:
      return ACTIONS[action] ?? action;
  }
}

/** The History page's tabs, in order (the rule is in lib/server/activity.ts). "account" is owners and admins only (Security S2). */
export const HISTORY_TABS = [
  ["all", "All"],
  ["documents", "Documents"],
  ["links", "Links"],
  ["signatures", "Signatures"],
  ["account", "Account"],
] as const;
export type HistoryTab = (typeof HISTORY_TABS)[number][0];

/** Reads a `?tab=` value. */
export const historyTab = (v: unknown): HistoryTab => HISTORY_TABS.find(([t]) => t === v)?.[0] ?? "all";

/**
 * Who did it, in words, never an id (Security S6): you, someone else in the workspace, or the outsider the row is
 * about (a signer, a link's visitor, a vendor). Rows with no actor that no outsider made are ShipShape's own.
 */
export function historyWho(action: string, actor: "me" | "member" | null): string {
  if (actor === "me") return "You";
  if (actor === "member") return "Teammate";
  if (action.startsWith("esign.") || action === "document.signed_version_added") return "Signer";
  if (action.startsWith("document.link_")) return "Link";
  if (action.startsWith("collect.")) return "Vendor";
  return "ShipShape";
}
