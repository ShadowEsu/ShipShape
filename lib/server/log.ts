import "server-only";
import { formatWithOptions } from "node:util";

/**
 * Nothing that looks like an SSN, EIN or ITIN may reach a log line (Security R4). Every server
 * console method is wrapped at startup (instrumentation.ts), so Next.js's own error output and
 * any library logging go through the same scrubber as ours.
 */

// Unicode dashes and minus signs (hyphen, non-breaking hyphen, figure/en/em dash, minus, small and
// full-width hyphen-minus), read as "-". NFKC first turns full-width digits into ASCII ones.
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
// 9 digits with up to three separators (space, - . / _) between any two of them: SSN 3-2-4, EIN 2-7,
// ungrouped, or spaced digit by digit. Never 9 digits taken out of a longer number.
const SEP = String.raw`[\s\-./_]{0,3}`;
const TAX_ID = new RegExp(String.raw`(?<!\d${SEP})\d(?:${SEP}\d){8}(?!${SEP}\d)`, "g");
// Share, signing and upload links' ids or tokens in paths or query strings.
const LINK_TOKEN = /\/(p|s|c)\/[A-Za-z0-9_-]{20,}/g;

export function scrub(text: string): string {
  return text.normalize("NFKC").replace(DASHES, "-").replace(TAX_ID, "[redacted-id]").replace(LINK_TOKEN, "/$1/[redacted-token]");
}

const METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;
let installed = false;

export function installLogScrubber(target: Console = console) {
  if (installed && target === console) return;
  for (const m of METHODS) {
    const original = target[m].bind(target);
    target[m] = (...args: unknown[]) => original(scrub(formatWithOptions({ colors: false, depth: 4 }, ...args)));
  }
  if (target === console) installed = true;
}
