import Link from "next/link";
import { ValidityChip } from "@/components/app-ui";
import { Icon, type IconName } from "@/components/icons";
import { DOC_KINDS, type DocRow } from "@/lib/server/documents";
import type { WaitingSignature, WaitingVendor } from "@/lib/server/home";
import type { Tool } from "@/lib/server/tools";
import { AiBox } from "./ai-box";

/**
 * Home (Design calm v2, look A): the question, the box and one row of tools on top; under them what has happened and
 * what's still out, each a hairline list. Every row is a real record of this workspace, and every chip a real column.
 */
export function HomeV2(props: {
  recent: DocRow[];
  /** The open signature requests, each with the day it was sent where the viewer is, and the vendors who owe a document. */
  waiting: { signatures: (WaitingSignature & { sentOn: string })[]; vendors: WaitingVendor[] };
  tools: readonly Tool[];
  aiOn: boolean;
}) {
  const { recent, waiting, tools, aiOn } = props;
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

      <section aria-labelledby="recent-title">
        <SectionHead id="recent-title" title="Recent" all={recent.length > 0 ? "/app/documents" : null} />
        {recent.length === 0 ? (
          <p className="quiet-empty">The documents you add or make show up here.</p>
        ) : (
          <ul className="hair-list">
            {recent.map((d) => (
              <Row
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
      </section>

      <section aria-labelledby="waiting-title">
        <SectionHead id="waiting-title" title="Waiting on others" all={null} />
        {nothingWaiting ? (
          <p className="quiet-empty">Signature requests nobody has signed yet, and vendors who still owe you a document, show up here.</p>
        ) : (
          <ul className="hair-list">
            {waiting.signatures.map((s) => (
              <Row
                key={s.id}
                href={`/app/documents/${s.documentId}`}
                icon="sign"
                title={s.title}
                line={`${s.signerName} · sent ${s.sentOn}`}
                chip={<span className="dot-chip">Not signed yet</span>}
              />
            ))}
            {waiting.vendors.map((v) => (
              <Row key={v.id} href={`/app/collect/${v.id}`} icon="collect" title={v.name} line={`Collect · ${v.outstanding.join(", ")}`} chip={<span className="dot-chip">Waiting</span>} />
            ))}
          </ul>
        )}
      </section>
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
        <Link href={all} className="text-[13px] text-ink-3 hover:text-ink">
          View all
        </Link>
      )}
    </div>
  );
}

/**
 * A hairline row. From sm up: icon, title over meta, the chip, the chevron. On the phone the title and meta wrap and the
 * chip goes under them (Design MUST-1, 3 Nov: a dated chip beside the title cut it to "Certificate …").
 */
function Row({ href, icon, title, line, chip }: { href: string; icon: IconName; title: string; line: string; chip: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="hair-row">
        <span className="hair-icon row-icon">
          <Icon name={icon} size={17} />
        </span>
        <span className="hair-text">
          <span className="hair-title">{title}</span>
          <span className="hair-meta">{line}</span>
        </span>
        <span className="hair-chip">{chip}</span>
        <span className="hair-chev">
          <Icon name="chevron" size={16} />
        </span>
      </Link>
    </li>
  );
}
