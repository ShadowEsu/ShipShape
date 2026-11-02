import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Notice, PageHeader } from "@/components/app-ui";
import { FocusButton } from "@/components/focus-button";
import { listArchivedVendors, listVendors } from "@/lib/server/collect";
import { DOC_KINDS } from "@/lib/server/documents";
import { collectOpen, uiV2 } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { CollectChip } from "./chip";
import { NewVendorForm } from "./forms";
import { SUMMARY, summaryCounts } from "./summary";
import { CollectV2 } from "./v2";

export const metadata: Metadata = { title: "Collect" };

export default async function CollectPage() {
  const ctx = await requireWorkspace();

  if (!collectOpen(ctx)) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Collect" title="Paperwork from your vendors" />
        <Notice tone="info">
          Collect is in preview and isn&apos;t open for real workspaces yet. You can try it in the sample workspace: sign out, then
          choose &ldquo;Try the sample workspace&rdquo;.
        </Notice>
      </div>
    );
  }

  const [vendors, archived] = await Promise.all([listVendors(ctx), listArchivedVendors(ctx)]);
  const kinds = Object.entries(DOC_KINDS).map(([key, label]) => ({ key, label }));
  if (uiV2()) return <CollectV2 vendors={vendors} archived={archived} kinds={kinds} demo={ctx.demo} />;
  const counts = summaryCounts(vendors);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Collect" title="Paperwork from your vendors" />
      <p className="max-w-2xl text-ink-2">
        List who works for you and what you need from each of them. Send each one an upload link; their W-9s and insurance certificates
        land here, kept apart from your own documents, and you see who is missing something or about to lapse.
      </p>
      {ctx.demo && (
        <Notice tone="info">
          Sample workspace: these vendors are made up, and upload links here send made-up sample files instead of taking real ones.
        </Notice>
      )}

      {vendors.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {SUMMARY.map((s) => (
            <div key={s.state} className="card py-4">
              <dt className="text-sm text-ink-2">{s.title}</dt>
              <dd className="mt-1 flex items-center gap-2">
                <span className="font-serif text-3xl font-semibold tabular-nums">{counts[s.state]}</span>
                <CollectChip state={s.state} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-3" aria-labelledby="vendors-heading">
          <h2 id="vendors-heading" className="font-semibold">
            Vendors
          </h2>
          {vendors.length === 0 ? (
            <EmptyState
              title={archived.length > 0 ? "No active vendors" : "No vendors yet"}
              body="Each vendor you add shows here with what you asked them for and where it stands."
              example={["Ace Electric · W-9 ✓ · Insurance missing"]}
            >
              {/* The form is beside this list (below it on a phone), with the page's one primary button: this one takes you to its first field. */}
              <FocusButton target="vendor-name" className="btn-ghost">
                {archived.length > 0 ? "Add a vendor" : "Add your first vendor"}
              </FocusButton>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {vendors.map((v) => (
                <li key={v.id}>
                  <Link href={`/app/collect/${v.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-canvas">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium">{v.name}</span>
                      <span className="shrink-0 text-xs text-ink-3">
                        {v.openLinks} open {v.openLinks === 1 ? "link" : "links"}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {v.items.map((i) => (
                        <CollectChip key={i.kind} state={i.state} label={i.label} />
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {archived.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-2">Archived vendors ({archived.length})</summary>
              <ul className="mt-2 space-y-1">
                {archived.map((v) => (
                  <li key={v.id}>
                    <Link href={`/app/collect/${v.id}`} className="underline">
                      {v.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card h-fit">
          <h2 className="mb-4 font-semibold">Add a vendor</h2>
          <NewVendorForm kinds={kinds} />
        </section>
      </div>
    </div>
  );
}
