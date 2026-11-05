import Link from "next/link";
import { ValidityChip } from "@/components/app-ui";
import { Icon } from "@/components/icons";
import { DOC_KINDS, type DocRow } from "@/lib/server/documents";
import type { WaitingSignature, WaitingVendor } from "@/lib/server/home";
import type { SavedRow } from "@/lib/server/saved";
import type { StartPath } from "@/lib/server/start-here";
import type { Tool } from "@/lib/server/tools";
import { AiBox } from "./ai-box";
import { HairRow } from "./hair-row";
import { Arrive } from "./motion-moments";
import { savedLine } from "./saved/list";
import { StartHere } from "./start-here";

/**
 * Home (Design calm v2, look A): the question, the box and one row of tools on top; under them what has happened and
 * what's still out, each a hairline list. Every row is a real record of this workspace, and every chip a real column.
 * A sample also gets its Start here path between the top and Recent (ledger 461).
 */
export function HomeV2(props: {
  recent: DocRow[];
  /** The open signature requests, each with the day it was sent where the viewer is, and the vendors who owe a document. */
  waiting: { signatures: (WaitingSignature & { sentOn: string })[]; vendors: WaitingVendor[] };
  /** This person's newest saves; none, and the section isn't there (Design: absent, not empty). */
  saved: SavedRow[];
  /** The viewer's time zone, for a saved link's last day. */
  zone: string;
  tools: readonly Tool[];
  aiOn: boolean;
  /** A sample's Start here; null in a real workspace. */
  start: StartPath | null;
}) {
  const { recent, waiting, saved, zone, tools, aiOn, start } = props;
  const nothingWaiting = waiting.signatures.length === 0 && waiting.vendors.length === 0;
  return (
    <div className="space-y-12">
      <section className="home-top">
        <h1 id="home-title" className="home-title">
          What do you need to get done?
        </h1>
        <AiBox tools={tools} aiOn={aiOn} />
        <ToolRow tools={tools} />
      </section>

      {start && <StartHere path={start} />}

      <section aria-labelledby="recent-title">
        <SectionHead id="recent-title" title="Recent" all={recent.length > 0 ? "/app/documents" : null} />
        {recent.length === 0 ? (
          <p className="quiet-empty">The documents you add or make show up here.</p>
        ) : (
          <Arrive list="home-recent" className="hair-list">
            {recent.map((d) => (
              <HairRow
                key={d.id}
                href={`/app/documents/${d.id}`}
                icon="documents"
                title={d.title}
                line={d.issuer ? `${DOC_KINDS[d.kind]} · ${d.issuer}` : DOC_KINDS[d.kind]}
                chip={<ValidityChip validity={d.validity} expiresOn={d.expires_on} />}
              />
            ))}
          </Arrive>
        )}
      </section>

      {/* Waiting on others and Saved side by side from lg up, stacked on the phone (Design calm v2). */}
      <div className={saved.length > 0 ? "grid gap-12 lg:grid-cols-2 lg:gap-6" : undefined}>
        <section aria-labelledby="waiting-title" className="min-w-0">
          <SectionHead id="waiting-title" title="Waiting on others" all={waiting.signatures.length > 0 ? "/app/sent?tab=signatures" : null} />
          {nothingWaiting ? (
            <p className="quiet-empty">Signature requests nobody has signed yet, and vendors who still owe you a document, show up here.</p>
          ) : (
            <ul className="hair-list">
              {waiting.signatures.map((s) => (
                <HairRow
                  key={s.id}
                  href={`/app/documents/${s.documentId}`}
                  icon="sign"
                  title={s.title}
                  line={`${s.signerName} · sent ${s.sentOn}`}
                  chip={<span className="dot-chip">Not signed yet</span>}
                />
              ))}
              {waiting.vendors.map((v) => (
                <HairRow key={v.id} href={`/app/collect/${v.id}`} icon="collect" title={v.name} line={`Collect · ${v.outstanding.join(", ")}`} chip={<span className="dot-chip">Waiting</span>} />
              ))}
            </ul>
          )}
        </section>
        {saved.length > 0 && (
          <section aria-labelledby="saved-title" className="min-w-0">
            <SectionHead id="saved-title" title="Saved" all="/app/saved" />
            <ul className="hair-list">
              {saved.map((r) => (
                <HairRow
                  key={`${r.kind}-${r.id}`}
                  href={r.href}
                  icon={r.kind === "document" ? "documents" : "passport"}
                  title={r.kind === "document" ? r.title : r.label}
                  line={savedLine(r, zone)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
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
    <div className="mb-2.5 flex items-baseline justify-between gap-4">
      <h2 id={id} className="home-section-title">
        {title}
      </h2>
      {all && (
        // Three "View all" links on one page: each says which list it opens, starting with the words it shows.
        <Link href={all} aria-label={`View all ${title.toLowerCase()}`} className="text-[13px] text-ink-3 hover:text-ink">
          View all
        </Link>
      )}
    </div>
  );
}
