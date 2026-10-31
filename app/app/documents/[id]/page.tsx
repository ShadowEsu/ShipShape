import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, ValidityChip, fmtDay } from "@/components/app-ui";
import { fmtDateTime } from "@/components/ui";
import { FACT_LABELS } from "@/lib/profile-fields";
import { DOC_KINDS, getDocument } from "@/lib/server/documents";
import { esignAvailable, listSignatureRequests, SIGN_DAYS, type SignatureRequestRow } from "@/lib/server/esign";
import { realDocsEnabled } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { templateById } from "@/lib/templates/catalog";
import { archive, withdrawSignature } from "../actions";
import { DetailsForm, SignRequestForm, VersionForm } from "../forms";

export const metadata: Metadata = { title: "Document" };

const ACTIONS: Record<string, string> = {
  "document.created": "Added to the vault",
  "document.version_added": "Version added",
  "document.updated": "Details changed",
  "document.archived": "Archived",
  "document.restored": "Restored",
  "document.acknowledged": "Reviewed and acknowledged",
  "document.viewed": "Opened",
  "document.downloaded": "Downloaded",
  "document.signed_version_added": "Signed copy added",
  "esign.requested": "Signature requested",
  "esign.opened": "Signer opened the link",
  "esign.code_sent": "Signing code sent",
  "esign.signed": "Signed",
  "esign.revoked": "Signature request withdrawn",
};

const REQUEST_STATUS: Record<SignatureRequestRow["status"], string> = {
  pending: "Waiting",
  signed: "Signed",
  declined: "Declined",
  revoked: "Withdrawn",
};

