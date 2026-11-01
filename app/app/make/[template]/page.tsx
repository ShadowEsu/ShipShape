import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader } from "@/components/app-ui";
import { ACK_TEXT } from "@/lib/legal";
import { FACT_LABELS, STALE_AFTER_DAYS } from "@/lib/profile-fields";
import { prefill } from "@/lib/server/fill";
import { canSaveFacts } from "@/lib/server/documents";
import { realDocsEnabled } from "@/lib/server/flags";
import { loadProfile } from "@/lib/server/profile";
import { requireWorkspace } from "@/lib/server/session";
import { templateById } from "@/lib/templates/catalog";
import { FillForm, type FactChip } from "./fill-form";

export const metadata: Metadata = { title: "Fill a document" };

// Which business fact each fact-backed field draws on, for its "confirmed" date.
const FACT_KEY: Record<string, string> = { address: "address_line1", city_state_zip: "city", entity_type: "entity_type" };

export default async function FillPage({ params }: { params: Promise<{ template: string }> }) {
  const ctx = await requireWorkspace();
  const { template: id } = await params;
  const t = templateById(id);
  if (!t) notFound();
  if (!ctx.demo && !realDocsEnabled()) {
    return (
      <div className="max-w-2xl space-y-6">
        <PageHeader eyebrow="Make" title={t.title} />
        <Notice>
          Making real documents opens after our security review. To try every template now, sign out, then choose &ldquo;Try the sample
          workspace&rdquo;.
        </Notice>
      </div>
    );
  }

  const profile = await loadProfile(ctx);
  // The browser only ever gets the masked EIN; the full number is added on the server when the PDF is made.
  const initial = prefill(t, { values: profile.values, ein: null, einLast4: profile.einLast4 }, ctx.today);
  const chips: Record<string, FactChip> = {};
  for (const f of t.fields) {
    if (!f.fact) continue;
    const key = FACT_KEY[f.fact] ?? f.fact;
    const at = profile.confirmed[key];
    const ageDays = at ? (Date.now() - new Date(at).getTime()) / 86_400_000 : Infinity;
    chips[f.key] = {
      label: FACT_LABELS[key] ?? key,
      confirmedAt: at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
      stale: ageDays > STALE_AFTER_DAYS,
    };
  }

  return (
    <div className="max-w-3xl space-y-6">
      <nav className="text-sm">
        <Link href="/app/make" className="inline-flex min-h-6 items-center text-ink-2 hover:underline">
          ← Make a document
        </Link>
      </nav>
      <PageHeader eyebrow={`${t.source.name} · ${t.source.version}`} title={t.title} />
      <p className="text-ink-2">
        {t.summary}{" "}
        {t.source.instructions && (
          <a href={t.source.instructions} target="_blank" rel="noopener noreferrer" className="underline">
            Read the official instructions ↗
          </a>
        )}
      </p>
      <p className="text-sm text-ink-3">
        Fields marked “From Business facts” were filled from facts you confirmed. Change anything that isn&apos;t right for this
        document; your saved facts stay as they are.
      </p>
      <FillForm template={t} initial={initial} chips={chips} ackText={ACK_TEXT} canSaveFacts={canSaveFacts(ctx)} member={ctx.role === "member"} />
    </div>
  );
}
