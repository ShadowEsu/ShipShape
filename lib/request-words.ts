import type { DocKind } from "@/lib/server/documents";

/**
 * Check a request without AI (ledger 461, weakest spot 4): the documents a pasted request names, found by matching the
 * names ShipShape knows, in the order the request mentions them. Nothing leaves the server and nothing is stored; it
 * reads names, not meaning, so the answer says so ("Found by matching document names, not by AI").
 */
export interface AskedDocument {
  kind: DocKind;
  /** The request's own words for it ("contractor license"), or one fixed name where requests vary (Form W-9). */
  label: string;
  /** The clause of the request that names it, word for word (a slice of the text), at most QUOTE_MAX characters. */
  quote: string;
}

export const ASKED_MAX = 20;
export const QUOTE_MAX = 200;

/**
 * Earlier rules claim their words first, so "non-disclosure agreement" is an NDA and not also an agreement, and a
 * "license bond" is a bond and not a license. `name`: a fixed label; otherwise the matched words are the label. Group
 * 1, when a rule has one, is the qualifier ("contractor" in "contractor license"): a bare "license" later in the same
 * request is the same document, not a second one. `verb`: the words around a bare match that make it the verb or a
 * phrase, not the document ("permit us to", "please permit", "in agreement"); a determiner or possessive just before
 * it (NOUN_BEFORE) makes it the document whatever follows ("your permit this week", "the signed contract with").
 */
