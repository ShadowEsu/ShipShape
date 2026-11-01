/** Version of /terms and /privacy recorded with every agreement; change it whenever either text changes. */
export const TERMS_VERSION = "2026-10-31k-draft";

/**
 * Shown with a required, unticked checkbox before a filled document is created (legal-risk-playbook §2, §6).
 * The lead is the box's label; the detail sits under it as its description. What the person agrees to is both (ACK_TEXT).
 * DRAFT for the attorney (Design row 47): the version changes when the wording is approved.
 */
export const ACK_VERSION = "ack-2026-11-01-draft";
export const ACK_LEAD = "I've checked every field and I'm responsible for what this document says.";
export const ACK_DETAIL =
  "ShipShape fills in forms. It isn't a law firm or a tax adviser and doesn't give legal or tax advice; if I need advice, I'll get it from a professional.";
export const ACK_TEXT = `${ACK_LEAD} ${ACK_DETAIL}`;
