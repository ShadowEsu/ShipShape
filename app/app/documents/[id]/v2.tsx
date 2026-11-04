import Link from "next/link";
import { ViewTransition } from "react";
import { Notice, ValidityChip } from "@/components/app-ui";
import { ConfirmForm } from "@/components/confirm-form";
import { HashLanding } from "@/components/hash-landing";
import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { historyLabel } from "@/lib/history";
import { DOC_KINDS, DOCUMENT_HISTORY_SHOWN, type AuditRow, type DocKind, type DocRow, type VersionRow } from "@/lib/server/documents";
import { SIGN_DAYS, type SignatureRequestRow } from "@/lib/server/esign";
import { timeOf } from "@/lib/today";
import type { TemplateInfo } from "@/lib/templates/types";
import { StateChip } from "../../hair-row";
import { ActionSheet } from "../../nav-v2";
import { SaveToggle } from "../../saved/save-toggle";
import { archive } from "../actions";
import { DetailsListForm, SignRequestForm, VersionForm } from "../forms";
import { archiveQuestion, versionWarning } from "../messages";
import { DeleteForGood } from "./delete-dialog";
import { ARCHIVED_ID, fieldSources, size, TITLE_ID } from "./shared";
import { SignatureRequests } from "./signatures";
import { StatusLanding } from "./status-landing";

/** The kinds that get signed: only these offer "Ask to sign" (Design, 02 Nov), here and on a person's page in People. */
export const SIGNED_KINDS: ReadonlySet<DocKind> = new Set<DocKind>(["nda", "agreement"]);

/** History shows this many entries, then "Show all". */
export const HISTORY_FIRST = 5;

const FILE_TYPE: Record<VersionRow["mime"], string> = { "application/pdf": "PDF", "image/png": "PNG", "image/jpeg": "JPEG" };

function History({ audit, moreAudit, zone }: { audit: AuditRow[]; moreAudit: boolean; zone: string }) {
  const row = (a: AuditRow) => (
    <li key={a.seq} className="flex justify-between gap-3 py-1.5">
      <span>{historyLabel(a.action, a.about_name)}</span>
      <time className="shrink-0 text-xs leading-5 text-ink-3" dateTime={a.at}>
        {timeOf(a.at, zone)}
      </time>
    </li>
  );
  const count = moreAudit ? `${audit.length}+` : `${audit.length}`;
  return (
    <details className="group rounded-2xl border border-line">
      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 font-medium [&::-webkit-details-marker]:hidden">
        {`History (${count})`}
        {/* Down while closed, up while open: it opens here, it doesn't go anywhere. The summary carries the expanded state.
            disclosure-chevron: the turn, which stops under reduced motion (motion.css). */}
        <span className="disclosure-chevron rotate-90 text-ink-3 group-open:-rotate-90">
          <Icon name="chevron" />
        </span>
      </summary>
      <div className="space-y-2 px-4 pb-4 text-sm">
        <ol>{audit.slice(0, HISTORY_FIRST).map(row)}</ol>
        {audit.length > HISTORY_FIRST && (
          // Opened, its own summary goes: the rest simply continues the list above.
          <details className="[&[open]>summary]:hidden">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-ink-2 underline [&::-webkit-details-marker]:hidden">{`Show all ${count}`}</summary>
            <ol>{audit.slice(HISTORY_FIRST).map(row)}</ol>
          </details>
        )}
        {moreAudit && <p className="text-xs text-ink-3">Showing the latest {DOCUMENT_HISTORY_SHOWN} entries. Your export has every one.</p>}
        <p className="text-xs text-ink-3">Entries can&apos;t be edited or deleted through ShipShape, and each is linked to the one before it.</p>
      </div>
    </details>
  );
}

/**
 * The redesigned document page (the default look; Design spec 2026-11-02, doc-390): the title, its state and version, the
 * first page's place, one primary (Share in a link), round actions, then Details and History; Signatures, Versions, where
 * each field came from and the Source follow. One 720px column at every width. Same data, actions and words as the old page.
 */
