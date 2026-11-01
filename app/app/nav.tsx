"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  ["/app", "Home"],
  ["/app/documents", "Documents"],
  ["/app/make", "Make a document"],
  ["/app/ask", "Check a request"],
  ["/app/passport", "Passport"],
  ["/app/collect", "Collect"],
  ["/app/deadlines", "Deadlines"],
  ["/app/facts", "Business facts"],
  ["/app/settings", "Settings"],
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="App" className="-mx-1 mt-4 flex gap-1 overflow-x-auto md:mx-0 md:mt-8 md:flex-col md:overflow-visible">
      {NAV.map(([href, label]) => {
        const active = href === "/app" ? path === "/app" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm whitespace-nowrap ${active ? "bg-canvas font-semibold text-ink" : "text-ink-2 hover:bg-canvas"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// Where a missing page's one link goes: back to the list the link came from.
const BACK = [
  ["/app/documents", "Back to your documents"],
  ["/app/passport", "Back to your passport links"],
  ["/app/collect", "Back to Collect"],
  ["/app/make", "Back to Make a document"],
] as const;

/** The not-found page's one action: the section the missing page belongs to, or Home. */
export function BackToSection() {
  const path = usePathname();
  const [href, label] = BACK.find(([prefix]) => path.startsWith(prefix)) ?? ["/app", "Go to Home"];
  return (
    <Link href={href} className="btn">
      {label}
    </Link>
  );
}
