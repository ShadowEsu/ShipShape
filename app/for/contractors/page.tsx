import type { Metadata } from "next";
import { type Ask, UseCasePage } from "@/components/use-case";
import { realDocsEnabled } from "@/lib/server/flags";

export const metadata: Metadata = {
  title: "For contractors",
  description:
    "Keep your W-9, certificate of insurance and licenses together, see what's about to lapse, and send a general contractor the whole set as one link.",
  alternates: { canonical: "/for/contractors" },
};

/** Each line checked against the code it describes (lib/server/sample.ts, passport.ts PASSPORT_DAYS, deadlines.ts). */
function asks(docs: boolean): Ask[] {
  // Uploading your own files opens with real documents; the sample already holds a certificate and licenses to look at.
  const own: Ask["status"] = docs ? "Works today" : "Awaiting setup";
  const ownNote = docs ? "" : " Adding your own opens with real accounts; the sample has one to look at.";
  return [
    {
      title: "Your W-9",
      body: "Filled on the official IRS form from the business facts you confirmed once, with the general contractor's name as requester. You check every field before it's saved.",
      status: "Works today",
    },
    {
      title: "Your certificate of insurance",
      body: `Keep the certificate your insurer sends, with its expiry date on Deadlines. When the policy renews, add the new certificate as a new version: a link you already sent shows the newest one.${ownNote}`,
      status: own,
    },
    {
      title: "Your license and city business license",
      body: `Each with its expiry date. One that has lapsed is marked on Deadlines, so you see it before a client does.${ownNote}`,
      status: own,
    },
    {
      title: "One link for the whole set",
      body: "Pick the documents, choose 7, 30 or 90 days, and send one link. You see each time it's opened and which files were downloaded, and you can turn it off in a click.",
      status: "Works today",
    },
    {
      title: "Reminders before a certificate lapses",
      body: "Every plan gets a calendar file with alerts 30 and 7 days before each date. On Pro, reminders 90, 30 and 7 days ahead are also shown to owners and admins on the Deadlines page.",
      status: "Works today",
    },
    docs
      ? {
          title: "Collecting from your subcontractors",
          body: "Send each sub an upload link for their W-9 and certificate, and see who's current. In the sample today; not in a plan yet.",
          status: "Planned",
        }
      : {
          title: "Collecting from your subcontractors",
          body: "Send each sub an upload link for their W-9 and certificate, and see who's current. Not in a plan yet.",
          status: "Works today",
        },
  ];
}

export default function ContractorsPage() {
  const docs = realDocsEnabled();
  return (
    <UseCasePage
      eyebrow="For contractors"
      title="The papers every new job asks for, ready before anyone asks."
      lede="A general contractor or property manager wants your W-9, certificate of insurance and license before you start, and the certificate again when it renews. ShipShape keeps them in one place, fills the W-9 for you and sends the set as one link."
      asksTitle="What a new job asks for, and what ShipShape does with it"
      asks={asks(docs)}
      sampleTitle="See it in the sample workspace"
      sampleIntro="The sample is Harbor Plumbing LLC, a made-up plumbing business with made-up documents. Its dates count from the day you open it. In it you'll find:"
      sample={[
        "a certificate of liability insurance that expires in 21 days, under Next 30 days on Deadlines;",
        "a state contractor license, and a city business license that lapsed 12 days ago, under Lapsed;",
        "a W-9 filled for Northwind Builders, a made-up general contractor, from the sample's business facts;",
        "a 30-day link, Northwind Builders onboarding, holding the W-9, the certificate and the license, with the opens and downloads it has had.",
      ]}
      limits={[
        "It doesn't issue insurance certificates or check them with your insurer.",
        "It doesn't tell you what coverage a contract requires or which license you need.",
        "It's software, not a law firm, and doesn't give legal or tax advice.",
      ]}
      docs={docs}
    />
  );
}