export function DocumentV2(p: {
  doc: DocRow;
  versions: VersionRow[];
  audit: AuditRow[];
  moreAudit: boolean;
  template: TemplateInfo | undefined;
  requests: SignatureRequestRow[];
  zone: string;
  now: number;
  canUpload: boolean;
  demo: boolean;
  esignOn: boolean;
  openSigners: string[];
  linksWarning: string | null;
  notices: React.ReactNode;
  /** Whether this person saved it (Saved, 0045): the toggle shows while it's active. */
  saved: boolean;
  /** A person from People to fill the request form with ("Ask to sign" on their page), read under row level security. */
  signer: { name: string; email: string } | null;
  /** The signers' addresses already in People (lowercased): "In People" beside them, "Keep in People" beside the others. */
  kept: ReadonlySet<string>;
  /** An owner or admin (Security D3): an archived document offers Delete for good. */
  canDelete: boolean;
}) {
  const { doc, versions, template, zone } = p;
  const latest = versions[0];
  const active = doc.status === "active";
  const signable = SIGNED_KINDS.has(doc.kind);
  const file = (v: number, mode: "view" | "download") => `/app/documents/${doc.id}/file?v=${v}&mode=${mode}`;
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <HashLanding />
      <StatusLanding status={doc.status} />
      <nav aria-label="Back" className="text-sm">
        <Link href="/app/documents" className="-my-2.5 inline-flex min-h-11 items-center text-ink-2 hover:text-ink">
          <span aria-hidden="true">←</span>&nbsp;Documents
        </Link>
      </nav>

      <header>
        {/* The documents list's row title morphs into this one (Design spec 2026-11-02 §6.1). */}
        <ViewTransition name={`doc-${doc.id}`} share="v2-morph" default="none">
          {/* tabIndex -1: Restore lands focus here (StatusLanding). */}
          <h1 id={TITLE_ID} tabIndex={-1} className="page-title">
            {doc.title}
          </h1>
        </ViewTransition>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          {/* A changed state (new dates saved, a new version) crossfades in place, the old label out and up, the new one in (§6.3). */}
          <ViewTransition update="v2-chip" default="none">
            <ValidityChip validity={doc.validity} expiresOn={doc.expires_on} />
          </ViewTransition>
          {latest && <span>Version {latest.version}</span>}
          {active && (
            <div className="ml-auto">
              <SaveToggle kind="document" id={doc.id} saved={p.saved} />
            </div>
          )}
        </div>
      </header>

      {p.notices}

      {/*
        The first page's place. A paper card for every file: a real preview would read the file, and every read is a
        history entry (Security, 20261102-1109). The 3:4 page sits in a fixed crop, so a preview can take its place without
        moving anything.
      */}
      <div aria-hidden="true" className="h-52 overflow-hidden rounded-2xl border border-line px-8 pt-6 md:h-64">
        <div className="mx-auto aspect-[3/4] w-full max-w-[300px] rounded-t-md border border-b-0 border-[var(--line-2)] bg-paper p-5">
          <p className="doc-kind eyebrow">{DOC_KINDS[doc.kind]}</p>
          <p className="mt-2 line-clamp-3 text-lg leading-snug font-medium">{doc.title}</p>
          {latest && <p className="mt-3 font-mono text-xs text-ink-3">{FILE_TYPE[latest.mime]}</p>}
        </div>
      </div>

      {active ? (
        // Full width is the phone rule; from 768px it's an auto-width pill at the left, above the actions (Design 14:40).
        <Link href={`/app/passport?docs=${doc.id}`} className="btn press w-full md:w-auto md:min-w-[200px]">
          Share in a link
        </Link>
      ) : (
        // tabIndex -1: Archive (in More) lands focus here (StatusLanding).
        <div id={ARCHIVED_ID} tabIndex={-1} className="space-y-2 rounded-2xl border border-line p-4">
          <form action={archive} className="flex items-center justify-between gap-3">
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="archived" value="0" />
            <span className="font-semibold">Archived</span>
            <SubmitButton className="btn press" pendingLabel="Restoring…">
              Restore
            </SubmitButton>
          </form>
          <Notice>
            This document is archived. It keeps its history and was taken off your passport links; it isn&apos;t reminded about or open for signing.
            Restoring it won&apos;t put it back on any link.
          </Notice>
          {p.canDelete && <DeleteForGood id={doc.id} title={doc.title} />}
        </div>
      )}

      {latest && (
        <div role="group" aria-label="Actions" className="flex max-w-md gap-2">
          {/* Only PDFs ShipShape made open in the browser; uploads and signed copies download. */}
          {(latest.origin === "filled" || latest.origin === "sample") && (
            <a href={file(latest.version, "view")} target="_blank" rel="noopener" className="round-action press">
              <span className="round-icon">
                <Icon name="open" />
              </span>
              Open
            </a>
          )}
          <a href={file(latest.version, "download")} data-stays className="round-action press">
            <span className="round-icon">
              <Icon name="download" />
            </span>
            Download
          </a>
          {active && signable && (
            // Lands on the signer's name (HashLanding focuses it); without email signing, on the section's note.
            <a href={p.esignOn ? "#signer-name" : "#signatures"} className="round-action press">
              <span className="round-icon">
                <Icon name="sign" />
              </span>
              Ask to sign
            </a>
          )}
          {active && (
            <ActionSheet id="document-more" title="More" label="More" className="round-action press">
              <ul>
                {p.canUpload && (
                  <li>
                    <a href="#version-file" className="menu-row">
                      Add a new version
                    </a>
                  </li>
                )}
                <li>
                  {p.openSigners.length > 0 ? (
                    // The question and its buttons, once asked, sit inside the menu's padding.
                    <div className="[&_form]:px-3 [&_form]:py-2">
                      <ConfirmForm
                        action={archive}
                        fields={{ id: doc.id, archived: "1" }}
                        trigger="Archive document"
                        triggerClassName="menu-row"
                        question={p.linksWarning ? `${archiveQuestion(p.openSigners)} ${p.linksWarning}` : archiveQuestion(p.openSigners)}
                        confirm="Archive and withdraw"
                        cancel="Keep it"
                        destructive
                        pendingLabel="Archiving…"
                      />
                    </div>
                  ) : (
                    <form action={archive}>
                      <input type="hidden" name="id" value={doc.id} />
                      <input type="hidden" name="archived" value="1" />
                      <SubmitButton className="menu-row" pendingLabel="Archiving…">
                        Archive document
                      </SubmitButton>
                    </form>
                  )}
                </li>
              </ul>
              {p.linksWarning && <p className="px-3 pt-1 pb-2 text-xs text-ink-3">{p.linksWarning}</p>}
            </ActionSheet>
          )}
        </div>
      )}

      <section aria-labelledby="details-title" className="space-y-2">
        <h2 id="details-title" className="section-title">
          Details
        </h2>
        <DetailsListForm
          id={doc.id}
          values={{ title: doc.title, kind: doc.kind, issuer: doc.issuer, counterparty: doc.counterparty, issued_on: doc.issued_on, expires_on: doc.expires_on, renews_on: doc.renews_on }}
        />
      </section>

      <History audit={p.audit} moreAudit={p.moreAudit} zone={zone} />

      {latest && active && (signable || p.requests.length > 0) && (
        <section id="signatures" aria-labelledby="signatures-title" className="scroll-mt-24 space-y-2">
          <h2 id="signatures-title" className="section-title">
            Signatures
          </h2>
          {p.requests.length > 0 && <SignatureRequests docId={doc.id} requests={p.requests} zone={zone} now={p.now} v2 kept={p.kept} />}
          {signable &&
            (p.esignOn ? (
              <SignRequestForm id={doc.id} days={SIGN_DAYS} demo={p.demo} rows signer={p.signer} />
            ) : (
              <p className="text-xs text-ink-3">Signing by email opens once ShipShape can send email.</p>
            ))}
        </section>
      )}

      <section id="versions" aria-labelledby="versions-title" className="scroll-mt-24 space-y-2">
        <h2 id="versions-title" className="section-title">
          Versions
        </h2>
        <ul className="group-list plain">
          {versions.map((v) => (
            <li key={v.version} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                Version {v.version} · {timeOf(v.created_at, zone)} · {size(v.size_bytes)}
                {v.origin === "signed" && (
                  <span className="ml-2">
                    <StateChip tone="ok">Signed copy</StateChip>
                  </span>
                )}
                <span className="ml-2 font-mono text-xs text-ink-3" title={`SHA-256 ${v.sha256}`}>
                  {v.sha256.slice(0, 12)}
                </span>
              </span>
              <a
                href={file(v.version, "download")}
                data-stays
                aria-label={`Download version ${v.version}`}
                className="inline-flex min-h-11 shrink-0 items-center text-ink-2 underline"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
        {p.canUpload ? (
          <VersionForm id={doc.id} warning={p.openSigners.length ? versionWarning(p.openSigners) : undefined} />
        ) : (
          <p className="text-xs text-ink-3">{p.demo ? "Sample workspaces can't take uploads." : "Uploads open after our security review."}</p>
        )}
      </section>

      {latest?.fill_record?.fields && (
        <section aria-labelledby="sources-title" className="space-y-2">
          <h2 id="sources-title" className="section-title">
            Where each field came from
          </h2>
          <ul className="group-list plain">
            {fieldSources(latest.fill_record.fields, template).map(({ key, label, source }) => (
              <li key={key} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-ink-2">{label}</span>
                <span className="shrink-0 text-right font-mono text-xs leading-5 whitespace-nowrap text-ink-3">{source}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {template && (
        <section className="space-y-1 text-sm">
          <h2 className="section-title">Source</h2>
          <p>
            <a href={template.source.url} target="_blank" rel="noopener noreferrer" className="underline">
              {template.source.name}
            </a>{" "}
            ({template.source.version})
          </p>
          <p className="text-ink-2">License: {template.source.license}</p>
        </section>
      )}
    </div>
  );
}
