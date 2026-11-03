import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import { LINK_OUTS, TEMPLATES } from "@/lib/templates/catalog";

/**
 * Make in the redesigned app (Design spec 2026-11-02 §4, PR 7 plan): the templates as one grouped list, each row opening
 * its form; the SAFE row leaves for ycombinator.com in a new tab and says so (Design, 02 Nov). Same words as the current
 * page.
 */
export function MakeV2({ closed }: { closed: boolean }) {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader eyebrow="Make" title="Make a document" />
        <p className="max-w-2xl text-ink-2">
          Pick the document you need. ShipShape fills it from your business facts and shows where every value came from. You review
          every field. We only use official forms and openly licensed templates, and we never write or change their terms.
        </p>
        {/* Home's Make opens this page; while making real documents is closed, it says why (as each template's form does). */}
        {closed && <Notice>Making real documents opens after our security review.</Notice>}
      </div>
      <ul className="group-list stagger">
        {TEMPLATES.map((t, n) => (
          <li key={t.id} style={{ "--i": n }}>
            <Link href={`/app/make/${t.id}`} className="group-row py-3">
              <span className="row-icon self-start">
                <Icon name="make" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t.title}</span>
                <span className="block text-[13px] text-ink-2">{t.summary}</span>
                <span className="block text-[13px] text-ink-3">
                  {t.source.name} · {t.source.version} · {t.source.license}
                </span>
              </span>
              <span className="text-ink-3">
                <Icon name="chevron" size={16} />
              </span>
            </Link>
          </li>
        ))}
        {LINK_OUTS.map((l, n) => (
          <li key={l.id} style={{ "--i": TEMPLATES.length + n }}>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="group-row py-3">
              <span className="row-icon self-start">
                <Icon name="page" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{l.title}</span>
                <span className="block text-[13px] text-ink-2">{l.summary}</span>
                <span className="block text-[13px] text-ink-3">Link to the original · ycombinator.com · {l.license}</span>
                <span className="sr-only">, opens on ycombinator.com in a new tab</span>
              </span>
              <span aria-hidden="true" className="text-ink-3">
                ↗
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
