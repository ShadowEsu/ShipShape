import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { realDocsEnabled } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { NewDocumentForm } from "../forms";

export const metadata: Metadata = { title: "Add a document" };

export default async function NewDocumentPage() {
  const ctx = await requireWorkspace();
  const open = !ctx.demo && realDocsEnabled();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader eyebrow="Vault" title="Add a document" />
      {open ? (
        <div className="card">
          <NewDocumentForm />
        </div>
      ) : (
        <Notice>
          {ctx.demo
            ? "This is a sample workspace, so it can't take real files. "
            : "Uploading real documents opens after our security review. "}
          You can still{" "}
          <Link href="/app/make" className="underline">
            make a document from a template
          </Link>{" "}
          with the sample business facts.
        </Notice>
      )}
      <p className="text-sm text-ink-2">
        Files are stored privately for your workspace. Links to them last five minutes, and every view and download goes into the
        document&apos;s history. We never use your documents to train AI.
      </p>
    </div>
  );
}
