import type { Metadata } from "next";
import { Logo, NotLegalAdvice } from "@/components/ui";
import { requireWorkspace } from "@/lib/server/session";
import { signOut } from "../signin/actions";
import { NavLinks } from "./nav";

export const metadata: Metadata = { robots: { index: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();
  return (
    <div className="min-h-dvh bg-canvas md:flex">
      <aside className="border-b border-line bg-paper px-4 py-4 md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between md:block">
          <Logo href="/app" />
          <p className="truncate text-xs text-ink-3 md:mt-3" title={ws.name}>
            {ws.name}
          </p>
        </div>
        <NavLinks />
        <form action={signOut} className="mt-auto hidden md:block">
          <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-canvas">Sign out</button>
        </form>
      </aside>
      <div className="min-w-0 flex-1">
        {ws.demo && (
          <p className="border-b border-line bg-warn-soft px-4 py-2 text-center text-xs text-warn">
            Sample workspace: every business, person and number here is made up. Uploading real documents is off until our
            security review is done.
          </p>
        )}
        <main id="main" className="mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-8 md:py-10">
          {children}
          <NotLegalAdvice className="pt-6" />
        </main>
      </div>
    </div>
  );
}
