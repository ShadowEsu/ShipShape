"use client";

import Link from "next/link";
import { GlassTabs, useGlass } from "@/components/glass";
import { Icon } from "@/components/icons";

export interface TabLink {
  href: string;
  text: string;
  count?: number;
  current: boolean;
}

/**
 * A row of tabs that are links: the current one is marked for everyone (aria-current) and underlined (Design calm v2).
 * Under glass, the same links on Glisse's tab bar.
 */
export function TabLinks({ label, tabs }: { label: string; tabs: TabLink[] }) {
  const glass = useGlass();
  if (glass !== "off") {
    const items = tabs.map((t) => ({
      href: t.href,
      label: (
        <>
          {t.text}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </>
      ),
    }));
    return <GlassTabs label={label} tabs={items} current={tabs.find((t) => t.current)?.href ?? null} />;
  }
  return (
    <nav aria-label={label} className="tab-row">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.current ? "page" : undefined} className="tab">
          {t.text}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A small menu of choices that are links (a disclosure, so it works without script): its button shows the current
 * choice, and its name says what it chooses. Keyed by the choice, so it closes once one is followed.
 */
export function FilterMenu({ label, options }: { label: string; options: TabLink[] }) {
  const current = options.find((o) => o.current)?.text ?? options[0]?.text ?? "";
  return (
    <details key={current} className="filter-menu">
      <summary aria-label={`${label}: ${current}`}>
        {current}
        <span className="rotate-90 text-ink-3">
          <Icon name="chevron" size={14} />
        </span>
      </summary>
      <ul>
        {options.map((o) => (
          <li key={o.href}>
            <Link href={o.href} aria-current={o.current ? "true" : undefined}>
              {o.text}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
