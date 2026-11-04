import type { Deadline } from "@/lib/server/deadlines";

/**
 * How far a date is from the viewer's today, in parts around its number, so the redesigned look can count the number
 * up (v2.tsx) with the same words: "in 21 days" is { before: "in ", n: 21, after: " days" }; "today" has no number.
 */
export function whenParts(d: Deadline): { before: string; n: number | null; after: string } {
  if (d.days_left === 0) return { before: "today", n: null, after: "" };
  const n = Math.abs(d.days_left);
  const unit = n === 1 ? "day" : "days";
  return d.days_left < 0 ? { before: "", n, after: ` ${unit} ago` } : { before: "in ", n, after: ` ${unit}` };
}

/** The same in words, for the earlier look: "12 days ago", "today", "in 21 days". */
export function when(d: Deadline) {
  const { before, n, after } = whenParts(d);
  return `${before}${n ?? ""}${after}`;
}
