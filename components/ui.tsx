import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink" aria-label="ShipShape home">
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path d="M7 19h18l-3 5H10z" fill="var(--paper)" />
        <path d="M16 7v10M16 7l6 8h-6" stroke="var(--paper)" strokeWidth="2" fill="none" strokeLinejoin="round" />
      </svg>
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
