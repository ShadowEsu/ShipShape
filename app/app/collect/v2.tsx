import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app-ui";
import { FocusButton } from "@/components/focus-button";
import { Icon } from "@/components/icons";
import type { VendorRow } from "@/lib/server/collect";
import { CollectChip } from "./chip";
import { NewVendorFormV2 } from "./forms";
import { SUMMARY, summaryCounts } from "./summary";

/**
 * Collect in the redesigned app (Design spec 2026-11-02 §4, PR 7 plan): one column. The four counts as quiet tiles,
 * the vendors as a grouped list with their chips, the archived ones behind a disclosure, then Add a vendor as field
 * rows. Same data, words and actions as the current page.
 */
export function CollectV2({ vendors, archived, kinds, demo }: { vendors: VendorRow[]; archived: VendorRow[]; kinds: { key: string; label: string }[]; demo: boolean }) {
  const counts = summaryCounts(vendors);
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <PageHeader eyebrow="Collect" title="Paperwork from your vendors" />
        <p className="max-w-2xl text-ink-2">
          List who works for you and what you need from each of them. Send each one an upload link; their W-9s and insurance certificates
          land here, kept apart from your own documents, and you see who is missing something or about to lapse.
        </p>
        {demo && (
          <p className="max-w-2xl rounded-2xl border border-line px-4 py-3 text-sm text-ink-2">
            Sample workspace: these vendors are made up, and upload links here send made-up sample files instead of taking real ones.
          </p>
        )}
      </div>

      {vendors.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {SUMMARY.map((s) => (
            <div key={s.state} className="tile gap-1">
              <dt className="text-[13px] text-ink-2">{s.title}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="text-[28px] leading-8 font-medium tabular-nums">{counts[s.state]}</span>
                <CollectChip state={s.state} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-labelledby="vendors-heading" className="space-y-3">
        <h2 id="vendors-heading" className="section-title">
          Vendors
        </h2>
        {vendors.length === 0 ? (
          <EmptyState
            icon="collect"
            title={archived.length > 0 ? "No active vendors" : "No vendors yet"}
            body="Each vendor you add shows here with what you asked them for and where it stands."
            example={["Ace Electric · W-9 ✓ · Insurance missing"]}
          >
            {/* The form is under this list, with the page's one primary button: this one takes you to its first field. */}
            <FocusButton target="vendor-name" className="btn-ghost press">
              {archived.length > 0 ? "Add a vendor" : "Add your first vendor"}
            </FocusButton>
          </EmptyState>
        ) : (
          <ul className="group-list plain stagger">
            {vendors.map((v, n) => (
              <li key={v.id} style={{ "--i": n }}>
                <Link href={`/app/collect/${v.id}`} className="group-row">
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 font-medium">{v.name}</span>
                      <span className="shrink-0 text-[13px] text-ink-3">
                        {v.openLinks} open {v.openLinks === 1 ? "link" : "links"}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {v.items.map((i) => (
                        <CollectChip key={i.kind} state={i.state} label={i.label} />
                      ))}
                    </span>
                  </span>
                  <span className="text-ink-3">
                    <Icon name="chevron" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm text-ink-2 underline [&::-webkit-details-marker]:hidden">
              Archived vendors ({archived.length})
              <span className="disclosure-chevron rotate-90 group-open:-rotate-90">
                <Icon name="chevron" size={16} />
              </span>
            </summary>
            <ul className="group-list plain mt-2">
              {archived.map((v) => (
                <li key={v.id}>
                  <Link href={`/app/collect/${v.id}`} className="group-row">
                    <span className="min-w-0 flex-1">{v.name}</span>
                    <span className="text-ink-3">
                      <Icon name="chevron" size={16} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="add-vendor-title" className="max-w-[720px] space-y-4">
        <h2 id="add-vendor-title" className="section-title">
          Add a vendor
        </h2>
        <NewVendorFormV2 kinds={kinds} />
      </section>
    </div>
  );
}
