import { notFound } from "next/navigation";
import { SignForm } from "@/components/forms";
import { Logo, fmtDate } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await store.read();
  const req = db.signatures.find((s) => s.id === id);
  const doc = req && db.documents.find((d) => d.id === req.documentId);
  const version = doc?.versions.find((v) => v.version === req!.version);
  if (!req || !doc || !version) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Logo />
      <h1 className="text-2xl font-bold">{doc.title}</h1>
      <p className="text-sm text-slate-600">Sent to {req.signerName} ({req.signerEmail}) · version {version.version} · sha256 {version.sha256}</p>
      <article className="card max-h-[50vh] overflow-y-auto">
        <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{version.content}</pre>
      </article>
      {req.signed ? (
        <div className="card space-y-1 text-sm">
          <p className="font-semibold text-good">Signed</p>
          <p>Typed name: {req.signed.typedName}</p>
          <p>Signed: {fmtDate(req.signed.at)} from {req.signed.ip}</p>
          <p>Consent given: "{req.signed.consent}"</p>
          <p className="break-all text-xs text-slate-500">Document fingerprint: {req.sha256}</p>
        </div>
      ) : (
        <div className="card"><SignForm id={req.id} expectedName={req.signerName} /></div>
      )}
    </main>
  );
}
