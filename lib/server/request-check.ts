import "server-only";
import { AI_REQUEST_MAX_CHARS } from "@/lib/ai";
import { askedDocuments } from "@/lib/request-words";
import type { Validity } from "@/lib/today";
import { listDocuments, type DocKind } from "./documents";
import { UserError } from "./errors";
import { rateLimited } from "./http";
import type { Ctx } from "./profile";

/**
 * "What are they asking for?": a pasted request's documents against the vault. Two readers find what it asks for: the
 * AI (lib/server/ai.ts readRequest, opt-in each time) and, while AI is off, the plain one here, which matches document
 * names in the text (lib/request-words.ts) and sends nothing anywhere. Both answer through matchToDocuments.
 */

export interface MatchedDoc {
  id: string;
  title: string;
  validity: Validity;
  expires_on: string | null;
}
export interface RequestItem {
  kind: DocKind;
  label: string;
  quote: string | null;
  /** null: no quote given. false: the quote isn't in the request, so show "Not found in the request". */
  traced: boolean | null;
  /** From the best match: ready (current), expiring, expired; missing: no match; unmatched: kind "other" and no title match. */
  state: "ready" | "expiring" | "expired" | "missing" | "unmatched";
  matches: MatchedDoc[];
}
/** Who found the items: the AI, or the plain reader matching document names. */
export type ReadBy = "ai" | "names";

/** A problem with one field of the request form; `field` says which, so the form shows the message there. */
export class RequestInputError extends UserError {
  readonly field: "text" | "consent";
  constructor(field: "text" | "consent", message: string) {
    super(message);
    this.field = field;
  }
}

/** The pasted request, trimmed, or a field error: too short to be a request, or longer than either reader takes. */
export function requestText(raw: string): string {
  const text = raw.trim();
  if (text.length < 20) throw new RequestInputError("text", "Paste the request: the email or checklist that asks for your documents.");
  if (text.length > AI_REQUEST_MAX_CHARS) {
    throw new RequestInputError("text", `That's longer than ${AI_REQUEST_MAX_CHARS} characters. Paste just the part that lists the documents.`);
  }
  return text;
}

const VALIDITY_ORDER: Record<Validity, number> = { ok: 0, none: 1, expiring: 2, expired: 3 };

// Words too common in document names to tell two documents apart.
const FILLER = new Set(["the", "and", "for", "your", "our", "copy", "form", "completed", "signed", "sample", "naming", "with", "from", "certificate", "proof"]);
const nameWords = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !FILLER.has(w)));
const normalise = (s: string) => s.toLowerCase().replace(/[\s"“”'‘’]+/g, " ").trim();

/**
 * Each asked-for document against this workspace's documents. Candidates: the same kind, or a title sharing at least
 * two words with what was asked for (a "city business license" kept as a permit). Best first: most shared words, then
 * most current. `source` is the text the quotes must come from (the AI's quotes are checked against it).
 */
export async function matchToDocuments(
  ctx: Ctx,
  asked: readonly { kind: DocKind; label: string; quote?: string | null }[],
  source: string,
): Promise<RequestItem[]> {
  const docs = (await listDocuments(ctx)).map((d) => ({ doc: d, words: nameWords(d.title) }));
  const text = normalise(source);
  return asked.map((item) => {
    const quote = item.quote || null;
    const words = nameWords(item.label);
    const matches = docs
      .map(({ doc, words: titleWords }) => ({ doc, shared: [...words].filter((w) => titleWords.has(w)).length }))
      .filter(({ doc, shared }) => (item.kind !== "other" && doc.kind === item.kind) || shared >= 2)
      .sort((a, b) => b.shared - a.shared || VALIDITY_ORDER[a.doc.validity] - VALIDITY_ORDER[b.doc.validity])
      .slice(0, 5)
      .map(({ doc }) => ({ id: doc.id, title: doc.title, validity: doc.validity, expires_on: doc.expires_on }));
    const best = matches[0]?.validity;
    const state: RequestItem["state"] = !best ? (item.kind === "other" ? "unmatched" : "missing") : best === "ok" || best === "none" ? "ready" : best;
    return { kind: item.kind, label: item.label, quote, traced: quote === null ? null : text.includes(normalise(quote)), state, matches };
  });
}

/**
 * Check a request without AI (ledger 461): the documents it names, matched by name, against the vault. The text stays
 * on the server and isn't kept; there's no consent to ask for. The limit only bounds database reads.
 */
export async function readRequestByNames(ctx: Ctx, raw: string, network: string): Promise<RequestItem[]> {
  const text = requestText(raw);
  if ((await rateLimited("check-user", ctx.userId, 60, 3600)) || (await rateLimited("check-net", network, 180, 3600))) {
    throw new UserError("That's the hourly limit for checking requests. Try again in an hour.");
  }
  return matchToDocuments(ctx, askedDocuments(text), text);
}
