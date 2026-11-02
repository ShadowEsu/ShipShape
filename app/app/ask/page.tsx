import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader } from "@/components/app-ui";
import { aiEnabled } from "@/lib/server/ai";
import { uiV2 } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { AskForm } from "./form";

export const metadata: Metadata = { title: "What are they asking for?" };

export default async function AskPage() {
  await requireWorkspace();
  const v2 = uiV2();
  return (
    // The redesigned app reads a pasted email in the 720 column (Design 02 Nov); 1040 is too wide a line.
    <div className={v2 ? "mx-auto max-w-[720px] space-y-6" : "space-y-6"}>
      <PageHeader eyebrow="Check a request" title="What are they asking for?" />
      <p className="max-w-2xl text-ink-2">
        Paste the email or checklist a customer, landlord or general contractor sent you. ShipShape lists the documents it asks for and
        shows which ones you already have, which have expired, and which are missing. Only the text you paste is sent; it never sees
        your documents.
      </p>
      {aiEnabled() ? (
        <AskForm v2={v2} />
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
