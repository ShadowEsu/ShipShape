/**
 * The Home box's first answer, worked out in the browser from the words alone (Design spec 2026-11-02 §3, BOSS 01:2x):
 * which tool does what was typed, or whether it's a customer's request to check. It never says which document
 * someone needs; it only points at a tool.
 */

/** The tools the box can point at (lib/server/tools.ts ids), plus the two documents Make fills. */
export type Destination =
  | { tool: "documents" | "add" | "make" | "check" | "passport" | "sign" | "collect" | "deadlines" | "facts" | "settings" }
  | { tool: "make"; template: "irs-w9" | "common-paper-mnda" };

/** Ordered: the first rule whose words appear wins, so a specific ask ("send vendors a link") beats a generic one ("link"). */
const RULES: { test: RegExp; to: Destination }[] = [
  { test: /\b(sign(ing)? out|log ?out|billing|invoices?|upgrade|plans?|pro plan|export|delete (my |the )?account|workspace name|rename)\b/, to: { tool: "settings" } },
  { test: /\b(what (are|is) (they|it|he|she) asking|check (a|this|the|my) request|checklist|asking (me )?for)\b/, to: { tool: "check" } },
  { test: /\b(vendors?|subcontractors?|subs|suppliers?|collect)\b/, to: { tool: "collect" } },
  { test: /\b(e-?sign\w*|signatures?|sign(ed|s)?|countersign\w*)\b/, to: { tool: "sign" } },
  { test: /\b(share|send|link|passport|packet)\b/, to: { tool: "passport" } },
  { test: /\b(w-? ?9s?)\b/, to: { tool: "make", template: "irs-w9" } },
  { test: /\b(nda|ndas|non-?disclosure|confidentiality)\b/, to: { tool: "make", template: "common-paper-mnda" } },
  { test: /\b(expir\w*|renew\w*|deadlines?|due|laps\w*|calendar|reminders?|out of date)\b/, to: { tool: "deadlines" } },
  { test: /\b(ein|tax id|tin|legal name|business (facts|name|address|details)|our address|my address)\b/, to: { tool: "facts" } },
  { test: /\b(make|fill|create|draft|generate|new form)\b/, to: { tool: "make" } },
  { test: /\b(upload|add|store|save|scan|keep)\b/, to: { tool: "add" } },
  { test: /\b(documents?|files?|find|search|certificates?|coi|insurance|licen[cs]es?|permits?|agreements?|contracts?)\b/, to: { tool: "documents" } },
];

/** The tool for what was typed, or null when nothing ShipShape does matches. */
export function routeFor(text: string): Destination | null {
  const t = text.toLowerCase();
  return RULES.find((r) => r.test.test(t))?.to ?? null;
}

// Words a customer's request uses for the documents it asks for (the AI reads which ones; this only spots a request).
const DOC_WORDS = /\b(w-? ?9|coi|certificates? of insurance|insurance|additional insured|licen[cs]es?|permits?|nda|non-?disclosure|agreements?|contracts?|registration|good standing|articles|w-? ?8|exemption|resale certificate|bonds?|workers'? comp\w*)\b/g;
const ASKING = /\b(we need|we'll need|we will need|please (send|provide|submit|upload|attach|forward)|send (us|over)|provide|submit|required|requirements?|before (you|your|we) (start|begin|can)|must (have|provide|submit)|on file)\b/;

/**
 * Whether the text reads like a request someone sent the business (so the box offers "Check a request"): at least
 * eight words, and either two document words, or one with asking words ("we need", "please send").
 */
export function looksLikeRequest(text: string): boolean {
  const t = text.toLowerCase();
  if (t.trim().split(/\s+/).length < 8) return false;
  const docs = t.match(DOC_WORDS)?.length ?? 0;
  return docs >= 2 || (docs >= 1 && ASKING.test(t));
}
