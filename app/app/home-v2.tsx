import Link from "next/link";
import { ValidityChip } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import { PaperSvg } from "@/components/paper-svg";
import { attentionLine } from "@/lib/attention";
import { LETTER } from "@/lib/pdf/surface";
import { DOC_KINDS, type AttentionRow, type DocRow } from "@/lib/server/documents";
import type { WaitingSignature, WaitingVendor } from "@/lib/server/home";
import type { PassportRow } from "@/lib/server/passport";
import type { SamplePreview } from "@/lib/server/sample";
import type { StartPath } from "@/lib/server/start-here";
import type { Tool } from "@/lib/server/tools";
import { dayOf, fmtDay } from "@/lib/today";
import { AiBox } from "./ai-box";
import { HairRow, StateChip } from "./hair-row";
import { Arrive } from "./motion-moments";
import { StartHere } from "./start-here";

/** How many of what needs you Home lists; Deadlines has every date. */
const NEEDS_SHOWN = 5;

/**
 * Home (Design SC, 4 Nov; Quiet): one 720px column. The question and the ask box are the primary job, with one row of
 * tools under it. A sample's Start here comes next (#44, its primary path). Then what needs you (each a row with its
 * state as a dot and a word), your papers (their first pages where the server drew one: only a sample's own; any other
 * paper is its title row), and what's shared with others. Every row is a real record of this workspace.
 */
