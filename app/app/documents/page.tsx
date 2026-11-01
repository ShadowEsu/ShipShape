import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, ValidityChip } from "@/components/app-ui";
import { DOC_KINDS, DOCUMENTS_PAGE_SIZE, pageDocuments } from "@/lib/server/documents";
import { realDocsEnabled } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";

export const metadata: Metadata = { title: "Documents" };

/** The list's address for another page, keeping the search, kind and archived filter as typed. */
function pageHref(sp: { q?: string; kind?: string; archived?: string }, page: number): string {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.kind) params.set("kind", sp.kind);
  if (sp.archived === "1") params.set("archived", "1");
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/app/documents?${query}` : "/app/documents";
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; archived?: string; page?: string }> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const archived = sp.archived === "1";
  // A page number that isn't one reads as 1; pageDocuments clamps to the pages there are.
  const wanted = /^\d{1,6}$/.test(sp.page ?? "") ? Number(sp.page) : 1;
  const { rows: docs, total, page, pages } = await pageDocuments(ctx, { q: sp.q, kind: sp.kind, archived, page: wanted });
  const filtered = Boolean(sp.q || sp.kind);
  // An empty list with nothing filtered: nothing to search, and each empty state has its own one action.
  const empty = docs.length === 0 && !filtered;
  // The way to archived documents only shows once there are some.
  const hasArchived = archived || !empty || (await pageDocuments(ctx, { archived: true })).total > 0;
  const kindLabel = Object.entries(DOC_KINDS).find(([k]) => k === sp.kind)?.[1] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Documents" title={archived ? "Archived documents" : "Documents"}>
        {docs.length > 0 && (
          <>
            <Link href="/app/make" className="btn-ghost">
              Make a document
            </Link>
            <Link href="/app/documents/new" className="btn">
              Add a document
            </Link>
          </>
        )}
      </PageHeader>

      {!empty && (
        <form className="flex flex-col gap-2 sm:flex-row" role="search">
          <label htmlFor="q" className="sr-only">
            Search documents
          </label>
          <input id="q" name="q" defaultValue={sp.q} placeholder="Search by title, issuer or other party" className="input flex-1" />
          <label htmlFor="kind" className="sr-only">
            Kind
          </label>
          <select id="kind" name="kind" defaultValue={sp.kind ?? ""} className="input sm:w-48">
            <option value="">All kinds</option>
            {Object.entries(DOC_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          {archived && <input type="hidden" name="archived" value="1" />}
          <button className="btn-ghost">Search</button>
        </form>
      )}

      {docs.length === 0 ? (
        filtered ? (
          <EmptyState
            title={sp.q ? `No ${archived ? "archived " : ""}documents match “${sp.q}”` : `No ${archived ? "archived " : ""}documents of this kind`}
            body={
              sp.q
                ? `Search looks at titles, issuers and other parties${kindLabel ? `, among ${kindLabel} documents only` : ""}. Try a shorter word, or clear the search to see everything.`
                : `None of your ${archived ? "archived " : ""}documents are filed as ${kindLabel ?? "this kind"}. Clear the filter to see everything.`
            }
            action={{ href: archived ? "/app/documents?archived=1" : "/app/documents", label: sp.q ? "Clear the search" : "Clear the filter" }}
          />
        ) : archived ? (
          <EmptyState
            title="No archived documents"
            body="Documents you archive will be listed here, with every version and their history. You can restore one at any time."
            action={{ href: "/app/documents", label: "Go to current documents" }}
          />
        ) : (
          <EmptyState
            title={hasArchived ? "No current documents" : "No documents yet"}
            body="Your W-9, insurance certificate and licenses live here, with the date each one runs out and who you've shared it with."
            example={[
              "W-9 · Form W-9, signed Oct 2026 · No expiry date",
              "Insurance certificate · General liability 2026 · Expires soon · Mar 1, 2027",
              "License · Contractor license · Current · Aug 31, 2027",
            ]}
            action={{ href: "/app/make/irs-w9", label: "Fill your first W-9" }}
          >
            {/* Same gate as /app/documents/new: uploads are closed in the sample workspace and before the security review. */}
            {!ctx.demo && realDocsEnabled() && (
              <Link href="/app/documents/new" className="inline-flex min-h-6 items-center text-sm text-ink-2 underline">
                Upload a document
              </Link>
            )}
          </EmptyState>
        )
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={`/app/documents/${d.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:gap-4">
                <span className="w-36 shrink-0 font-mono text-xs tracking-wide text-ink-3 uppercase">{DOC_KINDS[d.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  {(d.issuer || d.counterparty) && <span className="block truncate text-sm text-ink-2">{d.issuer ?? d.counterparty}</span>}
                </span>
                <ValidityChip validity={d.validity} expiresOn={d.expires_on} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-ink-2">
            Showing {(page - 1) * DOCUMENTS_PAGE_SIZE + 1}–{(page - 1) * DOCUMENTS_PAGE_SIZE + docs.length} of {total}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(sp, page - 1)} className="btn-ghost" rel="prev">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={pageHref(sp, page + 1)} className="btn-ghost" rel="next">
                Next
              </Link>
            )}
          </div>
        </nav>
      )}

      {/* Archived-empty already offers the way back as its one action. */}
      {hasArchived && !(archived && empty) && (
        <p className="text-sm">
          <Link href={archived ? "/app/documents" : "/app/documents?archived=1"} className="inline-flex min-h-6 items-center text-ink-2 underline">
            {archived ? "Back to current documents" : "See archived documents"}
          </Link>
        </p>
      )}
    </div>
  );
}
