import type { Metadata } from "next";
import { Notice, PageHeader } from "@/components/app-ui";
import { maskEin } from "@/lib/profile-fields";
import { realDocsEnabled } from "@/lib/server/flags";
import { loadProfile } from "@/lib/server/profile";
import { requireWorkspace } from "@/lib/server/session";
import { EinPanel, FactsForm } from "./forms";

export const metadata: Metadata = { title: "Business facts" };

export default async function FactsPage() {
  const ctx = await requireWorkspace();
  const profile = await loadProfile(ctx);
  const readOnly = ctx.demo || !realDocsEnabled() || ctx.role === "member";
  const confirmed = Object.values(profile.confirmed).sort().at(-1);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow="Memory" title="Business facts" />
      <p className="text-ink-2">
        Confirm these once. ShipShape fills them into your forms, shows where each value came from, and asks “still true?” when a
        fact is more than a year old.
        {confirmed ? (
          <> Last confirmed {new Date(confirmed).toLocaleDateString("en-US", { dateStyle: "medium" })}.</>
        ) : (
          !readOnly && <> Nothing is confirmed yet: fill in what you know, then choose Save and confirm. Your W-9 and NDA fill from these.</>
        )}
      </p>
      {ctx.demo && <Notice>These are the sample business&apos;s facts. Sample workspaces can&apos;t be edited, so nobody types real details here.</Notice>}
      {!ctx.demo && readOnly && ctx.role !== "member" && <Notice>Editing real business facts opens after our security review.</Notice>}
      {!ctx.demo && ctx.role === "member" && <Notice tone="info">Only owners and admins of this workspace can change its business facts.</Notice>}
      <section className="card">
        <FactsForm values={profile.values} readOnly={readOnly} />
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Employer identification number (EIN)</h2>
        <EinPanel masked={maskEin(profile.einLast4)} readOnly={readOnly} />
      </section>
      <p className="text-xs text-ink-3">
        We don&apos;t keep social security numbers in your business facts. If a form needs one, you type it for that form, and it
        is saved only inside that document&apos;s PDF.
      </p>
    </div>
  );
}
