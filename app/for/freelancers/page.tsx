import type { Metadata } from "next";
import { type Ask, UseCasePage } from "@/components/use-case";
import { realDocsEnabled } from "@/lib/server/flags";

export const metadata: Metadata = {
  title: "For freelancers",
  description:
    "Fill the IRS W-9 and Common Paper's Mutual NDA from facts you enter once, keep every version, and share them with a new client as one link.",
  alternates: { canonical: "/for/freelancers" },
};

/** Each line checked against the code it describes (lib/server/fill.ts, sample.ts, passport.ts PASSPORT_DAYS). */
function asks(docs: boolean): Ask[] {
  return [
    {
      title: "A W-9 so they can pay you",
      body: "Filled on the official IRS form from your business facts, with the client's name as requester. If you use your Social Security number, you type it into each W-9; it's never saved in your business facts.",
      status: "Works today",
    },
    {
      title: "An NDA before they share details",
      body: "Common Paper's standard Mutual NDA, filled with both sides' names, titles and notice addresses. You choose how long it runs, how long information stays confidential and which state's law applies. ShipShape never changes the clauses.",
      status: "Works today",
    },
    docs
      ? {
          title: "Getting it signed",
          body: "A signature request with consent, a one-time code and a certificate page on the signed copy. In the sample today; for your own documents once ShipShape sends email.",
          status: "Awaiting setup",
        }
      : {
          title: "Getting it signed",
          body: "A signature request with consent, a one-time code and a certificate page on the signed copy.",
          status: "Works today",
        },
    {
      title: "One link for a new client",
      body: "Put the W-9, the NDA and anything else they asked for behind one link that lasts 7, 30 or 90 days. You see each time it's opened and which files were downloaded.",
      status: "Works today",
    },
    {
      title: "Every version, and who saw it",
      body: "Each document keeps its earlier versions and a history of every view, download, share and signature in ShipShape.",
      status: "Works today",
    },
  ];
}

export default function FreelancersPage() {
  const docs = realDocsEnabled();
  return (
    <UseCasePage
      eyebrow="For freelancers"
      title="A W-9 and an NDA before the first call, filled from facts you enter once."
      lede="A new client needs a W-9 to pay you, and often an NDA before they share the project. ShipShape fills both from your business facts, keeps every version, and sends them as one link."
      asksTitle="What a new client asks for, and what ShipShape does with it"
      asks={asks(docs)}
      sampleTitle="See it in the sample workspace"
      sampleIntro="The sample business is made up (a plumbing company, Harbor Plumbing LLC), but its first-client paperwork is the same as yours. Its dates count from the day you open it. In it you'll find:"
      sample={[
        "a W-9 filled for a client, Northwind Builders (also made up), from the sample's business facts;",
        "a Mutual NDA with Northwind Builders that runs for 1 year, keeps information confidential for 2 years under California law, and was signed by their project manager;",
        "a second signature request on the same NDA, still waiting for its signer;",
        "the signed copy with its certificate page, and each step (requested, code sent, signed) in History.",
      ]}
      limits={[
        "It fills the W-9 and the Mutual NDA today; your own contract or invoice templates aren't filled.",
        "It doesn't write or change contract terms, and doesn't tell you which documents a client needs.",
        "It's software, not a law firm, and doesn't give legal or tax advice.",
      ]}
      docs={docs}
    />
  );
}
