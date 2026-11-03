import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-ui";
import { ConfirmForm } from "@/components/confirm-form";
import { Icon } from "@/components/icons";
import { esignAvailable } from "@/lib/server/esign";
import { uiV2 } from "@/lib/server/flags";
import { documentsToSign, getPerson, PERSON_NOT_YOURS } from "@/lib/server/people";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { dayOf } from "@/lib/today";
import { REQUEST_STATUS } from "../../documents/[id]/shared";
import { SIGNED_KINDS } from "../../documents/[id]/v2";
import { deletePersonAction } from "../actions";
import { PersonForm } from "../forms";

export const metadata: Metadata = { title: "Person" };

/**
 * One person in People (spec §5): their details, this workspace's signature requests to their address (each to its
 * document; active documents only), Ask to sign, and Edit and Delete for whoever may change them.
 */
export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireWorkspace();
  const zone = await viewerZone();
  const { id } = await params;
  const { error } = await searchParams;
  const got = await getPerson(ctx, id);
  if (!got) notFound();
  const { person, requests } = got;
  const v2 = uiV2();
  const signing = esignAvailable(ctx);
  // The redesigned document page has the request form only on the kinds that get signed; the earlier one on every kind.
  const docs = person.email && signing ? await documentsToSign(ctx, v2 ? [...SIGNED_KINDS] : null) : [];
  const section = v2 ? "section-title" : "font-semibold";
  const list = v2 ? "group-list plain" : "divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper";
  return (
    <div className={v2 ? "mx-auto max-w-[720px] space-y-8" : "max-w-3xl space-y-8"}>
      <nav className="text-sm">
        <Link href="/app/people" className="-my-2.5 inline-flex min-h-11 items-center text-ink-2 hover:text-ink">
          ← People
        </Link>
      </nav>
      <div className="space-y-2">
        {/* The back link above already says People; the redesigned look doesn't say it twice. */}
        <PageHeader eyebrow={v2 ? undefined : "People"} title={person.name} />
        <p className="text-ink-2">{[person.company, person.email].filter(Boolean).join(" · ") || "No email or company yet."}</p>
      </div>
      {error === "change" && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {PERSON_NOT_YOURS}
        </p>
      )}

      <section aria-labelledby="requests-title" className="space-y-2">
        <h2 id="requests-title" className={section}>
          Signature requests: {person.requests}
        </h2>
        {requests.length > 0 ? (
          <ul className={list}>
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/app/documents/${r.documentId}#signatures`} className="group-row">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block truncate text-[13px] text-ink-3">
                      {REQUEST_STATUS[r.status]} · asked {dayOf(r.createdAt, zone)}
                      {r.signedAt && ` · signed ${dayOf(r.signedAt, zone)}`}
                    </span>
                  </span>
                  <span className="text-ink-3">
                    <Icon name="chevron" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">
            {person.email ? "No signature requests to this email yet." : "Add an email to see the signature requests sent to it."}
          </p>
        )}
      </section>

      <section aria-labelledby="ask-title" className="space-y-2">
        <h2 id="ask-title" className={section}>
          Ask to sign
        </h2>
        {!signing ? (
          <p className="text-sm text-ink-3">Signing by email opens once ShipShape can send email.</p>
        ) : !person.email ? (
          <p className="text-sm text-ink-3">Add an email to ask {person.name} to sign.</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-ink-3">
            No document to sign yet. Make an NDA or agreement in{" "}
            <Link href="/app/make" className="underline">
              Templates
            </Link>{" "}
            first.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-2">Pick a document. Its signature request opens with {person.name}&apos;s name and email filled in.</p>
            <ul className={list}>
              {docs.map((d) => (
                <li key={d.id}>
                  {/* The person's id, never their email, goes in the address; the document page reads them under row level security. */}
                  <Link href={`/app/documents/${d.id}?person=${person.id}#signer-name`} className="group-row">
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <span className="text-ink-3">
                      <Icon name="chevron" size={16} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {person.canChange ? (
        <>
          <details className="group space-y-3">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm text-ink-2 underline [&::-webkit-details-marker]:hidden">
              Edit
            </summary>
            <PersonForm v2={v2} person={person} />
          </details>
          <ConfirmForm
            action={deletePersonAction}
            fields={{ id: person.id }}
            trigger="Delete from People"
            question={`Delete ${person.name} from People? Their signature requests and signed documents stay as they are.`}
            confirm="Delete"
            cancel="Keep them"
            destructive
            pendingLabel="Deleting…"
          />
        </>
      ) : (
        <p className="text-sm text-ink-3">{PERSON_NOT_YOURS}</p>
      )}
    </div>
  );
}
