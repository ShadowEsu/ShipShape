import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, fmtDay } from "@/components/app-ui";
import { SubmitButton } from "@/components/submit-button";
import { COLLECT_DAYS, getVendor, type VendorLink } from "@/lib/server/collect";
import { collectOpen } from "@/lib/server/flags";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { dayOf } from "@/lib/today";
import { archiveVendor, turnOffVendorLink } from "../actions";
import { CollectChip } from "../chip";
import { DeleteVendorFileForm, VendorLinkForm } from "../forms";

export const metadata: Metadata = { title: "Vendor" };

function linkStatus(l: VendorLink) {
  if (l.revoked_at) return "Turned off";
  if (new Date(l.expires_at).getTime() < Date.now()) return "Expired";
  return "Working";
}

// A non-breaking space keeps "1 KB" on one line at 390 wide (Design).
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}\u00A0KB` : `${(bytes / 1024 / 1024).toFixed(1)}\u00A0MB`);

/** What went wrong in a form posted from this page (see backToVendor in ../actions.ts). */
const ERRORS: Record<string, string> = {
  off: "This link was already off, so nobody can use it. There's nothing more to do.",
};

export default async function VendorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireWorkspace();
  // Link ends and arrival times are instants: shown as the day where the owner is.
  const zone = await viewerZone();
  if (!collectOpen(ctx)) notFound();
  const { id } = await params;
  const { error } = await searchParams;
  const formError = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;
  const detail = await getVendor(ctx, id);
  if (!detail) notFound();
  const { vendor, files, links } = detail;
  const archived = vendor.status === "archived";
  // The working link that lasts longest: what the vendor has in hand right now.
  const working = links.filter((l) => linkStatus(l) === "Working").sort((a, b) => b.expires_at.localeCompare(a.expires_at)).at(0);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Collect" title={vendor.name}>
        <form action={archiveVendor}>
          <input type="hidden" name="id" value={vendor.id} />
          <input type="hidden" name="archive" value={archived ? "0" : "1"} />
          <SubmitButton className="btn-ghost" pendingLabel={archived ? "Restoring…" : "Archiving…"}>
            {archived ? "Restore" : "Archive"}
          </SubmitButton>
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
      {archived && (
        <Notice tone="info">
          This vendor is archived: its upload links don&apos;t work, and it isn&apos;t counted on the Collect page. Restore it to ask for files
          again.
        </Notice>
      )}

      <section className="space-y-3" aria-labelledby="asked-heading">
        <h2 id="asked-heading" className="font-semibold">
          What you asked for
        </h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {vendor.items.map((i) => (
            <li key={i.kind} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">{i.label}</span>
              <span className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
                {i.receivedAt && <span>Received {dayOf(i.receivedAt, zone)}</span>}
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
            archived ? (
              <EmptyState title="Nothing received" body={`Files ${vendor.name} sends through an upload link land here. Restore this vendor to ask for them.`} />
            ) : working ? (
              <EmptyState
                title={`Waiting for ${vendor.name}`}
                body={`Your upload link works until ${dayOf(working.expires_at, zone)}. Their files land here as soon as they send them; there's nothing for you to do until then.`}
              />
            ) : (
              <EmptyState
                title="Nothing received yet"
                body={`Make an upload link under Ask for the files and send it to ${vendor.name}. The files they send land here, each with the day it arrived.`}
              />
            )
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <span className="min-w-0 flex-1 basis-64">
                    <span className="block font-mono text-xs tracking-wide text-ink-3 uppercase">{f.label}</span>
                    <span className="block truncate font-medium">{f.filename}</span>
                    <span className="block text-sm text-ink-2">
                      {dayOf(f.received_at, zone)} · {size(f.size_bytes)}
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
              <p className="text-sm text-ink-3">Links you make show here with the day they stop working.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper text-sm">
                {links.map((l) => {
                  const status = linkStatus(l);
                  return (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="font-medium">{status}</span>
                        <span className="block text-ink-2">
                          Made {dayOf(l.created_at, zone)} · until {dayOf(l.expires_at, zone)}
                        </span>
                      </span>
                      {status === "Working" && (
                        <form action={turnOffVendorLink} className="shrink-0">
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="vendor" value={vendor.id} />
                          <SubmitButton className="btn-ghost whitespace-nowrap" pendingLabel="Turning off…">
                            Turn off
                          </SubmitButton>
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
