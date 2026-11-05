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

/** The phone's tab bar under 600px (Design, 4 Nov 22:4x): exactly these five. Check is the request checker. */
export const TAB_ITEMS: readonly NavItem[] = [
  ["/app", "Home", "home"],
  ["/app/documents", "Documents", "documents"],
  ["/app/ask", "Check", "check"],
  ["/app/deadlines", "Deadlines", "deadlines"],
  ["/app/passport", "Passport", "passport"],
];

/** The phone's account button opens this: every page, grouped as the sidebar, titled with the business's name. */
export const WORKSPACE_HREF = "/app/workspace";

/** Something search finds by its name (⌘K): one of Home's tools, or a page. A tool's tag says why it's closed. */
export interface SearchTool {
  name: string;
  href: string;
  icon: IconName;
  tag: string | null;
}

/**
 * The pages search finds by name besides the tools: every destination the sidebar and the tab bar list that no tool
 * already goes by (same name, same place), so each one is reachable from search (Design, 4 Nov 22:4x).
 */
export function searchPages(tools: readonly SearchTool[]): SearchTool[] {
  const pages: SearchTool[] = [];
  for (const [href, name, icon] of [...NAV_GROUPS.flatMap((g) => g.items), ...TAB_ITEMS]) {
    const known = (t: SearchTool) => t.href === href && t.name.toLowerCase() === name.toLowerCase();
    if (!tools.some(known) && !pages.some(known)) pages.push({ name, href, icon, tag: null });
  }
  return pages;
}

/** What search shows for typed words: the entries whose name holds them, in order. Empty words find nothing. */
export function findByName(entries: readonly SearchTool[], words: string): SearchTool[] {
  const lower = words.trim().toLowerCase();
  return lower === "" ? [] : entries.filter((t) => t.name.toLowerCase().includes(lower));
}

/** Two letters for the workspace's tile: its first two words' initials, "(sample)" left out ("Harbor Plumbing (sample)" → HP). */
export function initialsOf(workspace: string): string {
  const words = workspace
    .replace(/\(sample\)/i, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w.length > 0);
  const letters = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

