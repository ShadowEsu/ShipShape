import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestSignatureForm } from "@/components/forms";
import { fmtDate } from "@/components/ui";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const { v } = await searchParams;
  const doc = (await store.read()).documents.find((d) => d.id === id);
  if (!doc) notFound();
  const version = doc.versions.find((x) => x.version === Number(v)) ?? doc.versions.at(-1)!;

  return (
    <>
      <h1 className="text-2xl font-bold">{doc.title}</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <article className="card">
          <p className="mb-3 text-xs text-slate-500">Version {version.version} · {fmtDate(version.createdAt)} · sha256 {version.sha256}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-6">{version.content}</pre>
        </article>
        <aside className="space-y-4">
          <div className="card">
            <h2 className="mb-2 font-semibold">Versions</h2>
            <ul className="space-y-1 text-sm">
              {doc.versions.slice().reverse().map((x) => (
                <li key={x.version}>
                  <Link href={`/app/vault/${doc.id}?v=${x.version}`} className={x.version === version.version ? "font-semibold text-sea" : "hover:underline"}>
                    v{x.version} · {fmtDate(x.createdAt)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h2 className="mb-2 font-semibold">Get it signed</h2>
            <RequestSignatureForm documentId={doc.id} />
          </div>
        </aside>
      </div>
    </>
  );
}
