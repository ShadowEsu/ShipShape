import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, fmtDay } from "@/components/app-ui";
import { fmtDateTime } from "@/components/ui";
import { DOC_KINDS } from "@/lib/server/documents";
import { getPassport } from "@/lib/server/passport";
import { requireWorkspace } from "@/lib/server/session";
import { turnOff } from "../actions";

export const metadata: Metadata = { title: "Passport link" };

const ACTION: Record<string, string> = { opened: "Opened the link", viewed: "Viewed", downloaded: "Downloaded" };

export default async function PassportDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace();
  const { id } = await params;
  const p = await getPassport(ctx, id);
  if (!p) notFound();
  const revokedAt = p.link.revoked_at;
  const off = revokedAt !== null;
  const expired = new Date(p.link.expires_at).getTime() < Date.now();

  return (
    <div className="max-w-3xl space-y-6">
      <nav className="text-sm">
        <Link href="/app/passport" className="text-ink-2 hover:underline">
          ← Passport
        </Link>
      </nav>
      <PageHeader eyebrow="Passport link" title={p.link.label} />
      {revokedAt ? (
        <Notice tone="info">Turned off {fmtDateTime(revokedAt)}. Nobody can open it any more.</Notice>
      ) : expired ? (
        <Notice>Expired {fmtDay(p.link.expires_at)}. Make a new link if they still need the documents.</Notice>
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

      {!off && !expired && (
        <form action={turnOff}>
          <input type="hidden" name="id" value={p.link.id} />
          <button className="btn-ghost">Turn off this link</button>
        </form>
      )}
    </div>
  );
}