const RULES: { kind: DocKind; test: RegExp; name?: string; verb?: { before?: RegExp; after?: RegExp } }[] = [
  { kind: "nda", test: /\b(mutual\s+)?(?:(?:ndas?|non-?disclosure)(?:\s+agreements?)?|confidentiality\s+agreements?)\b/gi },
  { kind: "w9", test: /\b(?:irs\s+)?(?:form\s+)?w-?\s?9s?\b/gi, name: "Form W-9" },
  {
    kind: "tax",
    test: /\b(?:(?:form\s+)?w-?\s?8(?:\s?-?\s?ben(?:-?e)?)?|resale\s+certificates?|(?:sales[\s-]+tax\s+)?exemption\s+certificates?|tax[\s-]+exempt(?:ion)?\s+certificates?)\b/gi,
  },
  {
    // Kind "other": matched by its title's words only, so a general liability certificate isn't taken for it.
    kind: "other",
    test: /\bworkers['’]?\s*comp(?:ensation)?(?:\s+insurance)?(?:\s+certificates?)?\b/gi,
    name: "Workers' compensation certificate",
  },
  {
    kind: "coi",
    test: /\b(?:certificates?\s+of\s+(?:general\s+)?(?:liability\s+)?insurance|insurance\s+certificates?|cois?|proof\s+of\s+(?:general\s+)?(?:liability\s+)?insurance|(?:general\s+)?liability\s+insurance|additional(?:ly)?\s+insured)\b/gi,
    name: "Certificate of insurance",
  },
  {
    kind: "registration",
    test: /\b(?:certificates?\s+of\s+good\s+standing|good\s+standing\s+certificates?|business\s+registrations?|articles\s+of\s+(?:incorporation|organi[sz]ation)|secretary\s+of\s+state\s+(?:registration|filing)s?)\b/gi,
  },
  { kind: "other", test: /\b((?:surety|performance|payment|license|contractor['’]?s?)\s+)?bonds?\b/gi },
  {
    kind: "permit",
    test: /\b((?:building|health|occupancy|seller['’]?s|sales\s+tax|food|business|work|special\s+event|plumbing|electrical|mechanical|fire|sign|zoning|demolition|grading|encroachment|right[\s-]of[\s-]way)\s+)?permits?\b/gi,
    verb: {
      before: /\b(?:to|will|would|may|might|can|could|shall|should|must|not|please|does|do|did|won['’]t|can['’]t|cannot)\s+$/i,
      after: /^\s+(?:us|you|them|him|her|me|our|your|their|the|a|an|this|that|access|entry)\b/i,
    },
  },
  {
    kind: "license",
    test: /\b((?:general\s+)?(?:contractor['’]?s?|business|trade|professional|state|electrical|electrician['’]?s?|plumbing|plumber['’]?s?|hvac|liquor|food|driver['’]?s?|real\s+estate)\s+)?licen[cs]es?\b/gi,
  },
  {
    kind: "agreement",
    test: /\b((?:master\s+services?|subcontract(?:or)?|vendor|services?|lease|rental|independent\s+contractor)\s+)?(?:agreements?|contracts?)\b/gi,
    verb: { before: /\b(?:in|by|under|per|reach|reached|come\s+to|we|they|you|to)\s+$/i, after: /^\s+(?:with|out|that)\b/i },
  },
];

const NOUN_BEFORE = /\b(?:the|a|an|your|our|their|his|her|its|my|this|these|those|signed|executed|current|valid|updated)\s+$/i;

interface Hit {
  kind: DocKind;
  label: string;
  qualified: boolean;
  start: number;
  end: number;
}

/** A clause ends at sentence punctuation, a line break or a comma (not one inside a number, as in 1,000,000). */
const endsClause = (text: string, i: number) =>
  /[.!?;:\n]/.test(text.charAt(i)) || (text.charAt(i) === "," && !(/\d/.test(text.charAt(i - 1)) && /\d/.test(text.charAt(i + 1))));

/** The clause around [start, end), as a slice of the text: no leading "and"/"or", at most QUOTE_MAX characters. */
export function clauseAround(text: string, start: number, end: number): string {
  let a = start;
  while (a > 0 && !endsClause(text, a - 1)) a--;
  let b = end;
  while (b < text.length && !endsClause(text, b)) b++;
  // Too long: a window around the words themselves, still a slice of the text.
  if (b - a > QUOTE_MAX) {
    const room = Math.max(0, Math.floor((QUOTE_MAX - (end - start)) / 2));
    a = Math.max(a, start - room);
    b = Math.min(b, a + QUOTE_MAX);
  }
  // A list's bullet ("- ", "• ", "2) ") and a joining word aren't part of what was asked for.
  const quote = text.slice(a, b).trim();
  const lead = /^(?:[-*•·]\s*|\d{1,2}\)\s+)?(?:(?:and|or|plus|also|as well as)\s+)?/i.exec(quote);
  return quote.slice(lead?.[0].length ?? 0);
}

const tidy = (words: string) => {
  const t = words.replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
// One document named twice ("a COI ... the COI", "licenses" and "license") is one item.
const sameName = (label: string) => label.toLowerCase().replace(/[’']/g, "'").replace(/s\b/g, "");

/** The documents `text` names, in the order it names them: one item per distinct name, at most ASKED_MAX. */
export function askedDocuments(text: string): AskedDocument[] {
  const claimed: [number, number][] = [];
  const hits: Hit[] = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.test)) {
      const start = m.index;
      const end = start + m[0].length;
      const qualified = Boolean(m[1]);
      if (claimed.some(([a, b]) => start < b && end > a)) continue;
      // 40 characters either side hold the words that decide it, and keep the test cheap on a long paste.
      const [before, after] = [text.slice(Math.max(0, start - 40), start), text.slice(end, end + 40)];
      if (!qualified && !NOUN_BEFORE.test(before) && (rule.verb?.before?.test(before) || rule.verb?.after?.test(after))) continue;
      claimed.push([start, end]);
      hits.push({ kind: rule.kind, label: rule.name ?? tidy(m[0]), qualified, start, end });
    }
  }
  hits.sort((x, y) => x.start - y.start);
  const qualifiedKinds = new Set(hits.filter((h) => h.qualified).map((h) => h.kind));
  const seen = new Set<string>();
  const out: AskedDocument[] = [];
  for (const h of hits) {
    // A bare "license" where the request also names a "contractor license" is that license again.
    if (!h.qualified && !h.label.includes(" ") && qualifiedKinds.has(h.kind)) continue;
    const key = `${h.kind}:${sameName(h.label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: h.kind, label: h.label, quote: clauseAround(text, h.start, h.end) });
    if (out.length === ASKED_MAX) break;
  }
  return out;
}
