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
 */
function Sheet({ id, title, open, children }: { id: string; title: string; open: React.RefObject<HTMLDialogElement | null>; children: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => {
    open.current?.close();
  }, [path, open]);
  return (
    <dialog
      ref={open}
      id={id}
      aria-labelledby={`${id}-title`}
      className="sheet fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-[20px] bg-paper p-0 pb-[env(safe-area-inset-bottom)] text-ink backdrop:bg-black/30 md:inset-x-auto md:bottom-3 md:left-3 md:w-[280px] md:rounded-2xl md:shadow-[0_12px_40px_-12px_rgb(0_0_0/0.3)] md:backdrop:bg-black/10"
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line md:hidden" aria-hidden="true" />
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <h2 id={`${id}-title`} className="section-title">
          {title}
        </h2>
        <button type="button" onClick={() => open.current?.close()} className="grid size-11 place-items-center rounded-full text-ink-2" aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </dialog>
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
