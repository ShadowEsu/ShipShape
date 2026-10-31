import type { Metadata } from "next";
import { cookies } from "next/headers";
import { fmtDay } from "@/components/app-ui";
import { FragmentOpener } from "@/components/fragment-opener";
import { fmtDateTime } from "@/components/ui";
import { ESIGN_CONSENT_TEXT } from "@/lib/consent";
import { openSigning, SIGN_COOKIE } from "@/lib/server/esign";
import { SignForm } from "./sign-form";

export const metadata: Metadata = { title: "Sign a document", robots: { index: false, follow: false } };

export default async function SigningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await cookies()).get(SIGN_COOKIE)?.value;
  const view = token ? await openSigning(id, token) : null;

  return (
    <main id="main" className="mx-auto min-h-screen max-w-2xl px-5 py-12 sm:py-16">
      <p className="eyebrow mb-6">ShipShape signature request</p>
      {view ? (
        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{view.title}</h1>
            <p className="text-ink-2">
              {view.orgName} asked {view.signerName} to sign this document.
              {view.status === "pending" && <> The request is open until {fmtDay(view.expiresAt)}.</>}
            </p>
          </header>

          {view.status === "signed" ? (
            <section className="card space-y-3">
              <p className="font-semibold">
                <span aria-hidden="true">✓ </span>Signed{view.signedAt && <> {fmtDateTime(view.signedAt)}</>}
              </p>
              <p className="text-sm text-ink-2">The signed copy includes a certificate page recording how it was signed. Keep a copy for your records.</p>
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
                <SignForm id={id} signerName={view.signerName} email={view.signerEmail} consentText={ESIGN_CONSENT_TEXT} demo={view.demo} />
              </section>
            </>
          )}
          <p className="text-xs text-ink-3">
            ShipShape is document software, not a law firm. It records how this document was signed and doesn&apos;t vouch for what it says.
          </p>
        </div>
      ) : token ? (
        <Unavailable />
      ) : (
        <FragmentOpener openUrl={`/s/${id}/open`} unavailable={<Unavailable />} />
      )}
    </main>
  );
}

function Unavailable() {
  return (
    <div className="space-y-2">
      <h1 className="font-serif text-3xl font-semibold">This signing link isn&apos;t available</h1>
      <p className="text-ink-2">It may have expired, been withdrawn or already been used. Ask the person who sent it for a new link.</p>
    </div>
  );
}
