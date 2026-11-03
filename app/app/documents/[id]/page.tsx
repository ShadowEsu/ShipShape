import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";
import { Notice, ValidityChip } from "@/components/app-ui";
import { ConfirmForm } from "@/components/confirm-form";
import { HashLanding } from "@/components/hash-landing";
import { SubmitButton } from "@/components/submit-button";
import { historyLabel } from "@/lib/history";
import { DOC_KINDS, DOCUMENT_HISTORY_SHOWN, getDocument } from "@/lib/server/documents";
import { esignAvailable, listSignatureRequests, SIGN_DAYS } from "@/lib/server/esign";
import { realDocsEnabled, uiV2 } from "@/lib/server/flags";
import { openLinksWith } from "@/lib/server/passport";
import { keptEmails, signerFor } from "@/lib/server/people";
import { isSaved } from "@/lib/server/saved";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { templateById } from "@/lib/templates/catalog";
import { fmtDay, timeOf } from "@/lib/today";
import { ERRORS, fieldSources, size } from "./shared";
import { SignatureRequests } from "./signatures";
import { DocumentV2 } from "./v2";
import { archive } from "../actions";
import { DetailsForm, SignRequestForm, VersionForm } from "../forms";
import { archiveLinksWarning, archiveQuestion, versionWarning } from "../messages";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; made?: string; added?: string; person?: string; kept?: string }>;
}) {
  const ctx = await requireWorkspace();
  const zone = await viewerZone();
  const { id } = await params;
  const { error, made, added, person, kept } = await searchParams;
  const formError = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;
  const got = await getDocument(ctx, id);
  if (!got) notFound();
  const { doc, versions, audit, moreAudit } = got;
  const latest = versions[0];
  const template = doc.template_id ? templateById(doc.template_id) : undefined;
  const canUpload = !ctx.demo && realDocsEnabled();
  const requests = await listSignatureRequests(ctx, doc.id);
  const now = Date.now();
  // Who still has a working signing link: archiving or a new version withdraws these, and the page says so first.
  const openSigners = requests.filter((r) => r.status === "pending" && Date.parse(r.expires_at) > now).map((r) => r.signer_name);
  // Links that still work and hold it: archiving takes it off them for good (0041), and the page says so before the click.
  const openLinks = doc.status === "active" ? await openLinksWith(ctx, doc.id) : 0;
  const linksWarning = openLinks > 0 ? archiveLinksWarning(openLinks) : null;
  // "Ask to sign" from a person's page (People): the address carries their id only; their name and email are read here,
  // under row level security, to fill the request form.
  const signer = person && doc.status === "active" && esignAvailable(ctx) ? await signerFor(ctx, person) : null;

  const notices = (
    <>
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
      {kept === "already" && (
        <div role="status">
          <Notice>That email was already in People. Nothing was added.</Notice>
        </div>
      )}
      {added && !made && (
        <div role="status">
          <Notice tone="ok">
            Added to your documents as version 1. Every view and download goes into its history.{" "}
            {/* Where it stands on Home's Needs attention today (Design, 02 Nov): already there inside the 30 days or lapsed. */}
            {!doc.expires_on
              ? "Next: add its expiry date under Details, so Home can warn you before it lapses."
              : doc.validity === "expired"
                ? `It expired on ${fmtDay(doc.expires_on)}, so it's under Needs attention on Home.`
                : doc.validity === "expiring"
                  ? `It expires on ${fmtDay(doc.expires_on)}, so it's already under Needs attention on Home.`
                  : `Next: it shows under Needs attention on Home 30 days before it expires on ${fmtDay(doc.expires_on)}.`}
          </Notice>
        </div>
      )}
    </>
  );

  if (uiV2())
    return (
      <DocumentV2
        doc={doc}
        versions={versions}
        audit={audit}
        moreAudit={moreAudit}
        template={template}
        requests={requests}
        zone={zone}
        now={now}
        canUpload={canUpload}
        demo={ctx.demo}
        esignOn={esignAvailable(ctx)}
        openSigners={openSigners}
        linksWarning={linksWarning}
        notices={notices}
        saved={doc.status === "active" && (await isSaved(ctx, "document", doc.id))}
        signer={signer}
        kept={await keptEmails(ctx, requests.map((r) => r.signer_email))}
      />
    );

  return (
    <div className="space-y-6">
      <HashLanding />
      <nav className="text-sm">
        <Link href="/app/documents" className="inline-flex min-h-6 items-center text-ink-2 hover:underline">
          ← Documents
        </Link>
      </nav>
      {notices}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-6">
          <article className="rounded-2xl border border-line bg-paper p-6 shadow-sm sm:p-8">
            <p className="eyebrow">{DOC_KINDS[doc.kind]}</p>
            {/* The documents list's row title morphs into this one (redesigned app, Design spec 2026-11-02 §6.1); the name is inert otherwise. */}
            <ViewTransition name={`doc-${doc.id}`} share="v2-morph" default="none">
              <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">{doc.title}</h1>
            </ViewTransition>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
              <ValidityChip validity={doc.validity} expiresOn={doc.expires_on} />
              {doc.issuer && <span>Issued by {doc.issuer}</span>}
              {doc.counterparty && <span>With {doc.counterparty}</span>}
              {doc.issued_on && <span>Dated {fmtDay(doc.issued_on)}</span>}
            </div>
            {doc.status === "archived" && (
              <div className="mt-4">
                <Notice>
                  This document is archived. It keeps its history and was taken off your passport links; it isn&apos;t reminded about or open for
                  signing. Restoring it won&apos;t put it back on any link.
                </Notice>
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
                    Version {v.version} · {timeOf(v.created_at, zone)} · {size(v.size_bytes)}
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
              <VersionForm id={doc.id} warning={openSigners.length ? versionWarning(openSigners) : undefined} />
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
              {requests.length > 0 && <SignatureRequests docId={doc.id} requests={requests} zone={zone} now={now} />}
              {esignAvailable(ctx) ? (
                <SignRequestForm id={doc.id} days={SIGN_DAYS} demo={ctx.demo} signer={signer} />
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
                  <span>{historyLabel(a.action, a.about_name)}</span>
                  <time className="shrink-0 text-xs text-ink-3" dateTime={a.at}>
                    {timeOf(a.at, zone)}
                  </time>
                </li>
              ))}
            </ol>
            {moreAudit && <p className="text-xs text-ink-3">Showing the latest {DOCUMENT_HISTORY_SHOWN} entries. Your export has every one.</p>}
            <p className="text-xs text-ink-3">Entries can&apos;t be edited or deleted through ShipShape, and each is linked to the one before it.</p>
          </section>

          <div className="space-y-1">
            {doc.status === "active" && openSigners.length > 0 ? (
              <ConfirmForm
                action={archive}
                fields={{ id: doc.id, archived: "1" }}
                trigger="Archive document"
                question={linksWarning ? `${archiveQuestion(openSigners)} ${linksWarning}` : archiveQuestion(openSigners)}
                confirm="Archive and withdraw"
                cancel="Keep it"
                destructive
                pendingLabel="Archiving…"
              />
            ) : (
              <form action={archive}>
                <input type="hidden" name="id" value={doc.id} />
                <input type="hidden" name="archived" value={doc.status === "archived" ? "0" : "1"} />
                <SubmitButton className="inline-flex min-h-6 items-center text-sm text-ink-2 underline" pendingLabel={doc.status === "archived" ? "Restoring…" : "Archiving…"}>
                  {doc.status === "archived" ? "Restore document" : "Archive document"}
                </SubmitButton>
              </form>
            )}
            {linksWarning && <p className="text-xs text-ink-3">{linksWarning}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
