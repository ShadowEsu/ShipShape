import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Notice, PageHeader, ValidityChip } from "@/components/app-ui";
import { DOC_KINDS, DOC_SORTS, DOCUMENTS_PAGE_SIZE, docSort, pageDocuments } from "@/lib/server/documents";
import { esignAvailable } from "@/lib/server/esign";
import { realDocsEnabled, uiV2 } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { FilterMenu, TabLinks } from "../filters";
import { HairRow } from "../hair-row";
import { Arrive } from "../motion-moments";
import { DELETE_PROMISE } from "./messages";

export const metadata: Metadata = { title: "Documents" };

// `deleted`: Delete for good just finished (actions.ts deleteForGood); the list's own links drop it.
type ListParams = { q?: string; kind?: string; archived?: string; sort?: string; deleted?: string };

/** The list's address for another page, keeping the search, kind, archived filter and order as chosen. */
function pageHref(sp: ListParams, page: number): string {
  const params = new URLSearchParams();
  if (sp.q) params.set("q", sp.q);
  if (sp.kind) params.set("kind", sp.kind);
  if (sp.archived === "1") params.set("archived", "1");
  if (docSort(sp.sort) !== "expiry") params.set("sort", docSort(sp.sort));
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/app/documents?${query}` : "/app/documents";
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<ListParams & { page?: string }> }) {
  const ctx = await requireWorkspace();
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const sort = docSort(sp.sort);
  // A page number that isn't one reads as 1; pageDocuments clamps to the pages there are.
  const wanted = /^\d{1,6}$/.test(sp.page ?? "") ? Number(sp.page) : 1;
  const { rows: docs, total, page, pages } = await pageDocuments(ctx, { q: sp.q, kind: sp.kind, archived, page: wanted, sort });
  const filtered = Boolean(sp.q || sp.kind);
  // An empty list with nothing filtered: nothing to search, and each empty state has its own one action.
  const empty = docs.length === 0 && !filtered;
  // The way to archived documents only shows once there are some.
  const hasArchived = archived || !empty || (await pageDocuments(ctx, { archived: true })).total > 0;
  // The earlier look's archived-empty already offers the way back as its one action. The redesigned app keeps its tabs
  // there, Archived current, so the page says where you are (Design #26 S1).
  const toArchived = hasArchived && !(archived && empty);
  const kindLabel = Object.entries(DOC_KINDS).find(([k]) => k === sp.kind)?.[1] ?? null;
  const v2 = uiV2();
  const canUpload = !ctx.demo && realDocsEnabled();
  // A real workspace before real documents open can neither add nor make one, so the first-run action would lead to a
  // closed page; the redesigned app says so instead (the earlier look stays as it was).
  const closed = v2 && !ctx.demo && !realDocsEnabled();

  return (
    <div className="space-y-6">
      {/* The redesigned app says Archived in its tab, so the title stays the page's name. */}
      <PageHeader eyebrow="Documents" title={archived && !v2 ? "Archived documents" : "Documents"}>
        {docs.length > 0 &&
          (v2 && !canUpload ? (
            // Redesigned app: one filled primary that works here (Design 02 Nov); adding isn't open, so Make leads and Add waits.
            <Link href="/app/make" className="btn">
              Make a document
            </Link>
          ) : (
            <>
              <Link href="/app/make" className="btn-ghost">
                Make a document
              </Link>
              <Link href="/app/documents/new" className="btn">
                Add a document
              </Link>
            </>
          ))}
      </PageHeader>
      {/* Home's Sign opens this page; while signing is closed here, the page says why (the tool's dashed square says the same). */}
      {v2 && !esignAvailable(ctx) && <p className="text-[13px] text-ink-3">Signing by email opens once ShipShape can send email.</p>}

      {v2 ? (
        // Redesigned app (Design calm v2): tabs All / Archived, with the kind and the order as two quiet menus. Searching is
        // the top bar's (⌘K: "Search all documents for …" opens this page with ?q=), and a search here says what it holds.
        <>
          {sp.deleted === "1" && (
            <div role="status">
              <Notice tone="ok">{`Document deleted. ${DELETE_PROMISE}`}</Notice>
            </div>
          )}
          {sp.q && docs.length > 0 && (
            <p className="text-sm text-ink-2">
              {`Showing documents that match “${sp.q}”.`}{" "}
              <Link href={pageHref({ ...sp, q: undefined }, 1)} className="underline">
                Clear the search
              </Link>
            </p>
          )}
          {hasArchived && (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <TabLinks
                label="Current or archived"
                tabs={[
                  { href: pageHref({ ...sp, archived: undefined }, 1), text: "All", current: !archived },
                  { href: pageHref({ ...sp, archived: "1" }, 1), text: "Archived", current: archived },
                ]}
              />
              {!empty && (
                <div className="flex gap-2">
                  <FilterMenu
                    label="Kind"
                    options={[["", "All kinds"], ...Object.entries(DOC_KINDS)].map(([k, text]) => ({
                      href: pageHref({ ...sp, kind: k || undefined }, 1),
                      text,
                      current: (sp.kind ?? "") === k,
                    }))}
                  />
                  <FilterMenu label="Order" options={DOC_SORTS.map(([s, text]) => ({ href: pageHref({ ...sp, sort: s }, 1), text, current: s === sort }))} />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        !empty && (
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
        )
      )}

      {docs.length === 0 ? (
        filtered ? (
          <EmptyState
            icon="documents"
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
            icon="documents"
            title="No archived documents"
            body="Documents you archive will be listed here, with every version and their history. You can restore one at any time."
            action={{ href: "/app/documents", label: "Go to current documents" }}
          />
        ) : (
          <EmptyState
            icon="documents"
            title={hasArchived ? "No current documents" : "No documents yet"}
            body={
              closed
                ? "Your W-9, insurance certificate and licenses will live here, with the date each one runs out, every version, and its history."
                : "Your W-9, insurance certificate and licenses live here, with the date each one runs out, every version, and its history."
            }
            note={closed ? "Adding and making real documents opens after our security review." : undefined}
            example={[
              "W-9 · Form W-9, signed Oct 2026 · No expiry date",
              "Insurance certificate · General liability 2026 · Expires soon · Mar 1, 2027",
              "License · Contractor license · Current · Aug 31, 2027",
            ]}
            action={closed ? undefined : { href: "/app/make/irs-w9", label: "Fill your first W-9" }}
          >
            {/* Same gate as /app/documents/new: uploads are closed in the sample workspace and before the security review. */}
            {!ctx.demo && realDocsEnabled() && (
              <Link href="/app/documents/new" className="inline-flex min-h-6 items-center text-sm text-ink-2 underline">
                Upload a document
              </Link>
            )}
          </EmptyState>
        )
      ) : v2 ? (
        // Hairline rows, as Home's Recent (Design calm v2); the title morphs into the document page's title (spec §6.1).
        // The rows rise in on the list's first load in a visit, not on a search, filter or return (motion spec §2).
        <Arrive list="documents" className="hair-list">
          {docs.map((d) => (
            <HairRow
              key={d.id}
              href={`/app/documents/${d.id}`}
              icon="documents"
              title={d.title}
              morph={`doc-${d.id}`}
              line={d.issuer || d.counterparty ? `${DOC_KINDS[d.kind]} · ${d.issuer ?? d.counterparty}` : DOC_KINDS[d.kind]}
              chip={<ValidityChip validity={d.validity} expiresOn={d.expires_on} />}
            />
          ))}
        </Arrive>
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

      {/* The redesigned app has the Archived tab instead. */}
      {!v2 && toArchived && (
        <p className="text-sm">
          <Link href={archived ? "/app/documents" : "/app/documents?archived=1"} className="inline-flex min-h-6 items-center text-ink-2 underline">
            {archived ? "Back to current documents" : "See archived documents"}
          </Link>
        </p>
      )}
    </div>
  );
}
