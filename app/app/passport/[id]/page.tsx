import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, fmtDay } from "@/components/app-ui";
import { ConfirmForm } from "@/components/confirm-form";
import { fmtDateTime } from "@/components/ui";
import { DOC_KINDS } from "@/lib/server/documents";
import { getPassport } from "@/lib/server/passport";
import { requireWorkspace } from "@/lib/server/session";
import { turnOff } from "../actions";

export const metadata: Metadata = { title: "Passport link" };

const ACTION: Record<string, string> = { opened: "Opened the link", viewed: "Viewed", downloaded: "Downloaded" };

/** What went wrong in a form posted from this page (see turnOff in ../actions.ts). */
const ERRORS: Record<string, string> = {
  off: "This link was already off, so nobody can open it. There's nothing more to do.",
};

export default async function PassportDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireWorkspace();
  const { id } = await params;
  const { error } = await searchParams;
  const formError = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;
  const p = await getPassport(ctx, id);
  if (!p) notFound();
  const revokedAt = p.link.revoked_at;
  const off = revokedAt !== null;
  const expired = new Date(p.link.expires_at).getTime() < Date.now();

  return (
    <div className="max-w-3xl space-y-6">
      <nav className="text-sm">
        <Link href="/app/passport" className="inline-flex min-h-6 items-center text-ink-2 hover:underline">
          ← Passport
        </Link>
      </nav>
      <PageHeader eyebrow="Passport link" title={p.link.label} />
      {formError && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {formError}
        </p>
      )}
      {revokedAt ? (
        <Notice tone="info">Turned off {fmtDateTime(revokedAt)}. Nobody can open it any more.</Notice>
      ) : expired ? (
        <div className="space-y-3">
          <Notice>Expired {fmtDay(p.link.expires_at)}, so nobody can open it. If they still need these documents, make a new link.</Notice>
          <Link href={`/app/passport?docs=${p.documents.map((d) => d.id).join(",")}`} className="btn">
            Make a new link with these documents
          </Link>
        </div>
      ) : (
        <p className="text-ink-2">Works until {fmtDay(p.link.expires_at)}. The link itself was shown once when you made it.</p>
      )}

      <section className="card space-y-2">
        <h2 className="font-semibold">Documents on this link</h2>
        <ul className="text-sm">
          {p.documents.map((d) => (
            <li key={d.id} className="flex justify-between gap-3 border-b border-line py-2 last:border-0">
              <Link href={`/app/documents/${d.id}`} className="hover:underline">
                {d.title}
              </Link>
              <span className="text-ink-3">{DOC_KINDS[d.kind]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Who opened it</h2>
        {p.access.length === 0 ? (
          <p className="text-sm text-ink-3">Nobody has opened this link yet.</p>
        ) : (
          <ol className="text-sm">
            {p.access.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-3 border-b border-line py-2 last:border-0">
                <span>
                  {ACTION[a.action] ?? a.action}
                  {a.title && <span className="text-ink-2"> · {a.title}</span>}
                </span>
                <span className="text-xs text-ink-3">
                  <span className="font-mono" title="A fingerprint of the visitor's network, not their address">
                    visitor {a.visitor.slice(0, 6)}
                  </span>{" "}
                  · <time dateTime={a.at}>{fmtDateTime(a.at)}</time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Turning off can't be undone, so it asks once first. */}
      {!off && !expired && (
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
