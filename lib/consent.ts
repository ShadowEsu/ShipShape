/**
 * Shown to every signer and stored (version + SHA-256) with their signature (ESIGN Act and UETA consent).
 * The summary sits beside the box; the full consent opens under it ("Read the full consent"); the version shows beside
 * the box. What the signer agrees to, what is hashed and what the certificate prints is the summary and the full consent together.
 * DRAFT for the attorney (Design row 46): the version changes when the wording is approved.
 */
export const ESIGN_CONSENT_VERSION = "esign-2026-11-01-draft";

export const ESIGN_CONSENT_SUMMARY =
  "I agree to use electronic records and signatures for this document, and I intend my typed name to be my signature. " +
  "To read and keep it I need a device that can open PDF files; I can download the signed copy right after signing. " +
  "I can withdraw this consent before signing by not signing, and I can ask the sender for a paper copy at any time.";

/** The disclosures behind "Read the full consent", in the order shown. Fixed text: nothing from the request is filled in. */
export const ESIGN_CONSENT_FULL: { heading: string; text: string }[] = [
  {
    heading: "What this covers.",
    text: "This consent is for this one document from the sender named on this page. It doesn't cover anything else they or ShipShape send later.",
  },
  {
    heading: "Paper copy.",
    text: "You can ask the sender for a paper copy of this document at any time, before or after signing. ShipShape doesn't charge for one; the sender may have its own terms.",
  },
  {
    heading: "Not signing.",
    text: "Until you sign, you can close this page and nothing is signed; the request ends on its own on the date shown on this page. Once you've signed, the signature stands, and a change needs a new document from the sender.",
  },
  {
    heading: "What you need.",
    text: "A current web browser and something that opens PDF files. The signed copy is a PDF you can download right after signing and until the date shown on this page; keep your own copy.",
  },
  {
    heading: "Your contact details.",
    text: "ShipShape keeps no account for signers. If your email address changes, tell the sender; they can send a new request.",
  },
  {
    heading: "How it's recorded.",
    text: "The certificate added to the signed PDF records the name you typed, when you signed, the email the one-time code went to, a fingerprint of your network connection (not your address), the document's checksums and the version of this consent.",
  },
];

export const ESIGN_CONSENT_TEXT = [ESIGN_CONSENT_SUMMARY, ...ESIGN_CONSENT_FULL.map((p) => `${p.heading} ${p.text}`)].join("\n");
