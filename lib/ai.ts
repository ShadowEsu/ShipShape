/** The one hosted AI recipient. Every consent box, page and policy that names it reads this. */
export const AI_RECIPIENT = "Anthropic's Claude";

/** "What are they asking for?": the unticked box shown with each request, stored (version) when ticked. */
export const AI_REQUEST_CONSENT_VERSION = "ai-request-2026-11-01";
export const AI_REQUEST_CONSENT_TEXT =
  `Send the text above to ${AI_RECIPIENT} to list the documents it asks for. ` +
  "Numbers shaped like an SSN or EIN are removed first, and nothing from your documents is sent. " +
  "Anthropic says that by default it doesn't train on what its API receives.";

/** Where that claim comes from, and when ShipShape last read it (Design row 49: a third-party claim names its source). */
export const AI_TRAINING_SOURCE = {
  href: "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training",
  label: "Anthropic's privacy center",
  checked: "Oct 31, 2026",
};

/** Longest request the feature reads, in characters. */
export const AI_REQUEST_MAX_CHARS = 6000;
