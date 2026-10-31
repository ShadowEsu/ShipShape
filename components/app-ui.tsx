import Link from "next/link";
import type { Validity } from "@/lib/server/documents";

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}

const VALIDITY: Record<Validity, { label: string; cls: string; icon: string } | null> = {
  expired: { label: "Expired", cls: "bg-bad-soft text-bad", icon: "!" },
  expiring: { label: "Expires soon", cls: "bg-warn-soft text-warn", icon: "◷" },
  ok: { label: "Current", cls: "bg-ok-soft text-ok", icon: "✓" },
  none: null,
};

/** Status always pairs a colour with an icon and a word. */
export function ValidityChip({ validity, expiresOn }: { validity: Validity; expiresOn: string | null }) {
  const v = VALIDITY[validity];
  if (!v) return <span className="text-xs text-ink-3">No expiry date</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${v.cls}`}>
      <span aria-hidden="true">{v.icon}</span>
      {v.label}
      {expiresOn && <span className="font-normal">· {fmtDay(expiresOn)}</span>}
    </span>
  );
}

export const fmtDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { href: string; label: string } }) {
  return (
    <div className="card flex flex-col items-start gap-3 py-10 text-left">
      <p className="font-serif text-2xl font-semibold">{title}</p>
      <p className="max-w-prose text-sm text-ink-2">{body}</p>
      {action && (
        <Link href={action.href} className="btn">
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "ok" | "info"; children: React.ReactNode }) {
  const cls = { warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", ok: "bg-ok-soft text-ok", info: "bg-accent-soft text-ink" }[tone];
  return <div className={`rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