const SOURCE: Record<string, string> = {
  facts: "Business facts",
  facts_edited: "Business facts, edited",
  typed: "Typed",
  typed_not_saved: "Typed, not saved",
};

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace();
  const { id } = await params;
  const got = await getDocument(ctx, id);
  if (!got) notFound();
  const { doc, versions, audit } = got;
  const latest = versions[0];
  const template = doc.template_id ? templateById(doc.template_id) : undefined;
  const canUpload = !ctx.demo && realDocsEnabled();
  const requests = await listSignatureRequests(ctx, doc.id);
  const now = Date.now();

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link href="/app/documents" className="inline-flex min-h-6 items-center text-ink-2 hover:underline">
          ← Documents
        </Link>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-6">
          <article className="rounded-2xl border border-line bg-paper p-6 shadow-sm sm:p-8">
            <p className="eyebrow">{DOC_KINDS[doc.kind]}</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">{doc.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
              <ValidityChip validity={doc.validity} expiresOn={doc.expires_on} />
              {doc.issuer && <span>Issued by {doc.issuer}</span>}
              {doc.counterparty && <span>With {doc.counterparty}</span>}
              {doc.issued_on && <span>Dated {fmtDay(doc.issued_on)}</span>}
            </div>
            {doc.status === "archived" && (
              <div className="mt-4">
                <Notice>This document is archived. It keeps its history and isn&apos;t shared or reminded about.</Notice>
              </div>
            )}
            {latest && (
              <div className="mt-6 flex flex-wrap gap-2">
                {/* Only PDFs ShipShape made open in the browser; uploads and signed copies download. */}
                {(latest.origin === "filled" || latest.origin === "sample") && (
                  <a href={`/app/documents/${doc.id}/file?v=${latest.version}&mode=view`} target="_blank" rel="noopener" className="btn">
                    Open
                  </a>
                )}
                <a href={`/app/documents/${doc.id}/file?v=${latest.version}&mode=download`} className="btn-ghost">
                  Download
                </a>
              </div>
            )}
            {latest?.fill_record?.fields && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold">Where each field came from</h2>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {Object.entries(latest.fill_record.fields).map(([k, src]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
                      <dt className="text-ink-2">{FACT_LABELS[k] ?? k.replaceAll("_", " ")}</dt>
                      <dd className="text-right font-mono text-xs leading-5 text-ink-3">{SOURCE[src] ?? src}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </article>

          <section className="card space-y-3">
            <h2 className="font-semibold">Versions</h2>
            <ol className="divide-y divide-line text-sm">
              {versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    Version {v.version} · {fmtDateTime(v.created_at)} · {size(v.size_bytes)}
                    {v.origin === "signed" && <span className="ml-2 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ok">Signed copy</span>}
                    <span className="ml-2 font-mono text-xs text-ink-3" title={`SHA-256 ${v.sha256}`}>
                      {v.sha256.slice(0, 12)}
                    </span>
                  </span>
                  <a href={`/app/documents/${doc.id}/file?v=${v.version}&mode=download`} className="inline-flex min-h-6 items-center text-ink-2 underline">
                    Download
                  </a>
                </li>
              ))}
            </ol>
            {canUpload ? (
              <VersionForm id={doc.id} />
            ) : (
              <p className="text-xs text-ink-3">
                {ctx.demo ? "Sample workspaces can't take uploads." : "Uploads open after our security review."}
              </p>
            )}
          </section>
        </section>

        <aside className="min-w-0 space-y-6">
          <section className="card space-y-3">
            <h2 className="font-semibold">Details</h2>
            <DetailsForm
              id={doc.id}
              values={{ title: doc.title, kind: doc.kind, issuer: doc.issuer, counterparty: doc.counterparty, issued_on: doc.issued_on, expires_on: doc.expires_on, renews_on: doc.renews_on }}
            />
          </section>

          {latest && doc.status === "active" && (
            <section className="card space-y-3">
              <h2 className="font-semibold">Signatures</h2>
              {requests.length > 0 && (
                <ul className="divide-y divide-line text-sm">
                  {requests.map((r) => {
                    const lapsed = r.status === "pending" && Date.parse(r.expires_at) <= now;
                    return (
                      <li key={r.id} className="space-y-1 py-2">
                        <p className="flex justify-between gap-2">
                          <span className="min-w-0 truncate font-medium">{r.signer_name}</span>
                          <span className="shrink-0 text-xs text-ink-2">{lapsed ? "Expired" : REQUEST_STATUS[r.status]}</span>
                        </p>
                        <p className="truncate text-xs text-ink-3">
                          {r.signer_email} · version {r.version}
                          {r.status === "signed" && r.signed_at && <> · signed {fmtDateTime(r.signed_at)}</>}
                          {r.status === "pending" && !lapsed && <> · open until {fmtDay(r.expires_at)}</>}
                        </p>
                        {(r.has_review_file || (r.status === "pending" && !lapsed)) && (
                          <div className="flex flex-wrap gap-x-4">
                            {r.has_review_file && (
                              <a href={`/app/documents/${doc.id}/file?request=${r.id}`} className="inline-flex min-h-6 items-center text-xs text-ink-2 underline">
                                File sent for signing
                              </a>
                            )}
                            {r.status === "pending" && !lapsed && (
                              <form action={withdrawSignature}>
                                <input type="hidden" name="id" value={doc.id} />
                                <input type="hidden" name="request" value={r.id} />
                                <button className="inline-flex min-h-6 items-center text-xs text-ink-2 underline">Withdraw</button>
                              </form>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {esignAvailable(ctx) ? (
                <SignRequestForm id={doc.id} days={SIGN_DAYS} demo={ctx.demo} />
              ) : (
                <p className="text-xs text-ink-3">Signing by email opens once ShipShape can send email.</p>
              )}
            </section>
          )}

          {template && (
            <section className="card space-y-1 text-sm">
              <h2 className="font-semibold">Source</h2>
              <p>
                <a href={template.source.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {template.source.name}
                </a>{" "}
                ({template.source.version})
              </p>
              <p className="text-ink-2">Licence: {template.source.license}</p>
            </section>
          )}

          <section className="card space-y-3">
            <h2 className="font-semibold">History</h2>
            <ol className="space-y-2 text-sm">
              {audit.map((a) => (
                <li key={a.seq} className="flex justify-between gap-3">
                  <span>{ACTIONS[a.action] ?? a.action}</span>
                  <time className="shrink-0 text-xs text-ink-3" dateTime={a.at}>
                    {fmtDateTime(a.at)}
                  </time>
                </li>
              ))}
            </ol>
            <p className="text-xs text-ink-3">Each entry is chained to the one before it, so edits behind our back show up.</p>
          </section>

          <form action={archive}>
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="archived" value={doc.status === "archived" ? "0" : "1"} />
            <button className="inline-flex min-h-6 items-center text-sm text-ink-2 underline">{doc.status === "archived" ? "Restore document" : "Archive document"}</button>
          </form>
        </aside>
      </div>
    </div>
  );
}
