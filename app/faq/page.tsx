import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site";
import { PLANS } from "@/lib/plans";

export const metadata: Metadata = { title: "FAQ", description: "What ShipShape does, what it doesn't, and how it keeps your paperwork safe." };

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is ShipShape?",
    a: "An app that keeps a business's everyday paperwork in one place: W-9s, insurance certificates, licenses, permits and agreements. It fills new forms from facts you've confirmed, shares a packet of documents with one link, tracks expiry dates, and collects signatures.",
  },
  {
    q: "Is ShipShape a law firm? Does it give legal advice?",
    a: "No to both. ShipShape is document software. It doesn't tell you which document to use or what terms to pick, and it never writes or changes the clauses of a document. You review every field before anything is created, and for legal or tax questions you should talk to a professional.",
  },
  {
    q: "Which documents can it fill today?",
    a: "The IRS Form W-9 (the official PDF, filled field by field) and the cover page of Common Paper's Mutual NDA, version 1.0, with its standard terms unchanged. You can also upload any PDF or image you already have.",
  },
  {
    q: "Where do the templates come from?",
    a: "Only official or openly licensed sources, each named on the document: the IRS for the W-9, and Common Paper (CC BY 4.0) for the NDA.",
  },
  {
    q: "Who can see my documents?",
    a: "Members of your workspace, and anyone you send a passport link to, for the documents on that link and until it expires or you turn it off. Every other workspace is walled off in the database itself.",
  },
  {
    q: "How are passport links protected?",
    a: "The secret part of the link never reaches our servers in a web address, so it doesn't end up in logs. A link lasts at most 90 days, you can turn it off any time, and you can see when it was opened and what was downloaded.",
  },
  {
    q: "Are the e-signatures valid?",
    a: "ShipShape records what U.S. e-signature law (the ESIGN Act and UETA) looks for: the signer's agreement to sign electronically, their intent (a typed name), an email address confirmed with a one-time code, the time, and a fingerprint of the exact file. All of it goes on a certificate page in the signed copy. Whether a particular signature holds up depends on the document and where you are, so ask a lawyer about anything important.",
  },
  {
    q: "How is my EIN protected?",
    a: "It's encrypted with a key that's kept outside the database, shown as its last 4 digits, and revealed in full only after a recent sign-in, which is recorded. Our server logs blank out anything shaped like an SSN or EIN.",
  },
  {
    q: "Does ShipShape use AI?",
    a: "Not yet. When AI features arrive (such as matching a customer's request to your documents), each one will be off until you tick a box for that action, will use Anthropic's Claude, will strip tax IDs first, and won't be used to train AI models.",
  },
  {
    q: "Can I get my data out, or delete it?",
    a: (
      <>
        Yes, from Settings: one ZIP file with every version of every document and the full history, or delete your account and the
        workspaces you own. Details are in the <Link href="/privacy" className="underline">privacy policy</Link>.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Free covers {PLANS.free.documents} active documents and {PLANS.free.passports} open passport link. Pro is ${PLANS.pro.price} a
        month with no limits, plus email reminders and signature requests. See <Link href="/pricing" className="underline">pricing</Link>.
      </>
    ),
  },
  {
    q: "When can I use it for real documents?",
    a: "After our security review and once the production database is in place. Until then you can try everything in a sample workspace with a made-up business, and join the waitlist on the home page to hear when accounts open.",
  },
];

export default function FaqPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pt-10 pb-20">
        <p className="eyebrow">FAQ</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Questions, answered plainly.</h1>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}
                <span aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="mt-3 text-ink-2">{a}</div>
            </details>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
