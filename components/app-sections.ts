import type { IconName } from "./icons";

export type NavItem = readonly [href: string, label: string, icon: IconName];

/**
 * The sidebar (Design calm v2, look A): Home, then flat rows under small grey group labels, then Settings. Only pages
 * that exist are listed. A plain module, so server components (PageHeader) can read the names too.
 */
export const NAV_GROUPS: readonly { label: string | null; items: readonly NavItem[] }[] = [
  { label: null, items: [["/app", "Home", "home"]] },
  {
    label: "Work",
    items: [
      ["/app/documents", "Documents", "documents"],
      ["/app/saved", "Saved", "bookmark"],
      ["/app/signed", "Signed copies", "sign"],
      ["/app/sent", "Sent", "send"],
      ["/app/make", "Templates", "page"],
    ],
  },
  {
    label: "Track",
    items: [
      ["/app/history", "History", "history"],
      ["/app/deadlines", "Deadlines", "deadlines"],
      ["/app/passport", "Passport", "passport"],
    ],
  },
  {
    label: "Business",
    items: [
      ["/app/facts", "Business facts", "facts"],
      ["/app/collect", "Collect", "collect"],
      ["/app/people", "People", "people"],
    ],
  },
  { label: null, items: [["/app/settings", "Settings", "settings"]] },
];

/** The section names the sidebar and the top bar already show. */
export const SECTION_NAMES: ReadonlySet<string> = new Set(NAV_GROUPS.flatMap((g) => g.items.map(([, label]) => label)));
