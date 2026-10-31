/** The one hosted AI recipient. Every consent box, page and policy that names it reads this. */
export const AI_RECIPIENT = "Anthropic's Claude";

/** "What are they asking for?": the unticked box shown with each request, stored (version) when ticked. */
export const AI_REQUEST_CONSENT_VERSION = "ai-request-2026-10-31";
export const AI_REQUEST_CONSENT_TEXT =
  `Send the text above to ${AI_RECIPIENT} to list the documents it asks for. ` +
  "Numbers shaped like an SSN or EIN are removed first, nothing from your documents is sent, and Anthropic doesn't train on it.";

/** Longest request the feature reads, in characters. */
export const AI_REQUEST_MAX_CHARS = 6000;
