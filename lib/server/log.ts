import "server-only";
import { formatWithOptions } from "node:util";

/**
 * Nothing that looks like an SSN, EIN or ITIN may reach a log line (Security R4). Every server
 * console method is wrapped at startup (instrumentation.ts), so Next.js's own error output and
 * any library logging go through the same scrubber as ours.
 */

// 9 digits, alone or grouped as SSN (3-2-4) or EIN (2-7), with dashes, spaces or dots.
const TAX_ID = /(?<![0-9])(?:[0-9]{3}[-\s.]?[0-9]{2}[-\s.]?[0-9]{4}|[0-9]{2}[-\s.]?[0-9]{7})(?![0-9])/g;
// Share and signing tokens in paths or query strings.
const LINK_TOKEN = /\/(p|s)\/[A-Za-z0-9_-]{20,}/g;

export function scrub(text: string): string {
  return text.replace(TAX_ID, "[redacted-id]").replace(LINK_TOKEN, "/$1/[redacted-token]");
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
