"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { NAV_GROUPS as GROUPS } from "@/components/app-sections";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/ui";
import { SearchDialog, type SearchTool } from "./search-v2";

// The top bar's title: the sidebar's name for the page, or the tool's own name for pages outside the sidebar.
const TITLES: readonly (readonly [href: string, title: string])[] = [
  ...GROUPS.flatMap((g) => g.items.map(([href, label]): readonly [string, string] => [href, label])),
  ["/app/ask", "Check a request"],
];

const isActive = (path: string, href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));

function titleFor(path: string): string {
  return TITLES.find(([href]) => isActive(path, href))?.[1] ?? "ShipShape";
}

/**
 * The sidebar's rows. The active row has the faint fill and the accent icon; nothing moves on hover. `lapsed`: how many
 * active documents have lapsed; while it isn't 0, Deadlines carries the count as a small red badge, so it means something
 * to sighted people too (not just a dot), with its word on hover and ", N lapsed" read with the row.
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

/**
 * The workspace row and its sheet: the workspace (never a person's name: ShipShape stores none), its role, Settings,
 * and what the server passes in (sign out). It sits at the sidebar's foot, and at the foot of the phone's menu.
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

/** The phone's menu: the sidebar as a panel from the left, Help and Feedback (the top bar's, which the phone hides), and the workspace row at its foot. */
function NavDrawer({ open, lapsed, contact, account }: { open: React.RefObject<HTMLDialogElement | null>; lapsed: number; contact: string | null; account: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    open.current?.close();
  }, [path, open]);
  return (
    <dialog
      ref={open}
      id="nav-drawer"
      aria-label="Menu"
      className="drawer fixed inset-y-0 right-auto left-0 m-0 h-dvh max-h-none w-[300px] max-w-[85vw] flex-col bg-side p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink backdrop:bg-black/30 open:flex"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target instanceof Element && e.target.closest("a[href]"))) e.currentTarget.close();
      }}
    >
      <div className="flex items-center justify-between py-1 pr-1 pl-4">
        <Logo href="/app" />
        <button type="button" onClick={() => open.current?.close()} className="grid size-11 place-items-center rounded-full text-ink-2" aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5">
        <SideNav lapsed={lapsed} />
        <ul aria-label="Help" className="mt-4 mb-2 flex gap-1 px-1.5 text-sm text-ink-2">
          <li>
            <Link href="/faq" className="inline-flex min-h-11 items-center rounded-full px-2.5 hover:text-ink">
              Help
            </Link>
          </li>
          {contact && (
            <li>
              <a href={`mailto:${contact}?subject=${encodeURIComponent("ShipShape feedback")}`} className="inline-flex min-h-11 items-center rounded-full px-2.5 hover:text-ink">
                Feedback
              </a>
            </li>
          )}
        </ul>
      </div>
      <div className="border-t border-line px-2.5 py-2">{account}</div>
    </dialog>
  );
}

// The platform doesn't change while the page is open, so there's nothing to subscribe to.
const noSubscription = () => () => {};
const isApple = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * The slim bar over every page: the page's name on the left, search in the middle (⌘K or Ctrl K from anywhere), Help
 * and Feedback on the right. On the phone: the menu, the logo, and search.
 */
export function TopBar({ tools, contact, lapsed, account }: { tools: readonly SearchTool[]; contact: string | null; lapsed: number; account: React.ReactNode }) {
  const path = usePathname();
  const search = useRef<HTMLDialogElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
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
        <button
          type="button"
          aria-haspopup="dialog"
          aria-controls="nav-drawer"
          onClick={() => {
            const d = drawer.current;
            if (!d) return;
            d.showModal();
            // The menu starts on the page you're on (or Close), not on the logo above the menu items.
            (d.querySelector<HTMLElement>('a[aria-current="page"]') ?? d.querySelector<HTMLElement>('button[aria-label="Close"]'))?.focus();
          }}
          className="top-icon md:hidden"
          aria-label="Menu"
        >
          <Icon name="menu" />
        </button>
        <p className="hidden truncate text-sm font-medium text-ink md:block">{titleFor(path)}</p>
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
      <SearchDialog open={search} tools={tools} />
      <NavDrawer open={drawer} lapsed={lapsed} contact={contact} account={account} />
    </>
  );
}
