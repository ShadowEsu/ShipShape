import Link from "next/link";
import { fmtDay, type Validity } from "@/lib/today";

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

/** The same date without the year, for a sentence about a date within 30 days (the year is unambiguous there and would orphan at 390). */
export const fmtMonthDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The chip for a row that's there because of a renewal notice: the same amber as "Expires soon", with the date (Design). */
export function RenewalChip({ renewsOn }: { renewsOn: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-warn">
      <span aria-hidden="true">◷</span>
      Renewal notice<span className="font-normal">· {fmtDay(renewsOn)}</span>
    </span>
  );
}

/**
 * What an empty page shows: what will appear here, optionally a ghosted example list of it (hidden
 * from screen readers: the body already says what will appear), the one action that fills it, and
 * any secondary link (children).
 */
export function EmptyState({
  title,
  body,
  example,
  action,
  children,
}: {
  title: string;
  body: string;
  example?: string[];
  action?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-start gap-3 py-10 text-left">
      <p className="font-serif text-2xl font-semibold">{title}</p>
      <p className="max-w-prose text-sm text-ink-2">{body}</p>
      {example && (
        <div aria-hidden="true" className="w-full max-w-prose select-none">
          <p className="mb-1 font-mono text-xs tracking-wide text-ink-3 uppercase">Example</p>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line text-sm text-ink-3">
            {example.map((row) => (
              <li key={row} className="px-4 py-2">
                {row}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(action || children) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {action && (
            <Link href={action.href} className="btn">
              {action.label}
            </Link>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "ok" | "info"; children: React.ReactNode }) {
  const cls = { warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", ok: "bg-ok-soft text-ok", info: "bg-accent-soft text-ink" }[tone];
  return <div className={`rounded-xl px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

/**
 * Under a workspace's name on pages people outside it open (Security RN-2): the workspace chose that
 * name, and a way to report the page once there is a contact address.
 */
export function NamedByWorkspace({ contact, page }: { contact: string | null; page: string }) {
  const report = `mailto:${contact}?subject=${encodeURIComponent("Report a ShipShape page")}&body=${encodeURIComponent(`Page: ${page}\n\nWhat's wrong:`)}`;
  return (
    <p className="text-xs text-ink-3">
      The workspace chose this name; ShipShape doesn&apos;t verify business names.
      {contact && (
        <>
          {" "}
          <a href={report} className="underline">
            Report this page
          </a>
        </>
      )}
    </p>
  );
}
