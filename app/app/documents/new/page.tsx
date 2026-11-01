import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { HashLanding } from "@/components/hash-landing";
import { realDocsEnabled } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { NewDocumentForm } from "../forms";

export const metadata: Metadata = { title: "Add a document" };

export default async function NewDocumentPage() {
  const ctx = await requireWorkspace();
  const open = !ctx.demo && realDocsEnabled();
  return (
    <div className="max-w-2xl space-y-6">
      <HashLanding />
      <PageHeader eyebrow="Documents" title="Add a document" />
      {open ? (
        <div className="card">
          <NewDocumentForm />
        </div>
      ) : (
        <Notice>
          {ctx.demo ? (
            <>
              This is a sample workspace, so it can&apos;t take real files. You can still{" "}
              <Link href="/app/make" className="underline">
                make a document from a template
              </Link>{" "}
              with the sample business facts.
            </>
          ) : (
            <>
              Uploading real documents opens after our security review. Until then, the sample workspace shows how documents work here:
              sign out, then choose &ldquo;Try the sample workspace&rdquo;.
            </>
          )}
        </Notice>
      )}
      <p className="text-sm text-ink-2">
        Files are stored privately for your workspace. Links to them last five minutes, and every view and download goes into the
        document&apos;s history. We never use your documents to train AI.
      </p>
    </div>
  );
}
