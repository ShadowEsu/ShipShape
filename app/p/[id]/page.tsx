import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { LinkBusy, LinkUnavailable } from "@/app/link-states";
import { PassportView } from "@/app/p/passport-view";
import { DropFragment, FragmentOpener } from "@/components/fragment-opener";
import { contactEmail } from "@/lib/server/flags";
import { clientIp, rateLimited } from "@/lib/server/http";
import { linkEnd } from "@/lib/server/links";
import { openPassport, PASSPORT_COOKIE } from "@/lib/server/passport";
import { viewerToday } from "@/lib/server/session";

export const metadata: Metadata = { title: "Shared documents", robots: { index: false, follow: false } };

export default async function PassportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(PASSPORT_COOKIE)?.value;
  const ip = clientIp(await headers());
  const busy = token ? await rateLimited("passport-view", ip, 60, 600) : false;
  const passport = token && !busy ? await openPassport(id, token, ip) : null;
  // Only once the open came back empty, for the same token: why (ran out, or turned off), nothing else.
  const end = token && !busy && !passport ? await linkEnd("p", id, token) : null;
  // The outsider's own date: a document is current through its last day where they are, as in the app.
  const today = await viewerToday();

  return (
    <main id="main" className="mx-auto min-h-screen max-w-3xl px-5 py-12 sm:py-16">
      <p className="eyebrow mb-6">ShipShape passport</p>
      {token && <DropFragment />}
      {passport ? (
        <PassportView passport={passport} today={today} contact={contactEmail()} page={`/p/${id}`} fileHref={(d) => `/p/${id}/file?d=${d}`} />
      ) : busy ? (
        <LinkBusy href={`/p/${id}`} />
      ) : token ? (
        <LinkUnavailable noun="link" why="closed" end={end} />
      ) : (
        <FragmentOpener openUrl={`/p/${id}/open`} opening="Opening the shared documents…" unavailable={<LinkUnavailable noun="link" why="incomplete" />} />
      )}
    </main>
  );
}
