import type { Metadata } from "next";
import { EmptyState, PageHeader, Pager } from "@/components/app-ui";
import { pageParam } from "@/lib/paging";
import { uiV2 } from "@/lib/server/flags";
import { pageSaved, SAVED_PAGE_SIZE } from "@/lib/server/saved";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { SavedList } from "./list";

export const metadata: Metadata = { title: "Saved" };

/** The documents and passport links this person saved (only theirs: saves are personal), newest first; `?page=` pages them. */
export default async function SavedPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireWorkspace();
  const zone = await viewerZone();
  const saved = await pageSaved(ctx, pageParam((await searchParams).page));
  const v2 = uiV2();
  return (
    <div className={v2 ? "mx-auto max-w-[720px] space-y-6" : "max-w-3xl space-y-6"}>
      <div className="space-y-2">
        <PageHeader eyebrow="Saved" title="Saved" />
        <p className="text-ink-2">Documents and links you saved.</p>
      </div>
      {saved.total === 0 ? (
        <EmptyState icon="bookmark" title="Nothing saved yet" body="Save a document or link from its page to keep it here." action={{ href: "/app/documents", label: "Go to Documents" }} />
      ) : (
        <SavedList rows={saved.rows} zone={zone} v2={v2} />
      )}
      <Pager
        page={saved.page}
        pages={saved.pages}
        size={SAVED_PAGE_SIZE}
        shown={saved.rows.length}
        total={saved.total}
        href={(n) => (n > 1 ? `/app/saved?page=${n}` : "/app/saved")}
      />
    </div>
  );
}
