import Link from "next/link";
import { GlassPane, GlassProvider } from "@/components/glass";
import { Logo } from "@/components/ui";
import { lapsedCount } from "@/lib/server/documents";
import { contactEmail, glassLevel, glassTabBar } from "@/lib/server/flags";
import type { Ctx } from "@/lib/server/profile";
import { appTools } from "@/lib/server/tools";
import { signOut } from "../signin/actions";
import { PulseOnView } from "./motion-v2";
import { AccountSheet, PhoneTabBar, SideNav, TopBar } from "./nav-v2";

/**
 * The app's frame (Design calm v2, look A): a white page with hairlines. On desktop a flat 236px sidebar (grouped rows,
 * the workspace row at its foot) and a slim top bar (the page's name, search, Help and Feedback); on the phone the top
 * bar alone, with the menu and search. The shell itself never animates.
 *
 * Glass (SHIPSHAPE_GLASS, Design glass spec 4 Nov): subtle glazes the floating layer (top bar, sheets, menus) and uses
 * Glisse's controls; full adds the sidebar and lists over two soft washes fixed behind the page, and optionally
 * Glisse's tab bar on the phone. Off renders the shell exactly as before.
 */
export async function ShellV2({ ws, deleting, children }: { ws: Ctx; deleting: boolean; children: React.ReactNode }) {
  const lapsed = (await lapsedCount(ws)) > 0;
  const tools = appTools(ws).map(({ name, href, icon, tag, closed }) => ({ name, href, icon, tag: closed ? tag : null }));
  const glass = glassLevel();
  const tabBar = glassTabBar();
  const signOutForm = (
    <form action={signOut}>
      <button className="btn-ghost w-full">Sign out</button>
    </form>
  );
  return (
    <GlassProvider level={glass}>
      <div className="ui-v2 min-h-dvh bg-paper md:flex" data-glass={glass === "off" ? undefined : glass} data-tab-bar={tabBar ? "" : undefined}>
        {glass === "full" && (
          <div aria-hidden="true" className="glass-wash">
            <span />
            <span />
          </div>
        )}
        <aside aria-label="Workspace" className="side hidden md:sticky md:top-0 md:flex md:h-dvh md:w-[236px] md:shrink-0 md:flex-col">
          <GlassPane from="full" />
          <div className="px-2 pt-1 pb-3.5">
            <Logo href="/app" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SideNav lapsed={lapsed} />
          </div>
          <div className="pt-3">
            <AccountSheet id="account-sheet-side" workspace={ws.name} role={ws.role}>
              {signOutForm}
            </AccountSheet>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* The notices sit over the page's column, so the sidebar keeps the full height and its workspace row stays on screen. */}
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
                <p className="sample-strip">
                  Sample workspace: everything here is made up, and it never takes real files. Don&apos;t type real tax numbers or personal
                  details here.
                </p>
              )}
            </section>
          )}
          <TopBar
            tools={tools}
            contact={contactEmail()}
            lapsed={lapsed}
            account={
              <AccountSheet id="account-sheet-menu" workspace={ws.name} role={ws.role}>
                {signOutForm}
              </AccountSheet>
            }
          />
          <main id="main" className="mx-auto max-w-[1040px] space-y-6 px-4 pt-6 pb-16 md:px-10 md:pt-10">
            {children}
          </main>
        </div>
        {tabBar && <PhoneTabBar />}
        <PulseOnView />
      </div>
    </GlassProvider>
  );
}
