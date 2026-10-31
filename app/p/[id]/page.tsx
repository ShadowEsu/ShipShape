import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { NamedByWorkspace, ValidityChip, fmtDay } from "@/components/app-ui";
import { DropFragment, FragmentOpener } from "@/components/fragment-opener";
import { contactEmail } from "@/lib/server/flags";
import { clientIp, rateLimited } from "@/lib/server/http";
import { openPassport, PASSPORT_COOKIE } from "@/lib/server/passport";

export const metadata: Metadata = { title: "Shared documents", robots: { index: false, follow: false } };

const validity = (expiresOn: string | null) => {
  if (!expiresOn) return "none" as const;
  const days = (new Date(`${expiresOn}T00:00:00Z`).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? ("expired" as const) : days <= 30 ? ("expiring" as const) : ("ok" as const);
};

export default async function PassportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(PASSPORT_COOKIE)?.value;
  const ip = clientIp(await headers());
  const passport = token && !(await rateLimited("passport-view", ip, 60, 600)) ? await openPassport(id, token, ip) : null;

  return (
    <main id="main" className="mx-auto min-h-screen max-w-3xl px-5 py-12 sm:py-16">
      <p className="eyebrow mb-6">ShipShape passport</p>
      {token && <DropFragment />}
      {passport ? (
        <div className="space-y-8">
          <header className="space-y-2">
            <h1 className="font-serif text-4xl font-semibold tracking-tight">{passport.orgName}</h1>
            <p className="text-ink-2">
              {passport.label} · this link works until {fmtDay(passport.expiresAt)}
            </p>
            <NamedByWorkspace contact={contactEmail()} page={`/p/${id}`} />
          </header>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {passport.documents.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-xs tracking-wide text-ink-3 uppercase">{d.kindLabel}</p>
                  <p className="font-medium">{d.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
                    <ValidityChip validity={validity(d.expires_on)} expiresOn={d.expires_on} />
                    {d.issuer && <span>Issued by {d.issuer}</span>}
                  </div>
                </div>
                <a href={`/p/${id}/file?d=${d.id}`} className="btn-ghost shrink-0 self-start sm:self-center">
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
      ) : token ? (
        <Unavailable />
      ) : (
        <FragmentOpener openUrl={`/p/${id}/open`} unavailable={<Unavailable />} />
      )}
    </main>
  );
}

function Unavailable() {
  return (
    <div className="space-y-2">
      <h1 className="font-serif text-3xl font-semibold">This link isn&apos;t available</h1>
      <p className="text-ink-2">
        It may have expired or been turned off, or the address was copied without its last part. Ask the person who sent it for a
        new link.
      </p>
    </div>
  );
}
