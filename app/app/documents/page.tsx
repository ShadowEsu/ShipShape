import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, ValidityChip } from "@/components/app-ui";
import { DOC_KINDS, listDocuments } from "@/lib/server/documents";
import { requireWorkspace } from "@/lib/server/session";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; archived?: string }> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const docs = await listDocuments(ctx, { q: sp.q, kind: sp.kind, archived });
  const filtered = Boolean(sp.q || sp.kind);
  // An empty list with nothing filtered: nothing to search, and each empty state has its own one action.
  const empty = docs.length === 0 && !filtered;
  // The way to archived documents only shows once there are some.
  const hasArchived = archived || !empty || (await listDocuments(ctx, { archived: true })).length > 0;
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
            body="Your W-9, insurance certificates, licenses and agreements will be listed here, each with its expiry date, so you can see what's current at a glance."
            example="For example: Insurance certificate · General liability 2026 · Expires soon · Mar 1, 2027"
            action={ctx.demo ? { href: "/app/make", label: "Make a document" } : { href: "/app/documents/new", label: "Add a document" }}
          />
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
