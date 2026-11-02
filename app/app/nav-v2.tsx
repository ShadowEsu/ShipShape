"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";

type Item = readonly [href: string, label: string, icon: IconName];

// The sidebar's tools (Design spec 2026-11-02 §4); Make, Check a request and Settings open from Home and the account row.
const SIDE: readonly Item[] = [
  ["/app", "Home", "home"],
  ["/app/documents", "Documents", "documents"],
  ["/app/passport", "Passport", "passport"],
  ["/app/deadlines", "Deadlines", "deadlines"],
  ["/app/collect", "Collect", "collect"],
  ["/app/facts", "Business facts", "facts"],
];
// The phone's tab bar, then what its More sheet holds.
const TABS: readonly Item[] = SIDE.slice(0, 4);
const MORE: readonly Item[] = [
  ["/app/collect", "Collect", "collect"],
  ["/app/facts", "Business facts", "facts"],
  ["/app/make", "Make a document", "make"],
  ["/app/ask", "Check a request", "check"],
  ["/app/settings", "Settings", "settings"],
];

const isActive = (path: string, href: string) => (href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`));

/** The desktop sidebar's tool list. The active item carries the brand tint; nothing moves on hover. */
export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="App" className="mt-6 space-y-0.5">
      {SIDE.map(([href, label, icon]) => {
        const active = isActive(path, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors duration-[180ms] ${
              active ? "bg-paper font-semibold text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-ink-2 hover:bg-paper/70"
            }`}
          >
            <span className={active ? "text-brand" : "text-ink-3"}>
              <Icon name={icon} />
            </span>
            {label}
          </Link>
        );
      })}
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
      className={`sheet fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-[20px] bg-paper p-0 pb-[env(safe-area-inset-bottom)] text-ink backdrop:bg-black/30 md:shadow-[0_12px_40px_-12px_rgb(0_0_0/0.3)] ${wide}`}
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

function SheetLinks({ items }: { items: readonly Item[] }) {
  const path = usePathname();
  return (
    <ul className="group-list">
      {items.map(([href, label, icon]) => (
        <li key={href}>
          <Link href={href} aria-current={isActive(path, href) ? "page" : undefined} className="group-row">
            <span className="grid size-8 place-items-center rounded-lg bg-tile text-ink-2">
              <Icon name={icon} />
            </span>
            <span className="flex-1 text-base">{label}</span>
            <span className="text-ink-3">
              <Icon name="chevron" size={16} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The phone's tab bar: four tools and More (a sheet with the rest). Fixed to the bottom, above the home indicator. */
export function TabBar() {
  const path = usePathname();
  const more = useRef<HTMLDialogElement>(null);
  const inMore = MORE.some(([href]) => isActive(path, href));
  const tab = (active: boolean) => `flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "font-semibold text-brand" : "text-ink-3"}`;
  return (
    <>
      <nav
        aria-label="App"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-paper/85 px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),20px)] backdrop-blur-xl md:hidden"
      >
        {TABS.map(([href, label, icon]) => {
          const active = isActive(path, href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`press ${tab(active)}`}>
              <Icon name={icon} size={24} />
              {label}
            </Link>
          );
        })}
        <button type="button" aria-haspopup="dialog" aria-controls="more-sheet" onClick={() => more.current?.showModal()} className={`press ${tab(inMore)}`}>
          <Icon name="more" size={24} />
          More
        </button>
      </nav>
      <Sheet id="more-sheet" title="More" open={more}>
        <SheetLinks items={MORE} />
      </Sheet>
    </>
  );
}

/**
 * The account button and its sheet: the workspace, Settings, and what the server passes in (sign out). On the phone it's
 * the icon at the top right; in the sidebar it's the workspace row at the foot, and the sheet opens above it.
 */
export function AccountSheet({ id, workspace, row, children }: { id: string; workspace: string; row?: boolean; children: React.ReactNode }) {
  const sheet = useRef<HTMLDialogElement>(null);
  const show = () => sheet.current?.showModal();
  return (
    <>
      {row ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-controls={id}
          onClick={show}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors duration-[180ms] hover:bg-paper/70"
        >
          <span className="text-ink-3">
            <Icon name="account" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink" title={workspace}>
              {workspace}
            </span>
            <span className="block text-xs text-ink-3">Settings</span>
          </span>
        </button>
      ) : (
        <button type="button" aria-haspopup="dialog" aria-controls={id} onClick={show} className="press grid size-11 place-items-center rounded-full text-ink-2" aria-label="Account">
          <Icon name="account" size={24} />
        </button>
      )}
      <Sheet id={id} title="Account" open={sheet}>
        <p className="mb-3 truncate text-sm text-ink-3">{workspace}</p>
        <SheetLinks items={[["/app/settings", "Settings", "settings"]]} />
        <div className="mt-3">{children}</div>
      </Sheet>
    </>
  );
}
