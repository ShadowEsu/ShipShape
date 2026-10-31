import Link from "next/link";
import { Logo, NotLegalAdvice } from "@/components/ui";

const NAV: [href: string, label: string][] = [
  ["/#how", "How it works"],
  ["/pricing", "Pricing"],
  ["/faq", "FAQ"],
];

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
      <Logo />
      <nav aria-label="Main" className="flex items-center gap-1 text-sm">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className="hidden rounded-full px-3 py-2 text-ink-2 hover:bg-canvas hover:text-ink sm:inline-flex">
            {label}
          </Link>
        ))}
        <Link href="/signin" className="btn-ghost ml-2">
          Try the sample
        </Link>
      </nav>
    </header>
  );
}

const FOOTER: [href: string, label: string][] = [
  ["/pricing", "Pricing"],
  ["/faq", "FAQ"],
  ["/status", "Status"],
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <Logo />
          <NotLegalAdvice className="max-w-md" />
        </div>
        <nav aria-label="Footer" className="flex flex-wrap content-start gap-x-6 gap-y-1 text-sm text-ink-2">
          {FOOTER.map(([href, label]) => (
            <Link key={href} href={href} className="py-1 hover:text-ink hover:underline">
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

/** The three capability labels (honest-conversion-claims rule 6): words carry the status, not colour. */
export type Status = "Works today" | "Awaiting setup" | "Planned";

const STATUS_STYLE: Record<Status, string> = {
  "Works today": "bg-ok-soft text-ok",
  "Awaiting setup": "border border-warn/40 text-warn",
  Planned: "border border-line text-ink-2",
};

export function StatusLabel({ status }: { status: Status }) {
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>{status}</span>;
}
