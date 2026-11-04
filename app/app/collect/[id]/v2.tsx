import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { SubmitButton } from "@/components/submit-button";
import type { VendorDetail, VendorLink } from "@/lib/server/collect";
import { COLLECT_DAYS } from "@/lib/server/collect";
import { dayOf, fmtDay } from "@/lib/today";
import { archiveVendor, turnOffVendorLink } from "../actions";
import { CollectChip } from "../chip";
import { DeleteVendorFileForm, VendorLinkForm } from "../forms";
import { linkStatus, size } from "./shared";

/** An empty section's well: what lands here, and when. */
function Well({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line px-4 py-4">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-ink-2">{body}</p>
    </div>
  );
}

/**
 * A vendor in the redesigned app (Design spec 2026-11-02 §4, PR 7 plan): the 720 column, what was asked for, the files
 * received and the upload links as grouped lists, Ask for the files in between. Same data, words and actions as the
 * current page.
 */
export function VendorV2({
  detail,
  zone,
  formError,
  working,
  member,
}: {
  detail: VendorDetail;
  zone: string;
  formError: string | undefined;
  working: VendorLink | undefined;
  member: boolean;
}) {
  const { vendor, files, links } = detail;
  const archived = vendor.status === "archived";
  return (
    <div className="mx-auto max-w-[720px] space-y-8">
      <div className="space-y-3">
        <nav aria-label="Back" className="text-sm">
          <Link href="/app/collect" className="-my-2.5 inline-flex min-h-11 items-center text-ink-2 hover:text-ink">
            <span aria-hidden="true">←</span>&nbsp;All vendors
          </Link>
        </nav>
        <PageHeader eyebrow="Collect" title={vendor.name}>
          <form action={archiveVendor}>
            <input type="hidden" name="id" value={vendor.id} />
            <input type="hidden" name="archive" value={archived ? "0" : "1"} />
            <SubmitButton className="btn-ghost press" pendingLabel={archived ? "Restoring…" : "Archiving…"}>
              {archived ? "Restore" : "Archive"}
            </SubmitButton>
          </form>
        </PageHeader>
        {vendor.email && <p className="text-sm text-ink-3">{vendor.email}</p>}
      </div>
      {formError && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {formError}
        </p>
      )}
      {archived && (
        <Notice tone="info">
          This vendor is archived: its upload links are off, and it isn&apos;t counted on the Collect page. Restoring it turns its unexpired
          links back on.
        </Notice>
      )}

      <section className="space-y-3" aria-labelledby="asked-heading">
        <h2 id="asked-heading" className="section-title">
          What you asked for
        </h2>
        <ul className="group-list plain">
          {vendor.items.map((i) => (
            <li key={i.kind} className="group-row flex-wrap gap-y-1.5">
              {/* flex-auto: as wide as its words, so the date and chip wrap under it when both don't fit (390), never over it. */}
              <span className="min-w-0 flex-auto font-medium">{i.label}</span>
              <span className="flex flex-wrap items-center gap-3 text-[13px] text-ink-3">
                {i.receivedAt && <span>Received {dayOf(i.receivedAt, zone)}</span>}
                <CollectChip state={i.state} expiresOn={i.expiresOn} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="files-heading">
        <h2 id="files-heading" className="section-title">
          Files received
        </h2>
        {files.length === 0 ? (
          archived ? (
            <Well title="Nothing received" body={`Files ${vendor.name} sends through an upload link land here. Restore this vendor to ask for them.`} />
          ) : working ? (
            <Well
              title={`Waiting for ${vendor.name}`}
              body={`Your upload link works until ${dayOf(working.expires_at, zone)}. Their files land here as soon as they send them; there's nothing for you to do until then.`}
            />
          ) : (
            <Well
              title="Nothing received yet"
              body={`Make an upload link under Ask for the files and send it to ${vendor.name}. The files they send land here, each with the day it arrived.`}
            />
          )
        ) : (
          <ul className="group-list plain">
            {files.map((f) => (
              <li key={f.id} className="group-row flex-wrap gap-y-2">
                <span className="min-w-0 flex-1 basis-64">
                  <span className="block text-[13px] text-ink-3">{f.label}</span>
                  <span className="block truncate font-medium">{f.filename}</span>
                  <span className="block text-[13px] text-ink-3">
                    {dayOf(f.received_at, zone)} · {size(f.size_bytes)}
                    {f.expires_on && ` · valid through ${fmtDay(f.expires_on)}`}
                    {f.sample && " · sample"}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <a href={`/app/collect/file/${f.id}`} aria-label={`Download ${f.filename}`} className="btn-ghost press">
                    Download
                  </a>
                  {!member && <DeleteVendorFileForm fileId={f.id} filename={f.filename} v2 />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!archived && (
        <section className="space-y-3" aria-labelledby="ask-heading">
          <h2 id="ask-heading" className="section-title">
            Ask for the files
          </h2>
          <VendorLinkForm vendorId={vendor.id} vendorName={vendor.name} days={COLLECT_DAYS} v2 />
        </section>
      )}

      <section className="space-y-3" aria-labelledby="links-heading">
        <h2 id="links-heading" className="section-title">
          Upload links
        </h2>
        {links.length === 0 ? (
          <p className="text-sm text-ink-3">Links you make show here with the day they stop working.</p>
        ) : (
          <ul className="group-list plain">
            {links.map((l) => {
              const status = linkStatus(l, archived);
              return (
                <li key={l.id} className="group-row justify-between">
                  <span className="min-w-0">
                    <span className="block font-medium">{status}</span>
                    <span className="block text-[13px] text-ink-3">
                      Made {dayOf(l.created_at, zone)} · until {dayOf(l.expires_at, zone)}
                    </span>
                  </span>
                  {status === "Working" && (
                    <form action={turnOffVendorLink} className="shrink-0">
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="vendor" value={vendor.id} />
                      <SubmitButton className="btn-ghost press whitespace-nowrap" pendingLabel="Turning off…">
                        Turn off
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
