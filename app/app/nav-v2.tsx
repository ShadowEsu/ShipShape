"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { initialsOf, NAV_GROUPS as GROUPS, TAB_ITEMS, WORKSPACE_HREF, type SearchTool } from "@/components/app-sections";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/ui";
import { SearchDialog } from "./search-v2";

// The top bar's title: the sidebar's name for the page, or the tool's own name for pages outside the sidebar.
const TITLES: readonly (readonly [href: string, title: string])[] = [
  ...GROUPS.flatMap((g) => g.items.map(([href, label]): readonly [string, string] => [href, label])),
  ["/app/ask", "Check a request"],
];

const isActive = (path: string, href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));

function titleFor(path: string, workspace: string): string {
  if (isActive(path, WORKSPACE_HREF)) return workspace;
  return TITLES.find(([href]) => isActive(path, href))?.[1] ?? "ShipShape";
}

/**
 * The sidebar's rows. The active row has the fill and the accent's tick; nothing moves on hover. `lapsed`: how many
 * active documents have lapsed; while it isn't 0, Deadlines carries the count as one quiet number (Quiet §1), with its
 * word on hover and ", N lapsed" read with the row.
 */
export function SideNav({ lapsed }: { lapsed: number }) {
  const path = usePathname();
  return (
    <nav aria-label="App" className="side-nav">
      {GROUPS.map((g, n) => (
        <div key={g.label ?? `g${n}`} className={n === GROUPS.length - 1 ? "mt-4" : undefined}>
          {g.label && <p className="side-label">{g.label}</p>}
          <ul>
            {g.items.map(([href, label, icon]) => {
              const active = isActive(path, href);
              const count = lapsed > 0 && href === "/app/deadlines";
              return (
                <li key={href}>
                  <Link href={href} aria-current={active ? "page" : undefined} className="side-row">
                    <Icon name={icon} size={18} className="side-icon" />
                    {label}
                    {count && (
                      <>
                        <span className="side-count" aria-hidden="true" title={`${lapsed} lapsed`}>
                          {lapsed}
                        </span>
                        <span className="sr-only">{`, ${lapsed} lapsed`}</span>
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * A bottom sheet on a native <dialog>: focus moves in and is kept there, Escape and the backdrop close it, and focus
 * returns to the button that opened it. Closes itself when the page changes underneath (a link inside was followed).
 * From md up it's a card docked bottom-left (the account row's), or with `menu` a menu placed by its opener (ActionSheet).
 */
function Sheet({ id, title, open, menu, children }: { id: string; title: string; open: React.RefObject<HTMLDialogElement | null>; menu?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    open.current?.close();
  }, [path, open]);
  const wide = menu
    ? "sheet-menu md:inset-auto md:h-fit md:w-60 md:rounded-xl md:backdrop:bg-transparent"
    : "md:inset-x-auto md:bottom-3 md:left-3 md:w-[280px] md:rounded-2xl md:backdrop:bg-black/10";
  return (
    <dialog
      ref={open}
      id={id}
      aria-labelledby={`${id}-title`}
      className={`sheet fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-2xl bg-paper p-0 pb-[env(safe-area-inset-bottom)] text-ink backdrop:bg-black/30 md:shadow-[var(--pop)] ${wide}`}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself; a link to a #fragment on this page doesn't change the path.
        if (e.target === e.currentTarget || (e.target instanceof Element && e.target.closest("a[href]"))) e.currentTarget.close();
      }}
    >
      <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line md:hidden" aria-hidden="true" />
      {/* A menu needs no heading or close button: Escape, a click outside and its own rows close it. */}
      <div className={`flex items-center justify-between px-4 pt-2 pb-1 ${menu ? "md:hidden" : ""}`}>
        <h2 id={`${id}-title`} className="section-title">
          {title}
        </h2>
        <button type="button" onClick={() => open.current?.close()} className="grid size-11 place-items-center rounded-full text-ink-2" aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className={menu ? "px-4 pb-4 md:p-1.5" : "px-4 pb-4"}>{children}</div>
    </dialog>
  );
}

const WIDE = "(min-width: 768px)";

/**
 * A round action (icon over its label) that opens further actions: the document page's More. On the phone a bottom
 * sheet; from md up a menu under the button, its right edge on the icon's, 8px below (Design, 02 Nov).
 */
export function ActionSheet({ id, title, label, className, children }: { id: string; title: string; label: string; className: string; children: React.ReactNode }) {
  const sheet = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // A menu is placed for the page as it was: the page scrolling or the window resizing under it closes it.
  useEffect(() => {
    const close = () => {
      if (sheet.current?.open && sheet.current.style.top) sheet.current.close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, []);
  const show = () => {
    const d = sheet.current;
    const b = button.current;
    if (!d || !b) return;
    const icon = b.querySelector(".round-icon") ?? b;
    if (window.matchMedia(WIDE).matches) {
      d.style.top = `${Math.round(b.getBoundingClientRect().bottom + 8)}px`;
      d.style.right = `${Math.round(document.documentElement.clientWidth - icon.getBoundingClientRect().right)}px`;
    } else {
      d.style.removeProperty("top");
      d.style.removeProperty("right");
    }
    d.showModal();
  };
  return (
    <>
      <button ref={button} type="button" aria-haspopup="dialog" aria-controls={id} onClick={show} className={className}>
        <span className="round-icon">
          <Icon name="more" />
        </span>
        {label}
      </button>
      <Sheet id={id} title={title} open={sheet} menu>
        {children}
      </Sheet>
    </>
  );
}

const ROLE: Record<"owner" | "admin" | "member", string> = { owner: "Owner", admin: "Admin", member: "Member" };

/**
 * The workspace row and its sheet: the workspace (never a person's name: ShipShape stores none), its role, Settings,
 * and what the server passes in (sign out). It sits at the sidebar's foot; the phone has the workspace page instead.
 */
export function AccountSheet({ id, workspace, role, children }: { id: string; workspace: string; role: "owner" | "admin" | "member"; children: React.ReactNode }) {
  const sheet = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-controls={id} onClick={() => sheet.current?.showModal()} className="account-row">
        <span className="account-tile" aria-hidden="true">
          {initialsOf(workspace)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] leading-[17px] font-medium text-ink" title={workspace}>
            {workspace}
          </span>
          <span className="block text-xs leading-4 text-ink-3">{ROLE[role]}</span>
        </span>
      </button>
      <Sheet id={id} title="Account" open={sheet}>
        <p className="mb-3 truncate text-sm text-ink-3">{workspace}</p>
        <ul className="group-list">
          <li>
            <Link href="/app/settings" className="group-row">
              <span className="row-icon">
                <Icon name="settings" size={18} />
              </span>
              <span className="flex-1 text-base">Settings</span>
              <span className="text-ink-3">
                <Icon name="chevron" size={16} />
              </span>
            </Link>
          </li>
        </ul>
        <div className="mt-3">{children}</div>
      </Sheet>
    </>
  );
}

// The platform doesn't change while the page is open, so there's nothing to subscribe to.
const noSubscription = () => () => {};
const isApple = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * The slim bar over every page: the page's name on the left, search in the middle (⌘K or Ctrl K from anywhere), Help
 * and Feedback on the right. On the phone: the account button (the workspace page: every page, grouped as the sidebar,
 * and the account), the logo, and search.
 */
export function TopBar({ tools, pages, contact, workspace }: { tools: readonly SearchTool[]; pages: readonly SearchTool[]; contact: string | null; workspace: string }) {
  const path = usePathname();
  const search = useRef<HTMLDialogElement>(null);
  // Null on the server and in the first render, so the shortcut's label never differs between the two.
  const apple = useSyncExternalStore(noSubscription, isApple, () => null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!search.current?.open) search.current?.showModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openSearch = () => search.current?.showModal();
  return (
    <>
      <header className="top-bar">
        <Link
          href={WORKSPACE_HREF}
          aria-current={isActive(path, WORKSPACE_HREF) ? "page" : undefined}
          className="top-icon md:hidden"
          aria-label={`${workspace}: all pages and account`}
        >
          <span className="account-tile" aria-hidden="true">
            {initialsOf(workspace)}
          </span>
        </Link>
        <p className="hidden truncate text-sm font-medium text-ink md:block">{titleFor(path, workspace)}</p>
        <div className="flex justify-center md:hidden">
          <Logo href="/app" />
        </div>
        <button type="button" aria-haspopup="dialog" aria-controls="search-dialog" onClick={openSearch} className="search-button hidden md:flex">
          <Icon name="search" size={16} />
          <span className="truncate">Search documents, people and tools</span>
          {apple !== null && <kbd className="search-kbd">{apple ? "⌘K" : "Ctrl K"}</kbd>}
        </button>
        <div className="flex items-center justify-end gap-1">
          <Link href="/faq" className="top-link hidden md:inline-flex">
            Help
          </Link>
          {contact && (
            <a href={`mailto:${contact}?subject=${encodeURIComponent("ShipShape feedback")}`} className="top-link hidden md:inline-flex">
              Feedback
            </a>
          )}
          <button type="button" aria-haspopup="dialog" aria-controls="search-dialog" onClick={openSearch} className="top-icon md:hidden" aria-label="Search">
            <Icon name="search" />
          </button>
        </div>
      </header>
      <SearchDialog open={search} tools={tools} pages={pages} />
    </>
  );
}

/**
 * The phone's tab bar (Design, 4 Nov 22:4x; Quiet §4): under 600px, fixed at the foot, exactly Home, Documents, Check,
 * Deadlines and Passport. 22px icons over 11px labels; the page you're on in ink, the rest lighter. Never animates.
 */
export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Tabs" className="tab-bar">
      <ul>
        {TAB_ITEMS.map(([href, label, icon]) => (
          <li key={href}>
            <Link href={href} aria-current={isActive(path, href) ? "page" : undefined} className="tab-item">
              <Icon name={icon} size={22} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
