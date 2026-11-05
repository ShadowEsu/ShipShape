import type { Metadata } from "next";
import { PageHeader } from "@/components/app-ui";
import { aiEnabled } from "@/lib/server/ai";
import { uiV2 } from "@/lib/server/flags";
import { requireWorkspace } from "@/lib/server/session";
import { SAMPLE_REQUEST, SAMPLE_REQUEST_KEY } from "@/lib/server/start-here";
import { AskForm } from "./form";

export const metadata: Metadata = { title: "What are they asking for?" };

/** `?try=northwind` (a sample's Start here): the form opens with the request Northwind Builders sent already pasted. */
export default async function AskPage({ searchParams }: { searchParams: Promise<{ try?: string }> }) {
  const ctx = await requireWorkspace();
  const v2 = uiV2();
  const ai = aiEnabled();
  const pasted = ctx.demo && (await searchParams).try === SAMPLE_REQUEST_KEY ? SAMPLE_REQUEST : undefined;
  return (
    // The redesigned app reads a pasted email in the 720 column (Design 02 Nov); 1040 is too wide a line.
    <div className={v2 ? "mx-auto max-w-[720px] space-y-6" : "space-y-6"}>
      <PageHeader eyebrow="Check a request" title="What are they asking for?" />
      <p className="max-w-2xl text-ink-2">
        Paste the email or checklist a customer, landlord or general contractor sent you. ShipShape lists the documents it asks for and
        shows which ones you already have, which have expired, and which are missing.{" "}
        {ai
          ? "Only the text you paste is sent; it never sees your documents."
          : "It finds them by the names of documents in the text; the text stays on ShipShape and isn't kept."}
      </p>
      <AskForm v2={v2} ai={ai} pasted={pasted} />
    </div>
  );
}
