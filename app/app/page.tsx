import Link from "next/link";
import { ValidityChip } from "@/components/app-ui";
import { DOC_KINDS, listDocuments } from "@/lib/server/documents";
import { requireWorkspace } from "@/lib/server/session";

const TASKS = [
  { href: "/app/make/irs-w9", title: "Send a W-9", body: "Filled from your business facts in a minute." },
  { href: "/app/make/common-paper-mnda", title: "Start an NDA", body: "Common Paper's mutual NDA, cover page filled for you." },
  { href: "/app/documents/new", title: "Add a certificate or license", body: "Keep it with its dates so nothing lapses." },
];

export default async function AppHome() {
  const ctx = await requireWorkspace();
  const docs = await listDocuments(ctx);
  const attention = docs.filter((d) => d.validity === "expired" || d.validity === "expiring");
  const current = docs.filter((d) => d.validity === "ok" || d.validity === "none").length;

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <p className="eyebrow">{ctx.name}</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">What do you need to get done?</h1>
      </section>

      <ul className="grid gap-3 sm:grid-cols-3">
        {TASKS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="card block h-full hover:border-ink">
              <span className="block font-semibold">{t.title}</span>
              <span className="mt-1 block text-sm text-ink-2">{t.body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl font-semibold">Needs attention</h2>
          <p className="text-sm text-ink-2">
            {current} of {docs.length} documents current
          </p>
        </div>
        {attention.length === 0 ? (
          <p className="card text-sm text-ink-2">Nothing has expired or expires in the next 30 days.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {attention.map((d) => (
              <li key={d.id}>
                <Link href={`/app/documents/${d.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{d.title}</span>
                    <span className="ml-2 text-sm text-ink-3">{DOC_KINDS[d.kind]}</span>
                  </span>
                  <ValidityChip validity={d.validity} expiresOn={d.expires_on} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
