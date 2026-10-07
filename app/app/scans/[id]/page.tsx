import { notFound } from "next/navigation";
import { GenerateDocsButton } from "@/components/forms";
import { ScoreRing, SeverityBadge, fmtDate } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Report({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scan = (await store.read()).scans.find((s) => s.id === id);
  if (!scan) notFound();
  const count = (sev: string) => scan.findings.filter((f) => f.severity === sev).length;

  return (
    <>
      <div className="card flex flex-wrap items-center gap-5">
        <ScoreRing score={scan.score} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{scan.target}</h1>
          <p className="text-sm text-slate-600">
            {count("blocker")} blockers · {count("missing-document")} missing documents · {count("warning")} warnings
          </p>
          <p className="text-xs text-slate-500">
            {scan.kind === "repo" ? "Code scan" : "Live site check"} on {fmtDate(scan.createdAt)} · rules as of {scan.rulesAsOf}
          </p>
        </div>
        <GenerateDocsButton scanId={scan.id} />
      </div>

      {scan.findings.length === 0 && (
        <div className="card">
          <p className="font-semibold text-good">No findings from the current rules.</p>
          <p className="text-sm text-slate-600">That is not a guarantee of approval or compliance. New rules are added as laws change.</p>
        </div>
      )}

      {scan.findings.map((f) => (
        <article key={f.ruleId} className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <span className="text-xs font-medium text-slate-500">{f.area}</span>
          </div>
          <h2 className="text-lg font-semibold">{f.title}</h2>
          <p className="text-sm text-slate-700">{f.summary}</p>
          <div className="rounded-lg bg-foam p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Proof</p>
            <ul className="space-y-1 font-mono text-xs">
              {f.evidence.map((e, i) => (
                <li key={i} className="break-all">
                  <span className="text-sea">{e.file}{e.line ? `:${e.line}` : ""}</span>
                  {e.snippet && <span className="text-slate-600">  {e.snippet}</span>}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-500">
            Rule: <a href={f.source.url} target="_blank" rel="noreferrer" className="underline">{f.source.name}</a> · effective {f.effective}
          </p>
        </article>
      ))}
    </>
  );
}
