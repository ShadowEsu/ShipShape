import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, fmtDay } from "@/components/app-ui";
import { COLLECT_DAYS, getVendor, type VendorLink } from "@/lib/server/collect";
import { collectOpen } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { archiveVendor, turnOffVendorLink } from "../actions";
import { CollectChip } from "../chip";
import { DeleteVendorFileForm, VendorLinkForm } from "../forms";

export const metadata: Metadata = { title: "Vendor" };

function linkStatus(l: VendorLink) {
  if (l.revoked_at) return "Turned off";
  if (new Date(l.expires_at).getTime() < Date.now()) return "Expired";
  return "Working";
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** What went wrong in a form posted from this page (see backToVendor in ../actions.ts). */
const ERRORS: Record<string, string> = {
  off: "This link was already turned off.",
};

export default async function VendorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireWorkspace();
  if (!collectOpen(ctx)) notFound();
  const { id } = await params;
  const { error } = await searchParams;
  const formError = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;
  const detail = await getVendor(ctx, id);
  if (!detail) notFound();
  const { vendor, files, links } = detail;
  const archived = vendor.status === "archived";

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Collect" title={vendor.name}>
        <form action={archiveVendor}>
          <input type="hidden" name="id" value={vendor.id} />
          <input type="hidden" name="archive" value={archived ? "0" : "1"} />
          <button className="btn-ghost">{archived ? "Restore" : "Archive"}</button>
        </form>
      </PageHeader>
      <p className="text-sm">
        <Link href="/app/collect" className="inline-flex min-h-6 items-center text-ink-2 underline">
          ← All vendors
        </Link>
        {vendor.email && <span className="ml-3 text-ink-3">{vendor.email}</span>}
      </p>
      {formError && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {formError}
        </p>
      )}
      {archived && <Notice tone="info">This vendor is archived: its upload links don&apos;t work, and it isn&apos;t counted on the Collect page.</Notice>}

      <section className="space-y-3" aria-labelledby="asked-heading">
        <h2 id="asked-heading" className="font-semibold">
          What you asked for
        </h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {vendor.items.map((i) => (
            <li key={i.kind} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">{i.label}</span>
              <span className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
                {i.receivedAt && <span>Received {fmtDay(i.receivedAt)}</span>}
                <CollectChip state={i.state} expiresOn={i.expiresOn} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="space-y-3" aria-labelledby="files-heading">
          <h2 id="files-heading" className="font-semibold">
            Files received
          </h2>
          {files.length === 0 ? (
            <EmptyState title="Nothing received yet" body="Files arrive here when the vendor uses an upload link." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <span className="min-w-0 flex-1 basis-64">
                    <span className="block font-mono text-xs tracking-wide text-ink-3 uppercase">{f.label}</span>
                    <span className="block truncate font-medium">{f.filename}</span>
                    <span className="block text-sm text-ink-2">
                      {fmtDay(f.received_at)} · {size(f.size_bytes)}
                      {f.expires_on && ` · valid through ${fmtDay(f.expires_on)}`}
                      {f.sample && " · sample"}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <a href={`/app/collect/file/${f.id}`} className="btn-ghost">
                      Download
                    </a>
                    {ctx.role !== "member" && <DeleteVendorFileForm fileId={f.id} filename={f.filename} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-6">
          {!archived && (
            <div className="card">
              <h2 className="mb-4 font-semibold">Ask for the files</h2>
              <VendorLinkForm vendorId={vendor.id} vendorName={vendor.name} days={COLLECT_DAYS} />
            </div>
          )}
          <div className="space-y-3">
            <h2 className="font-semibold">Upload links</h2>
            {links.length === 0 ? (
              <p className="text-sm text-ink-3">No links yet.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper text-sm">
                {links.map((l) => {
                  const status = linkStatus(l);
                  return (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="font-medium">{status}</span>
                        <span className="block text-ink-2">
                          Made {fmtDay(l.created_at)} · until {fmtDay(l.expires_at)}
                        </span>
                      </span>
                      {status === "Working" && (
                        <form action={turnOffVendorLink} className="shrink-0">
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="vendor" value={vendor.id} />
                          <button className="btn-ghost whitespace-nowrap">Turn off</button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
