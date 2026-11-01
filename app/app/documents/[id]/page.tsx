import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, ValidityChip, fmtDay } from "@/components/app-ui";
import { ConfirmForm } from "@/components/confirm-form";
import { HashLanding } from "@/components/hash-landing";
import { SubmitButton } from "@/components/submit-button";
import { fmtDateTime } from "@/components/ui";
import { PLANS } from "@/lib/plans";
import { FACT_LABELS } from "@/lib/profile-fields";
import { DOC_KINDS, getDocument } from "@/lib/server/documents";
import { esignAvailable, listSignatureRequests, SIGN_DAYS, type SignatureRequestRow } from "@/lib/server/esign";
import { realDocsEnabled } from "@/lib/server/flags";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { templateById } from "@/lib/templates/catalog";
import { dayOf } from "@/lib/today";
import type { TemplateInfo } from "@/lib/templates/types";
import { archive, withdrawSignature } from "../actions";
import { DetailsForm, SignRequestForm, VersionForm } from "../forms";

export const metadata: Metadata = { title: "Document" };

const ACTIONS: Record<string, string> = {
  "document.created": "Added to documents",
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
  "esign.review_downloaded": "File sent for signing downloaded",
};

/** What went wrong in a form posted from this page (see backToDocument in ../actions.ts), and the one thing that fixes it. */
const ERRORS: Record<string, { text: string; fix?: { href: string; label: string } }> = {
  limit: {
    text: `The Free plan holds ${PLANS.free.documents} active documents, so this one stays archived. Archive another one, then restore this one.`,
    fix: { href: "/app/documents", label: "Choose one to archive" },
  },
  // Nothing to fix: the request's status below is already up to date.
  closed: { text: "That signing request was already signed or withdrawn, so there was nothing to withdraw. Its status is under Signatures." },
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
  typed_saved: "Typed, saved to Business facts",
};

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Each filled field with the label the form showed, in the form's order: the stored record's keys
 * come back from jsonb sorted by length, and a key like `tin_kind` means nothing on its own.
 */
function fieldSources(fields: Record<string, string>, template: TemplateInfo | undefined) {
  const defs = template?.fields ?? [];
  const rank = (key: string) => {
    const i = defs.findIndex((f) => f.key === key);
    return i === -1 ? defs.length : i;
  };
  return Object.entries(fields)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, src]) => ({
      key,
      label: defs.find((f) => f.key === key)?.label ?? FACT_LABELS[key] ?? key.replaceAll("_", " "),
      source: SOURCE[src] ?? src,
    }));
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; made?: string; added?: string }>;
}) {
  const ctx = await requireWorkspace();
  const zone = await viewerZone();
  const { id } = await params;
  const { error, made, added } = await searchParams;
  const formError = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;
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
      <HashLanding />
      <nav className="text-sm">
        <Link href="/app/documents" className="inline-flex min-h-6 items-center text-ink-2 hover:underline">
          ← Documents
        </Link>
      </nav>
      {formError && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {formError.text}
          {formError.fix && (
            <>
              {" "}
              <Link href={formError.fix.href} className="font-medium underline">
                {formError.fix.label}
              </Link>
            </>
          )}
        </p>
      )}
      {/* After making or adding it (../../make/actions.ts, ../actions.ts): done, the record, what happens next. */}
      {made && template && (
        <div role="status">
          <Notice tone="ok">
            Your {template.short} is made and saved here, with where each value came from and your approval in its history. Next:{" "}
            {template.kind === "w9"
              ? "download it and send it to whoever asked for it."
              : esignAvailable(ctx)
                ? "ask the other party to sign it under Signatures."
                : "download it and send it to the other party to sign."}
          </Notice>
        </div>
      )}
      {added && !made && (
        <div role="status">
          <Notice tone="ok">
            Added to your documents as version 1. Every view and download goes into its history.{" "}
            {doc.expires_on
              ? `Next: it shows under Needs attention on Home 30 days before it expires on ${fmtDay(doc.expires_on)}.`
              : "Next: add its expiry date under Details, so Home can warn you before it lapses."}
          </Notice>
        </div>
      )}
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
                <dl className="mt-2 grid gap-y-1 text-sm">
                  {fieldSources(latest.fill_record.fields, template).map(({ key, label, source }) => (
                    <div key={key} className="flex justify-between gap-3 border-b border-line py-1">
                      <dt className="text-ink-2">{label}</dt>
                      <dd className="shrink-0 whitespace-nowrap text-right font-mono text-xs leading-5 text-ink-3">{source}</dd>
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
                          {r.status === "pending" && !lapsed && <> · open until {dayOf(r.expires_at, zone)}</>}
                        </p>
                        {(r.has_review_file || (r.status === "pending" && !lapsed)) && (
                          <div className="flex flex-wrap gap-x-4">
                            {r.has_review_file && (
                              <a href={`/app/documents/${doc.id}/file?request=${r.id}`} className="inline-flex min-h-6 items-center text-xs text-ink-2 underline">
                                File sent for signing
                              </a>
                            )}
                            {r.status === "pending" && !lapsed && (
                              <ConfirmForm
                                compact
                                action={withdrawSignature}
                                fields={{ id: doc.id, request: r.id }}
                                trigger="Withdraw"
                                question={`Withdraw this request? ${r.signer_name} won't be able to sign. You can make a new link any time.`}
                                confirm="Withdraw the request"
                                pendingLabel="Withdrawing…"
                              />
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
              <p className="text-ink-2">License: {template.source.license}</p>
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
            <p className="text-xs text-ink-3">Entries can&apos;t be edited or deleted through ShipShape, and each is linked to the one before it.</p>
          </section>

          <form action={archive}>
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="archived" value={doc.status === "archived" ? "0" : "1"} />
            <SubmitButton className="inline-flex min-h-6 items-center text-sm text-ink-2 underline" pendingLabel={doc.status === "archived" ? "Restoring…" : "Archiving…"}>
              {doc.status === "archived" ? "Restore document" : "Archive document"}
            </SubmitButton>
          </form>
        </aside>
      </div>
    </div>
  );
}
