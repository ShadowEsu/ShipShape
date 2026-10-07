import Link from "next/link";
import { fmtDate } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Signatures() {
  const { signatures, documents } = await store.read();
  const title = (id: string) => documents.find((d) => d.id === id)?.title ?? "Deleted document";
  return (
    <>
      <h1 className="text-2xl font-bold">Signatures</h1>
      <p className="text-sm text-slate-600">Each signature is tied to the fingerprint of the exact version that was signed.</p>
      <div className="space-y-3">
        {signatures.map((s) => (
          <div key={s.id} className="card space-y-1 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{title(s.documentId)} · v{s.version}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === "signed" ? "bg-green-50 text-good" : "bg-amber-50 text-warn"}`}>
                {s.status === "signed" ? "Signed" : "Waiting"}
              </span>
            </div>
            <p className="text-slate-600">{s.signerName} · {s.signerEmail} · requested {fmtDate(s.createdAt)}</p>
            {s.signed ? (
              <p className="text-xs text-slate-500">
                Signed as "{s.signed.typedName}" on {fmtDate(s.signed.at)} from {s.signed.ip} · document sha256 {s.sha256.slice(0, 16)}
              </p>
            ) : (
              <p className="text-xs">Signing link: <Link href={`/sign/${s.id}`} className="text-sea underline">/sign/{s.id}</Link></p>
            )}
          </div>
        ))}
        {!signatures.length && <div className="card text-sm text-slate-500">No signature requests yet. Open a document in the vault to send one.</div>}
      </div>
    </>
  );
}