export function HomeV2(props: {
  /** Home's "Needs attention" (lib/server/documents.ts homeSummary): most urgent first, and how many there are. */
  needs: AttentionRow[];
  needsTotal: number;
  /** The viewer's day, and whether a renewed copy can be added here: what each row says and where it goes. */
  today: string;
  canUpload: boolean;
  /** The newest papers, and the first pages the server drew for them (a sample's own only), by id. */
  papers: DocRow[];
  previews: ReadonlyMap<string, SamplePreview>;
  /** The open signature requests, each with the day it was sent where the viewer is, and the vendors who owe a document. */
  waiting: { signatures: (WaitingSignature & { sentOn: string })[]; vendors: WaitingVendor[] };
  /** Shared's passport links: the newest that still work (page.tsx reads at most WAITING_MAX). */
  links: PassportRow[];
  zone: string;
  tools: readonly Tool[];
  aiOn: boolean;
  /** A sample's Start here; null in a real workspace. */
  start: StartPath | null;
}) {
  const { needs, needsTotal, today, canUpload, papers, previews, waiting, links, zone, tools, aiOn, start } = props;
  const drawn = papers.flatMap((doc) => {
    const preview = previews.get(doc.id);
    return preview ? [{ doc, preview }] : [];
  });
  const plain = papers.filter((d) => !previews.has(d.id));
  const nothingShared = links.length === 0 && waiting.signatures.length === 0 && waiting.vendors.length === 0;
  return (
    <div className="mx-auto max-w-[720px] space-y-12">
      <section className="home-top">
        <h1 id="home-title" className="home-title">
          What do you need to get done?
        </h1>
        <AiBox tools={tools} aiOn={aiOn} />
        <ToolRow tools={tools} />
      </section>

      {start && <StartHere path={start} />}

      <section aria-labelledby="needs-title">
        <SectionHead id="needs-title" title="Needs you" all={needsTotal > 0 ? "/app/deadlines" : null} />
        {needs.length === 0 ? (
          <p className="quiet-empty">Nothing has expired, expires, or has a renewal notice due in the next 30 days.</p>
        ) : (
          <Arrive list="home-needs" className="hair-list">
            {needs.slice(0, NEEDS_SHOWN).map((d) => {
              const line = attentionLine(d, today, canUpload);
              return (
                <HairRow
                  key={d.id}
                  href={line.href}
                  icon="documents"
                  title={d.title}
                  line={`${DOC_KINDS[d.kind]} · ${line.state}`}
                  chip={
                    line.renewal ? (
                      <StateChip tone="expiring">Renewal notice · {fmtDay(d.attention_on)}</StateChip>
                    ) : (
                      <ValidityChip validity={d.validity} expiresOn={d.expires_on} />
                    )
                  }
                />
              );
            })}
          </Arrive>
        )}
      </section>

      <section aria-labelledby="papers-title">
        <SectionHead id="papers-title" title="Your papers" all={papers.length > 0 ? "/app/documents" : null} />
        {papers.length === 0 ? (
          <p className="quiet-empty">The documents you add or make show up here.</p>
        ) : (
          <div className="space-y-4">
            {drawn.length > 0 && (
              <ul className="grid grid-cols-3 gap-3 sm:gap-4">
                {drawn.map(({ doc, preview }) => (
                  <li key={doc.id} className="min-w-0">
                    <PaperThumb doc={doc} preview={preview} />
                  </li>
                ))}
              </ul>
            )}
            {plain.length > 0 && (
              <ul className="hair-list">
                {plain.map((d) => (
                  <HairRow
                    key={d.id}
                    href={`/app/documents/${d.id}`}
                    icon="documents"
                    title={d.title}
                    line={d.issuer ? `${DOC_KINDS[d.kind]} · ${d.issuer}` : DOC_KINDS[d.kind]}
                    chip={<ValidityChip validity={d.validity} expiresOn={d.expires_on} />}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="shared-title">
        <SectionHead id="shared-title" title="Shared" all={links.length > 0 ? "/app/passport" : null} />
        {nothingShared ? (
          <p className="quiet-empty">Links you share, signature requests nobody has signed yet, and vendors who still owe you a document show up here.</p>
        ) : (
          <ul className="hair-list">
            {links.map((l) => (
              <HairRow
                key={l.id}
                href={`/app/passport/${l.id}`}
                icon="passport"
                title={l.label}
                line={`${l.documents} ${l.documents === 1 ? "document" : "documents"} · opened ${l.opens} ${l.opens === 1 ? "time" : "times"} · until ${dayOf(l.expires_at, zone)}`}
                chip={<StateChip tone="ok">Working</StateChip>}
              />
            ))}
            {waiting.signatures.map((s) => (
              <HairRow
                key={s.id}
                href={`/app/documents/${s.documentId}`}
                icon="sign"
                title={s.title}
                line={`${s.signerName} · sent ${s.sentOn}`}
                chip={<StateChip tone="none">Not signed yet</StateChip>}
              />
            ))}
            {waiting.vendors.map((v) => (
              <HairRow
                key={v.id}
                href={`/app/collect/${v.id}`}
                icon="collect"
                title={v.name}
                line={`Collect · ${v.outstanding.join(", ")}`}
                chip={<StateChip tone="none">Waiting</StateChip>}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * A paper's first page as Home's thumbnail (Design SC): the top of the page in a 5:4 crop with 12px corners and a 1px
 * line, no shadow, its title in 13px under it. The drawing is the server's (samplePaperPreview), so nothing is read to
 * show it; the link names the paper.
 */
function PaperThumb({ doc, preview }: { doc: DocRow; preview: SamplePreview }) {
  return (
    <Link href={`/app/documents/${doc.id}`} className="group block space-y-2">
      <span className="block aspect-[5/4] overflow-hidden rounded-xl border border-line bg-paper">
        {"marks" in preview ? (
          <PaperSvg marks={preview.marks} width={LETTER.w} height={LETTER.h} className="block h-auto w-full" />
        ) : (
          <img src={preview.images.crop.src} width={preview.images.crop.width} height={preview.images.crop.height} alt="" decoding="async" className="block h-auto w-full" />
        )}
      </span>
      <span className="line-clamp-2 block text-[13px] leading-[1.4] text-ink group-hover:underline">{doc.title}</span>
    </Link>
  );
}

/** Every tool as an icon in a hairline square with its one-word name; a closed one is dashed and says why in its name and tooltip. */
export function ToolRow({ tools }: { tools: readonly Tool[] }) {
  return (
    <ul id="tools" aria-label="Tools" className="tool-row scroll-mt-20">
      {tools.map((t) => (
        <li key={t.id}>
          <Link href={t.href} className={`tool press${t.closed ? " closed" : ""}`} title={t.closed && t.tag ? t.tag : t.name}>
            <span className="tool-square">
              <Icon name={t.icon} />
            </span>
            {t.short}
            {t.closed && t.tag && <span className="sr-only">: {t.tag}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SectionHead({ id, title, all }: { id: string; title: string; all: string | null }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 id={id} className="home-section-title">
        {title}
      </h2>
      {all && (
        // Three "View all" links on one page: each says which list it opens, starting with the words it shows.
        <Link href={all} aria-label={`View all ${title.toLowerCase()}`} className="text-[13px] text-ink-2 hover:text-ink">
          View all
        </Link>
      )}
    </div>
  );
}
