import Link from "next/link";
import { store } from "@/lib/store";
import { fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ScanHistory() {
  const { scans } = await store.read();
  return (
    <>
      <h1 className="text-2xl font-bold">Scan history</h1>
      <div className="card divide-y divide-line p-0">
        {scans.map((s) => (
          <Link key={s.id} href={`/app/scans/${s.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-foam">
            <div className="min-w-0">
              <p className="truncate font-medium">{s.target}</p>
              <p className="text-xs text-slate-500">{fmtDate(s.createdAt)} · {s.kind === "repo" ? "Code" : "Live site"} · rules as of {s.rulesAsOf}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold">{s.score}/100</span>
          </Link>
        ))}
        {!scans.length && <p className="px-5 py-6 text-sm text-slate-500">No scans yet.</p>}
      </div>
    </>
  );
}
