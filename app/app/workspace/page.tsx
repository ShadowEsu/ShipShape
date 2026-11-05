import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { initialsOf, NAV_GROUPS } from "@/components/app-sections";
import { lapsedCount } from "@/lib/server/documents";
import { contactEmail, uiV2 } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { signOut } from "../../signin/actions";
import { HairRow } from "../hair-row";
import { ROLE } from "../settings/shared";

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await requireWorkspace();
  return { title: ctx.name };
}

/**
 * What the phone's account button opens (Design, 4 Nov 22:4x): a plain list titled with the business's name. Every
 * page, grouped as the desktop sidebar (app/app/shell-v2.tsx) in 52px rows, then Help and Feedback (the top bar's on
 * desktop), then the account and Settings at the end. It replaces the phone's menu; the tab bar has the five pages
 * used most. Only in the redesigned app.
 */
export default async function WorkspacePage() {
  if (!uiV2()) notFound();
  const ctx = await requireWorkspace();
  const lapsed = await lapsedCount(ctx);
  const contact = contactEmail();
  // The sidebar's last group (Settings) goes with the account at the end.
  const settings = NAV_GROUPS.at(-1);
  const groups = NAV_GROUPS.slice(0, -1);
  return (
    <div className="mx-auto max-w-[720px] space-y-8">
      <h1 className="page-title">{ctx.name}</h1>
      {groups.map((g, n) => {
        const id = `workspace-group-${n}`;
        return (
          <section key={id} aria-labelledby={g.label ? id : undefined} className="space-y-1">
            {g.label && (
              <h2 id={id} className="text-[13px] leading-[1.4] font-medium text-ink-2">
                {g.label}
              </h2>
            )}
            <ul className="hair-list">
              {g.items.map(([href, label, icon]) => (
                <HairRow key={href} href={href} icon={icon} title={label} line={href === "/app/deadlines" && lapsed > 0 ? `${lapsed} lapsed` : undefined} />
              ))}
            </ul>
          </section>
        );
      })}
      <ul className="hair-list">
        <HairRow href="/faq" icon="open" title="Help" />
        {contact && <HairRow href={`mailto:${contact}?subject=${encodeURIComponent("ShipShape feedback")}`} icon="send" title="Feedback" />}
      </ul>
      <section aria-labelledby="workspace-account" className="space-y-1">
        <h2 id="workspace-account" className="text-[13px] leading-[1.4] font-medium text-ink-2">
          Account
        </h2>
        <ul className="hair-list">
          <li className="flex min-h-13 items-center gap-3 px-3 py-2">
            <span className="account-tile" aria-hidden="true">
              {initialsOf(ctx.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-ink">{ctx.name}</span>
              <span className="block text-[13px] text-ink-2">{ROLE[ctx.role]}</span>
            </span>
          </li>
          {settings?.items.map(([href, label, icon]) => (
            <HairRow key={href} href={href} icon={icon} title={label} />
          ))}
        </ul>
        <form action={signOut} className="pt-4">
          <button className="btn-ghost w-full">Sign out</button>
        </form>
      </section>
    </div>
  );
}
