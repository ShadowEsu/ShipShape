import Link from "next/link";
import { ScrollFlag } from "@/components/scroll-flag";
import { Logo, NotLegalAdvice } from "@/components/ui";
import { realDocsEnabled, uiV2 } from "@/lib/server/flags";
import "@/app/site-quiet.css";

const NAV: [href: string, label: string][] = [
  ["/#how", "How it works"],
  ["/pricing", "Pricing"],
  ["/faq", "FAQ"],
];

/**
 * The site's header: Quiet (each page's own `.site-quiet` chrome) unless SHIPSHAPE_UI=v1 brings back the earlier one.
 * The Quiet header stays at the top as the page scrolls: the page's colour at first, glass once content runs under it
 * (Quiet §3). The logo, the links in a pill in the middle, and one ink action (site direction A, row 520).
 */
export function SiteHeader() {
  const cta = realDocsEnabled() ? "Sign in" : "Try the sample";
  if (uiV2()) {
    return (
      <>
        <ScrollFlag target=".sq-header" />
        <header className="site-quiet sq-header">
          <div className="sq-wrap sq-header-row">
            <Logo />
            <nav aria-label="Main" className="sq-nav">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="sq-nav-link">
                  {label}
                </Link>
              ))}
            </nav>
            <Link href="/signin" className="sq-btn sq-btn-cta sq-header-cta">
              {cta}
            </Link>
          </div>
        </header>
      </>
    );
  }
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
          {cta}
        </Link>
      </nav>
    </header>
  );
}

/** The earlier footer's links (SHIPSHAPE_UI=v1); the Quiet footer groups the same ones. */
const FOOTER: [href: string, label: string][] = [
  ["/for/contractors", "For contractors"],
  ["/for/freelancers", "For freelancers"],
  ["/pricing", "Pricing"],
  ["/faq", "FAQ"],
  ["/status", "Status"],
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
  ["/faq#support", "Contact"],
];

const FOOTER_GROUPS: { title: string; links: [href: string, label: string][] }[] = [
  { title: "Product", links: [["/#how", "How it works"], ["/pricing", "Pricing"], ["/faq", "FAQ"], ["/status", "Status"]] },
  { title: "For", links: [["/for/contractors", "Contractors"], ["/for/freelancers", "Freelancers"]] },
  { title: "Company", links: [["/terms", "Terms"], ["/privacy", "Privacy"], ["/faq#support", "Contact"]] },
];

export function SiteFooter() {
  if (uiV2()) {
    return (
      <footer className="site-quiet sq-footer">
        <div className="sq-wrap sq-footer-row">
          <div className="sq-footer-brand">
            <Logo />
            <NotLegalAdvice className="sq-legal" />
          </div>
          {FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={`Footer: ${group.title}`} className="sq-footer-nav">
              <p className="sq-footer-title">{group.title}</p>
              {group.links.map(([href, label]) => (
                <Link key={href} href={href} className="sq-footer-link">
                  {label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
        {/* The name, large and faint, cut by the page's edge: pure decoration (WCAG 1.4.3 sets it no contrast), so screen
            readers skip it and the word is drawn by the stylesheet (.sq-wordmark::before), not set as text to check. */}
        <p className="sq-wordmark" aria-hidden="true" />
      </footer>
    );
  }
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
