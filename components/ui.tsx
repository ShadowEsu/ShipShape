import Link from "next/link";
import type { Severity } from "@/lib/types";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-bold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0f5e7a" />
        <path d="M7 19h18l-3 5H10z" fill="white" />
        <path d="M16 7v10M16 7l6 8h-6" stroke="white" strokeWidth="2" fill="none" strokeLinejoin="round" />
      </svg>
      ShipShape
    </Link>
  );
}

const SEVERITY: Record<Severity, { label: string; cls: string }> = {
  blocker: { label: "Blocker", cls: "bg-red-50 text-blocker ring-red-200" },
  "missing-document": { label: "Missing document", cls: "bg-blue-50 text-doc ring-blue-200" },
  warning: { label: "Warning", cls: "bg-amber-50 text-warn ring-amber-200" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${s.cls}`}>{s.label}</span>;
}

export function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#067647" : score >= 50 ? "#b54708" : "#b42318";
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 text-lg font-bold" style={{ borderColor: color, color }}>
      {score}
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="text-xs text-slate-500">
      ShipShape reports facts about your code and live product and the rules they touch. It is not a law firm, does not give
      legal advice, and cannot guarantee approval or compliance. For legal decisions, talk to a lawyer.
    </p>
  );
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
