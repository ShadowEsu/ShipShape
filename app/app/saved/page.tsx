import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/app-ui";
import { uiV2 } from "@/lib/server/flags";
import { listSaved } from "@/lib/server/saved";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { SavedList } from "./list";

export const metadata: Metadata = { title: "Saved" };

/** The documents and passport links this person saved (only theirs: saves are personal), newest first. */
export default async function SavedPage() {
  const ctx = await requireWorkspace();
  const zone = await viewerZone();
  const rows = await listSaved(ctx);
  const v2 = uiV2();
  return (
    <div className={v2 ? "mx-auto max-w-[720px] space-y-6" : "max-w-3xl space-y-6"}>
      <div className="space-y-2">
        <PageHeader eyebrow="Saved" title="Saved" />
        <p className="text-ink-2">Documents and links you saved.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing saved yet" body="Save a document or link from its page to keep it here." action={{ href: "/app/documents", label: "Go to Documents" }} />
      ) : (
        <SavedList rows={rows} zone={zone} v2={v2} />
      )}
    </div>
  );
}
