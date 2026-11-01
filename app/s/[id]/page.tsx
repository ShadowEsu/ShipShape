import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { DownloadBusy, LinkBusy, LinkUnavailable } from "@/app/link-states";
import { NamedByWorkspace } from "@/components/app-ui";
import { DropFragment, FragmentOpener } from "@/components/fragment-opener";
import { fmtDateTime } from "@/components/ui";
import { ESIGN_CONSENT_TEXT } from "@/lib/consent";
import { openSigning, SIGN_COOKIE } from "@/lib/server/esign";
import { contactEmail } from "@/lib/server/flags";
import { clientIp, rateLimited } from "@/lib/server/http";
import { linkEnd } from "@/lib/server/links";
import { viewerZone } from "@/lib/server/session";
import { dayOf } from "@/lib/today";
import { SignForm } from "./sign-form";

export const metadata: Metadata = { title: "Sign a document", robots: { index: false, follow: false } };

/** `r` comes from the download route when it refused: its own limit (`busy`), or the token cookie gone (`reopen`). */
export default async function SigningPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ r?: string }> }) {
  const [{ id }, { r }] = await Promise.all([params, searchParams]);
  const zone = await viewerZone();
  const token = (await cookies()).get(SIGN_COOKIE)?.value;
  // Same view limit as passport and upload pages (Security F8).
  const busy = token ? await rateLimited("sign-view", clientIp(await headers()), 60, 600) : false;
  const view = token && !busy ? await openSigning(id, token) : null;
  const end = token && !busy && !view ? await linkEnd("s", id, token) : null;

  return (
    <main id="main" className="mx-auto min-h-screen max-w-2xl px-5 py-12 sm:py-16">
      <p className="eyebrow mb-6">ShipShape signature request</p>
      {token && <DropFragment />}
      {view ? (
        <div className="space-y-6">
          {r === "busy" && <DownloadBusy />}
          <header className="space-y-2">
            <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{view.title}</h1>
            <p className="text-ink-2">
              {view.orgName} asked {view.signerName} to sign this document.
              {view.status === "pending" && <> You can sign until {dayOf(view.expiresAt, zone)}.</>}
            </p>
            <NamedByWorkspace contact={contactEmail()} page={`/s/${id}`} />
          </header>

          {view.status === "signed" ? (
            <section className="card space-y-3">
              <p className="font-semibold">
                <span aria-hidden="true">✓ </span>Signed{view.signedAt && <> {fmtDateTime(view.signedAt)}</>}
              </p>
              {/* True to completeSigning (lib/server/esign.ts): the signed copy becomes the newest version of the sender's
                  document, and the appended certificate records the typed name, the time, the emailed one-time code and a
                  keyed hash of the signer's network address (never the address itself). */}
              <p className="text-sm text-ink-2">
                There&apos;s nothing else you need to do. {view.orgName} has the same signed copy, saved to their documents in ShipShape. The
                certificate at the end records the name you typed, when you signed, that a code sent to your email confirmed it, and a
                fingerprint of your network connection (not your address). Download yours for your records; this link works until{" "}
                {dayOf(view.expiresAt, zone)}.
              </p>
              <a href={`/s/${id}/file`} className="btn self-start">
                Download the signed copy
              </a>
            </section>
          ) : (
            <>
              <section className="card space-y-3">
                <h2 className="font-semibold">1. Read the document</h2>
                <p className="text-sm text-ink-2">Download it and read it in full before you sign. If anything is unclear, ask the sender or a lawyer first.</p>
                <a href={`/s/${id}/file`} className="btn-ghost self-start">
                  Download to read
                </a>
              </section>
              <section className="card space-y-3">
                <h2 className="font-semibold">2. Sign</h2>
                <SignForm
                  id={id}
                  title={view.title}
                  sender={view.orgName}
                  signerName={view.signerName}
                  email={view.signerEmail}
                  consentText={ESIGN_CONSENT_TEXT}
                  demo={view.demo}
                />
              </section>
            </>
          )}
          <p className="text-xs text-ink-3">
            ShipShape is document software, not a law firm. It records how this document was signed and doesn&apos;t vouch for what it says.
          </p>
        </div>
      ) : busy ? (
        <LinkBusy href={`/s/${id}`} />
      ) : token ? (
        <LinkUnavailable noun="signing link" why="closed" end={end} zone={zone} expiredAsk="Ask whoever sent it for a new link, or for a copy of what you signed." />
      ) : (
        <FragmentOpener
          openUrl={`/s/${id}/open`}
          opening="Opening the document to sign…"
          unavailable={<LinkUnavailable noun="signing link" why={r === "reopen" ? "stale" : "incomplete"} undone="the download didn't start" zone={zone} />}
        />
      )}
    </main>
  );
}
