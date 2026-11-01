import type { SignResult } from "@/lib/server/esign";

/** The form field a signing answer is about, so its message sits next to that field. */
export type SignField = "consent" | "name" | "code";

/** Every answer from /s/<id>/code and /s/<id>/sign except "ok": the lib's results, the network limit, and the routes' "reopen" (cookie gone). */
export type SignProblem = Exclude<SignResult, "ok"> | "too_many" | "reopen";

const FIELD: Partial<Record<SignProblem, SignField>> = { needs_consent: "consent", needs_name: "name", name_chars: "name", bad_code: "code", locked: "code", expired_code: "code" };

/** Letters the fonts can't draw whose plain form isn't a decomposition (a stroke, not a mark); ß has a two-letter twin. */
const TWINS: Record<string, string> = { Ł: "L", ł: "l", Đ: "D", đ: "d", Ħ: "H", ħ: "h", Ŧ: "T", ŧ: "t", ı: "i", ß: "ss" };

/** The plain Latin letter(s) a character is usually written as when its own form can't be printed, or null (Cyrillic, CJK, symbols). */
export function plainTwin(char: string): string | null {
  if (TWINS[char]) return TWINS[char];
  const bare = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /^[A-Za-z]$/.test(bare) ? bare : null;
}

const quoted = (chars: string[]) => chars.map((c) => (c === "a line break" ? c : `"${c}"`)).join(" or ");

/** What went wrong and what to do, naming the workspace that sent the request; `chars` names what a certificate can't print. */
const MESSAGES: Record<SignProblem, (sender: string, chars: string[]) => string> = {
  bad_code: () => "That code doesn't match. Type the 6 digits from the newest code we sent.",
  locked: () => "That code had 5 wrong tries, so it stopped working. Send a new code and use that one.",
  expired_code: () => "That code is more than 10 minutes old. Send a new code and use that one.",
  needs_consent: () => "Check the box to agree to sign electronically.",
  needs_name: () => "Type your full name to sign.",
  // Design: name the characters that failed, keep the rule, and give the plain twin of the first one when there is one.
  name_chars: (_sender, chars) => {
    const twin = chars[0] ? plainTwin(chars[0]) : null;
    const which = chars.length ? quoted(chars) : "part of that name";
    return `The certificate can't print ${which}. It can print Latin letters, numbers and common punctuation, so type your name using those${twin ? ` (for example, ${twin} for ${chars[0]})` : ""}.`;
  },
  unsupported: (sender) => `This file can't be signed here; it may be password-protected. Ask ${sender} for another copy.`,
  too_large: (sender) => `The signed copy would be over 4 MB, which ShipShape can't store. Ask ${sender} for a smaller copy.`,
  file_changed: (sender) => `This document changed after it was sent, so it can't be signed. Ask ${sender} to send it again.`,
  too_many: (sender) => `You've had all 5 codes this signing link allows. Ask ${sender} for a new link.`,
  invalid: (sender) => `This signing link has stopped working. Ask ${sender} for a new one.`,
  already_signed: () => "You've already signed this. Reload the page for your signed copy.",
  reopen: () => "This page was open too long, so nothing was signed. Open the link from your message again.",
};

const isProblem = (r: string): r is SignProblem => Object.hasOwn(MESSAGES, r);

/** The sentence and field for an answer; anything unknown reads as a link that stopped working. */
export function signProblem(result: string, sender: string, chars: string[] = []): { field: SignField | null; message: string } {
  const r = isProblem(result) ? result : "invalid";
  return { field: FIELD[r] ?? null, message: MESSAGES[r](sender, chars) };
}
