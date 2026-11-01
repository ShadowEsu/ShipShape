import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { aiEnabled } from "@/lib/server/ai";
import { requireWorkspace } from "@/lib/server/session";
import { AskForm } from "./form";

export const metadata: Metadata = { title: "What are they asking for?" };

export default async function AskPage() {
  await requireWorkspace();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Read a request" title="What are they asking for?" />
      <p className="max-w-2xl text-ink-2">
        Paste the email or checklist a customer, landlord or general contractor sent you. ShipShape lists the documents it asks for and
        shows which ones you already have, which have expired, and which are missing. Only the text you paste is sent; it never sees
        your documents.
      </p>
      {aiEnabled() ? (
        <AskForm />
      ) : (
        <Notice tone="info">
          Reading requests with AI is switched off right now, so check the request against your documents yourself; everything else works as
          usual.{" "}
          <Link href="/app/documents" className="underline">
            Open your documents
          </Link>
        </Notice>
      )}
    </div>
  );
}
