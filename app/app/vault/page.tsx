import Link from "next/link";
import { store } from "@/lib/store";
import { fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Vault() {
  const { documents } = await store.read();
  return (
    <>
      <h1 className="text-2xl font-bold">Document vault</h1>
      <p className="text-sm text-slate-600">Every version is kept and fingerprinted. Nothing is overwritten.</p>
      <div className="card divide-y divide-line p-0">
        {documents.map((d) => {
          const v = d.versions.at(-1)!;
          return (
            <Link key={d.id} href={`/app/vault/${d.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-foam">
              <div className="min-w-0">
                <p className="truncate font-medium">{d.title}</p>
                <p className="text-xs text-slate-500">v{v.version} · {fmtDate(v.createdAt)} · sha256 {v.sha256.slice(0, 12)}</p>
              </div>
              <span className="shrink-0 text-xs text-slate-500">{d.versions.length} versions</span>
            </Link>
          );
        })}
        {!documents.length && <p className="px-5 py-6 text-sm text-slate-500">No documents yet. Run a scan, then draft matching documents from its report.</p>}
      </div>
    </>
  );
}
