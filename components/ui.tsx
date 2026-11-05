import Link from "next/link";
import { BrandMark } from "./brand-mark";

/**
 * The lockup (Design's rules): the mark about 1.4x the cap height of the 16px name, an 8px gap to "ShipShape" at 600.
 * The 24px box draws the mark about 16px tall (42 of its 64 units), and its own 1.5px side margin plus 6.5px makes the
 * 8px gap.
 */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-[6.5px] font-semibold tracking-tight text-ink" aria-label="ShipShape home">
      <BrandMark size={24} />
      <span>ShipShape</span>
    </Link>
  );
}

/** The line every place that touches law carries, word for word (Security R12; MUST-L1 to L3, 3 Nov). */
export const NOT_A_LAW_FIRM = "ShipShape is document software, not a law firm, and doesn't give legal advice.";

/** Shown wherever the product touches law (Security R12, legal-risk-playbook). */
export function NotLegalAdvice({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-5 text-ink-3 ${className}`}>
      {`${NOT_A_LAW_FIRM} You decide which documents to use and what they say. For legal questions, talk to a lawyer.`}
    </p>
  );
}

export const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

export const fmtDateTime = (iso: string | Date) =>
  new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
