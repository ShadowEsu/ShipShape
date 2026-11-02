import Link from "next/link";
import { Icon } from "@/components/icons";
import { Logo, NotLegalAdvice } from "@/components/ui";
import { recentDocuments } from "@/lib/server/documents";
import type { Ctx } from "@/lib/server/profile";
import { signOut } from "../signin/actions";
import { AccountSheet, SideNav, TabBar } from "./nav-v2";

/**
 * Tile colour, the one choice left to Preston (Design spec 2026-11-02 §2): "mono" is option B, "One accent" (Design's
 * pick); "" is option A, "Tinted". One class on the shell swaps every tile.
 */
const TILE_STYLE: "mono" | "" = "mono";

/**
 * The redesigned app's frame (SHIPSHAPE_UI=v2): a 256px sidebar of tools with Recent and the account row on desktop;
 * on the phone a 48px top bar, the page, and a tab bar with More. The shell itself never animates.
 */
export async function ShellV2({ ws, deleting, children }: { ws: Ctx; deleting: boolean; children: React.ReactNode }) {
  const recent = await recentDocuments(ws);
  const signOutForm = (
    <form action={signOut}>
      <button className="btn-ghost w-full">Sign out</button>
    </form>
  );
  return (
    <div className={`ui-v2 ${TILE_STYLE} min-h-dvh bg-paper md:flex`}>
      <aside aria-label="Workspace" className="hidden border-r border-line bg-side px-3 py-5 md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col">
        <div className="px-3">
          <Logo href="/app" />
        </div>
        <SideNav />
        {recent.length > 0 && (
          <section aria-labelledby="recent-side" className="mt-8">
            <h2 id="recent-side" className="px-3 text-xs font-semibold text-ink-3">
              Recent
            </h2>
            <ul className="mt-1 space-y-0.5">
              {recent.map((d) => (
                <li key={d.id}>
                  <Link href={`/app/documents/${d.id}`} className="block truncate rounded-xl px-3 py-2 text-sm text-ink-2 transition-colors duration-[180ms] hover:bg-paper/70">
                    {d.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="mt-auto space-y-2 px-1">
          <Link href="/app/settings" className="flex min-h-11 items-center gap-3 rounded-xl px-2 transition-colors duration-[180ms] hover:bg-paper/70">
            <span className="text-ink-3">
              <Icon name="account" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink" title={ws.name}>
                {ws.name}
              </span>
              <span className="block text-xs text-ink-3">Settings</span>
            </span>
          </Link>
          {signOutForm}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-line bg-paper/85 pr-1 pl-4 backdrop-blur-xl md:hidden">
          <Logo href="/app" />
          <AccountSheet workspace={ws.name}>{signOutForm}</AccountSheet>
        </header>
        {(deleting || ws.demo) && (
          <section aria-label="Workspace notice">
            {deleting && (
              <p role="status" className="border-b border-line bg-bad-soft px-4 py-2 text-center text-xs text-bad">
                You asked to delete your account. ShipShape finishes that by itself within two days, and anything you add before then is
                deleted with it.{" "}
                <Link href="/app/settings#delete" className="underline">
                  Finish it now
                </Link>
              </p>
            )}
            {ws.demo && (
              <p className="border-b border-line bg-warn-soft px-4 py-2 text-center text-xs text-warn">
                Sample workspace: the business, people and documents are made up, and it never takes real files. Don&apos;t type real tax
                numbers or personal details here.
              </p>
            )}
          </section>
        )}
        <main id="main" className="mx-auto max-w-[1040px] space-y-6 px-4 pt-6 pb-32 md:px-10 md:pt-12 md:pb-12">
          {children}
          <NotLegalAdvice className="legal-line pt-6" />
        </main>
      </div>
      <TabBar />
    </div>
  );
}
