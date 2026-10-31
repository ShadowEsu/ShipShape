import "server-only";
import { formatWithOptions } from "node:util";

/**
 * Nothing that looks like an SSN, EIN or ITIN may reach a log line (Security R4). Every server
 * console method is wrapped at startup (instrumentation.ts), so Next.js's own error output and
 * any library logging go through the same scrubber as ours.
 */

// Invisible format characters (zero-width space, soft hyphen, direction marks...) are dropped, so
// they can't split a number. NFKC turns full-width digits into ASCII ones.
const FORMAT_CHARS = /\p{Cf}/gu;
// Unicode dashes and minus signs (hyphen, non-breaking hyphen, figure/en/em dash, minus, small and
// full-width hyphen-minus), read as "-".
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
// Any run of 9 or more digits with up to three separators (space, - . / _) between each pair: SSN
// 3-2-4, EIN 2-7, ungrouped, spaced digit by digit, or touching other digits ("1. 900-12-3456").
// The whole run goes, so a tax ID never survives inside a longer number; a 10-digit phone number
// written with those separators goes too. IRS form names (W-9, W-8BEN...) match first and stay, so
// "W-9 900-12-3456" keeps its "W-9" and loses the number.
const SEP = String.raw`[\s\-./_]{0,3}`;
const TAX_ID = new RegExp(String.raw`\bW-?(?:9|8(?:BEN-E|BEN|ECI|EXP|IMY)?)(?![\dA-Za-z])|\d(?:${SEP}\d){8,}`, "gi");
// Share, signing and upload links' ids or tokens in paths or query strings.
const LINK_TOKEN = /\/(p|s|c)\/[A-Za-z0-9_-]{20,}/g;

export function scrub(text: string): string {
  return text
    .normalize("NFKC")
    .replace(FORMAT_CHARS, "")
    .replace(DASHES, "-")
    .replace(TAX_ID, (m) => (/^\d/.test(m) ? "[redacted-id]" : m))
    .replace(LINK_TOKEN, "/$1/[redacted-token]");
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
