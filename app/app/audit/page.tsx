import { fmtDate } from "@/components/ui";
import { store, verifyAuditChain } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Audit() {
  const { audit } = await store.read();
  const intact = verifyAuditChain(audit);
  return (
    <>
      <h1 className="text-2xl font-bold">Audit log</h1>
      <p className={`text-sm font-semibold ${intact ? "text-good" : "text-blocker"}`}>
        {intact ? "Chain intact: no entry has been changed or removed." : "Warning: the chain is broken. An entry was changed or removed."}
      </p>
      <div className="card divide-y divide-line p-0 text-sm">
        {audit.slice().reverse().map((a) => (
          <div key={a.seq} className="px-5 py-3">
            <p><span className="font-mono text-xs text-slate-500">#{a.seq}</span> {a.detail}</p>
            <p className="text-xs text-slate-500">{fmtDate(a.at)} · {a.action} · hash {a.hash.slice(0, 12)}</p>
          </div>
        ))}
        {!audit.length && <p className="px-5 py-6 text-slate-500">Nothing yet.</p>}
      </div>
    </>
  );
}
