import type { Deadline } from "@/lib/server/deadlines";

/** How far a date is from the viewer's today, in words: "12 days ago", "today", "in 21 days". Both looks use it. */
export function when(d: Deadline) {
  if (d.days_left < 0) return `${-d.days_left} ${d.days_left === -1 ? "day" : "days"} ago`;
  if (d.days_left === 0) return "today";
  return `in ${d.days_left} ${d.days_left === 1 ? "day" : "days"}`;
}
