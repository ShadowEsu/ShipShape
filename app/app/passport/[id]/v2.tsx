import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { ConfirmForm } from "@/components/confirm-form";
import { Icon } from "@/components/icons";
import { DOC_KINDS } from "@/lib/server/documents";
import { type PassportDetail, PASSPORT_ACCESS_SHOWN } from "@/lib/server/passport";
import { dayOf, timeOf } from "@/lib/today";
import { SaveToggle } from "../../saved/save-toggle";
import { turnOff } from "../actions";
import { ACTION } from "./shared";

/**
 * A passport link's page in the redesigned app (Design spec 2026-11-02 §4, PR 7 plan): one 720px column; its state,
 * the documents on it and each time it was opened as grouped lists; Turn off this link at the foot, asking once first.
 * Same facts, words and actions as the current page.
 */
export function PassportLinkV2({ p, zone, formError, saved }: { p: PassportDetail; zone: string; formError: string | undefined; saved: boolean }) {
  const revokedAt = p.link.revoked_at;
  const expired = new Date(p.link.expires_at).getTime() < Date.now();
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <nav className="text-sm">
        <Link href="/app/passport" className="inline-flex min-h-6 items-center text-ink-2 hover:underline">
          ← Passport
        </Link>
      </nav>
      <PageHeader eyebrow="Passport link" title={p.link.label}>
        {/* Saved (0045): turned-off and expired links can be saved too; the Saved list shows their state. */}
        <SaveToggle kind="link" id={p.link.id} saved={saved} />
      </PageHeader>
      {formError && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {formError}
        </p>
      )}
      {revokedAt ? (
        <Notice tone="info">Turned off {timeOf(revokedAt, zone)}. Nobody can open it any more.</Notice>
      ) : expired ? (
        <div className="space-y-3">
          <Notice>Expired {dayOf(p.link.expires_at, zone)}, so nobody can open it. If they still need these documents, make a new link.</Notice>
          <Link href={`/app/passport?docs=${p.documents.map((d) => d.id).join(",")}`} className="btn press">
            Make a new link with these documents
          </Link>
        </div>
      ) : (
        <>
          <p className="text-ink-2">Works until {dayOf(p.link.expires_at, zone)}. The link itself was shown once when you made it.</p>
          {/* Archiving takes a document off every link (0041), so a link can end up holding nothing. */}
          {p.documents.length === 0 && <Notice>Every document on this link was archived, so it shows nothing. Turn it off, or make a new link.</Notice>}
        </>
      )}

      <section aria-labelledby="on-link-title" className="space-y-2">
        <h2 id="on-link-title" className="section-title">
          Documents on this link
        </h2>
        {/* A link is made with at least one document; it ends up with none only when they were all archived (0041). */}
        {p.documents.length === 0 ? (
          <p className="rounded-2xl border border-line px-4 py-3 text-sm text-ink-2">None left. Archived documents come off for good.</p>
        ) : (
          <ul className="group-list">
            {p.documents.map((d) => (
              <li key={d.id}>
                <Link href={`/app/documents/${d.id}`} className="group-row">
                  <span className="row-icon">
                    <Icon name="documents" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.title}</span>
                    <span className="block truncate text-[13px] text-ink-3">{DOC_KINDS[d.kind]}</span>
                  </span>
                  <span className="text-ink-3">
                    <Icon name="chevron" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="opened-title" className="space-y-2">
        <h2 id="opened-title" className="section-title">
          When it was opened
        </h2>
        {p.access.length === 0 ? (
          <p className="rounded-2xl border border-line px-4 py-3 text-sm text-ink-2">Nobody has opened this link yet.</p>
        ) : (
          <ol className="group-list plain">
            {p.access.map((a, i) => (
              <li key={i} className="flex min-h-13 flex-col justify-center gap-0.5 px-4 py-2.5">
                <span className="text-[15px]">
                  {ACTION[a.action] ?? a.action}
                  {a.title && <span className="text-ink-2"> · {a.title}</span>}
                </span>
                <span className="text-[13px] text-ink-3">
                  <span className="font-mono" title="A fingerprint of the visitor's network, not their address">
                    visitor {a.visitor.slice(0, 6)}
                  </span>{" "}
                  · <time dateTime={a.at}>{timeOf(a.at, zone)}</time>
                </span>
              </li>
            ))}
          </ol>
        )}
        {p.moreAccess && <p className="px-1 text-xs text-ink-3">Showing the latest {PASSPORT_ACCESS_SHOWN}. Your export has every one.</p>}
      </section>

      {/* Turning off can't be undone, so it asks once first. */}
      {!revokedAt && !expired && (
        <ConfirmForm
          action={turnOff}
          fields={{ id: p.link.id }}
          trigger="Turn off this link"
          question={`Turn off this link? ${p.link.label} won't be able to open it again. You can make a new link any time.`}
          confirm="Turn off the link"
          pendingLabel="Turning off…"
        />
      )}
    </div>
  );
}
