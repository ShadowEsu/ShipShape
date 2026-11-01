import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { PassportView } from "@/app/p/passport-view";
import { Notice, PageHeader } from "@/components/app-ui";
import { DOC_KINDS, listDocuments } from "@/lib/server/documents";
import { contactEmail } from "@/lib/server/flags";
import { PASSPORT_DAYS } from "@/lib/server/passport";
import { requireWorkspace } from "@/lib/server/session";

export const metadata: Metadata = { title: "Preview a passport link" };

const Ids = z.array(z.uuid()).max(50);

/**
 * What the person with the link will see, before the link exists (Design row 29): the same page as /p, built
 * from the documents ticked in the form, for the signed-in workspace only. Downloads point at the owner's own
 * copies; nothing is shared, logged or made here. The form's state travels in the address and back.
 */
export default async function PassportPreviewPage({ searchParams }: { searchParams: Promise<{ docs?: string; label?: string; days?: string }> }) {
  const [ctx, q] = await Promise.all([requireWorkspace(), searchParams]);
  const wanted = Ids.safeParse(typeof q.docs === "string" && q.docs ? q.docs.split(",") : []);
  const ids = wanted.success ? wanted.data : [];
  const label = typeof q.label === "string" ? q.label.trim().slice(0, 120) : "";
  const days = PASSPORT_DAYS.find((d) => String(d) === q.days) ?? PASSPORT_DAYS[1];
  const back = `/app/passport?${new URLSearchParams({ docs: ids.join(","), label, days: String(days) })}`;

  // Only this workspace's documents, in the order they were ticked; unknown ids (or another workspace's) drop out.
  const mine = await listDocuments(ctx);
  const documents = ids.flatMap((id) => {
    const d = mine.find((m) => m.id === id);
    return d ? [{ id: d.id, title: d.title, kind: d.kind, kindLabel: DOC_KINDS[d.kind], issuer: d.issuer, issued_on: d.issued_on, expires_on: d.expires_on }] : [];
  });
  const passport = {
    orgName: ctx.name,
    label: label || "Who is it for?",
    expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    documents,
  };

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link href={back} className="inline-flex min-h-6 items-center text-ink-2 hover:underline">
          ← Back to the link
        </Link>
      </nav>
      <PageHeader eyebrow="Passport" title="Preview what they'll see" />
      <Notice tone="info">
        This is the page someone who has the link will see. Nothing is shared yet: the link doesn&apos;t exist until you make it, and these
        downloads are your own copies.
      </Notice>
      {documents.length === 0 ? (
        <p className="text-ink-2">No documents are ticked yet. Go back and tick at least one.</p>
      ) : (
        <section aria-label="The recipient's page" className="rounded-3xl border border-line bg-canvas p-5 sm:p-8">
          <p className="eyebrow mb-6">ShipShape passport</p>
          <PassportView passport={passport} today={ctx.today} contact={contactEmail()} page="/app/passport/preview" fileHref={(id) => `/app/documents/${id}/file`} heading="h2" />
        </section>
      )}
    </div>
  );
}
