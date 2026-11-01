import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-ui";
import { LINK_OUTS, TEMPLATES } from "@/lib/templates/catalog";
import { requireWorkspace } from "@/lib/server/session";

export const metadata: Metadata = { title: "Make a document" };

export default async function MakePage() {
  await requireWorkspace();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Make" title="Make a document" />
      <p className="max-w-2xl text-ink-2">
        Pick the document you need. ShipShape fills it from your business facts and shows where every value came from. You review
        every field. We only use official forms and openly licensed templates, and we never write or change their terms.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {TEMPLATES.map((t) => (
          <li key={t.id} className="card flex flex-col gap-3">
            <p className="eyebrow">{t.source.name}</p>
            <h2 className="font-serif text-2xl font-semibold">{t.title}</h2>
            <p className="flex-1 text-sm text-ink-2">{t.summary}</p>
            <p className="text-xs text-ink-3">
              {t.source.version} · {t.source.license}
            </p>
            {/* "an NDA": letters read with a vowel sound take "an". */}
            <Link href={`/app/make/${t.id}`} className="btn self-start">
              Fill {/^[AEFHILMNORSX]/.test(t.short) ? "an" : "a"} {t.short}
            </Link>
          </li>
        ))}
        {LINK_OUTS.map((l) => (
          <li key={l.id} className="card flex flex-col gap-3">
            <p className="eyebrow">Link to the original</p>
            <h2 className="font-serif text-2xl font-semibold">{l.title}</h2>
            <p className="flex-1 text-sm text-ink-2">{l.summary}</p>
            <p className="text-xs text-ink-3">{l.license}</p>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="btn-ghost self-start">
              Open on ycombinator.com ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
