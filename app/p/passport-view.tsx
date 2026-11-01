import { NamedByWorkspace, ValidityChip, fmtDay } from "@/components/app-ui";
import type { PublicPassport } from "@/lib/server/passport";
import { validityOn } from "@/lib/today";

/**
 * What the person who opens a passport link sees: whose documents, which ones with their status, and a
 * download for each. The public page (/p) renders it for a valid link; the owner's preview renders the same
 * thing for the documents they are about to share, with downloads pointing at their own copies.
 */
export function PassportView({
  passport,
  today,
  contact,
  page,
  fileHref,
  heading: Heading = "h1",
}: {
  passport: PublicPassport;
  /** The viewer's date, so "current" means current where they are. */
  today: string;
  contact: string | null;
  /** The page's path, for the report link. */
  page: string;
  fileHref: (documentId: string) => string;
  /** The workspace name's heading level: h1 on the public page; h2 inside the owner's preview, whose own title is the h1. */
  heading?: "h1" | "h2";
}) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Heading className="font-serif text-4xl font-semibold tracking-tight">{passport.orgName}</Heading>
        <p className="text-ink-2">
          {passport.label} · this link works until {fmtDay(passport.expiresAt)}
        </p>
        <NamedByWorkspace contact={contact} page={page} />
      </header>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {passport.documents.map((d) => (
          <li key={d.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-xs tracking-wide text-ink-3 uppercase">{d.kindLabel}</p>
              <p className="font-medium">{d.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
                <ValidityChip validity={validityOn(d.expires_on, today)} expiresOn={d.expires_on} />
                {d.issuer && <span>Issued by {d.issuer}</span>}
              </div>
            </div>
            <a href={fileHref(d.id)} aria-label={`Download ${d.title}`} className="btn-ghost shrink-0 self-start sm:self-center">
              Download
            </a>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-3">
        {passport.orgName} shared these documents with you through ShipShape. Each download is recorded for them. ShipShape is
        document software, not a law firm; it doesn&apos;t check or vouch for what these documents say.
      </p>
    </div>
  );
}
