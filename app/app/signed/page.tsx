import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-ui";
import { listSignedCopies } from "@/lib/server/activity";
import { uiV2 } from "@/lib/server/flags";
import { requireWorkspace, viewerZone } from "@/lib/server/session";
import { dayOf } from "@/lib/today";
import { HairRow, StateChip } from "../hair-row";

export const metadata: Metadata = { title: "Signed copies" };

/**
 * Signed copies (calm v2): every document signed through ShipShape, newest signature first. Each opens the document,
 * where the signed copy is its own version with the signature certificate. Archived documents stay off (Security S5).
 */
export default async function SignedPage() {
  if (!uiV2()) notFound();
  const ctx = await requireWorkspace();
  const [rows, zone] = await Promise.all([listSignedCopies(ctx), viewerZone()]);
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <div className="space-y-2">
        <PageHeader eyebrow="Signed copies" title="Signed copies" />
        <p className="text-ink-2">Documents signed through ShipShape, each with its signature certificate.</p>
      </div>
      {rows.length === 0 ? (
        <p className="quiet-empty">When someone signs a document you sent for signature, the signed copy shows up here.</p>
      ) : (
        <ul className="hair-list">
          {rows.map((r) => (
            <HairRow
              key={r.id}
              href={`/app/documents/${r.documentId}`}
              icon="sign"
              title={r.title}
              line={`Signed by ${r.signerName}${r.signedAt ? ` · ${dayOf(r.signedAt, zone)}` : ""}${r.signedVersion ? ` · version ${r.signedVersion}` : ""}`}
              chip={<StateChip tone="ok">Signed</StateChip>}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
