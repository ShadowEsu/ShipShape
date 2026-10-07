import Link from "next/link";
import { RULES } from "@/lib/rules";
import { store } from "@/lib/store";
import { ScoreRing, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const db = await store.read();
  const latest = new Map<string, (typeof db.scans)[number]>();
  for (const s of db.scans) if (!latest.has(s.target)) latest.set(s.target, s);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = RULES.filter((r) => /^\d/.test(r.effective) && r.effective >= today).sort((a, b) => a.effective.localeCompare(b.effective));

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Home</h1>
        <Link href="/app/scans/new" className="btn">New scan</Link>
      </div>

      {latest.size === 0 ? (
        <div className="card text-center">
          <p className="font-semibold">No scans yet</p>
          <p className="mt-1 text-sm text-slate-600">Paste a GitHub repo or a website to get your first report.</p>
          <Link href="/app/scans/new" className="btn mt-4">Run your first scan</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...latest.values()].map((s) => {
            const blockers = s.findings.filter((f) => f.severity === "blocker").length;
            return (
              <Link key={s.id} href={`/app/scans/${s.id}`} className="card flex items-center gap-4 hover:border-sea">
                <ScoreRing score={s.score} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{s.target}</p>
                  <p className="text-sm text-slate-600">{blockers} blockers · {s.findings.length} findings</p>
                  <p className="text-xs text-slate-500">Last checked {fmtDate(s.createdAt)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold">Laws and rules coming up</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {upcoming.length ? upcoming.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <a href={r.source.url} target="_blank" rel="noreferrer" className="hover:underline">{r.source.name}</a>
                <span className="shrink-0 text-slate-500">{r.effective}</span>
              </li>
            )) : <li className="text-slate-500">Nothing scheduled.</li>}
          </ul>
        </section>
        <section className="card">
          <h2 className="font-semibold">Recent activity</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {db.audit.slice(-6).reverse().map((a) => (
              <li key={a.seq}><span className="text-slate-500">{fmtDate(a.at)}</span> · {a.detail}</li>
            ))}
            {!db.audit.length && <li className="text-slate-500">No activity yet.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
