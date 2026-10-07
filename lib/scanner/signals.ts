import type { Evidence, Signals } from "../types";
import { PATTERNS, SECRET_PATTERNS, redact } from "./patterns";

const MAX_EVIDENCE = 5;

export function add(signals: Signals, key: string, ev: Evidence) {
  const list = signals.get(key) ?? [];
  if (list.length < MAX_EVIDENCE) list.push(ev);
  signals.set(key, list);
}

/** Runs every pattern over a block of text and records where each one matched. */
export function scanText(signals: Signals, file: string, text: string, opts: { secrets: boolean }) {
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    if (raw.length > 2000) return; // minified bundles: skip
    for (const p of PATTERNS) {
      if (p.re.test(raw)) add(signals, p.signal, { file, line: i + 1, snippet: raw.trim().slice(0, 160) });
    }
    if (!opts.secrets) return;
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(raw)) add(signals, p.signal, { file, line: i + 1, snippet: redact(raw, p.re) });
    }
  });
}

/** Compares detected trackers with the privacy policy text: the gap between code and documents. */
export function checkPolicyMentions(signals: Signals, policyText: string, policyFile: string) {
  const text = policyText.toLowerCase();
  for (const p of PATTERNS) {
    if (!p.vendor || !signals.has(p.signal)) continue;
    if (p.vendor.keywords.some((k) => text.includes(k))) continue;
    const first = signals.get(p.signal)![0];
    add(signals, `gap:policy-missing-vendor:${p.signal}`, {
      file: first.file,
      line: first.line,
      snippet: `${p.vendor.name} found here, but ${policyFile} never mentions it`,
    });
  }
}
