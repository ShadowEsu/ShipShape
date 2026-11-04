import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site";
import { AI_RECIPIENT, AI_TRAINING_SOURCE } from "@/lib/ai";
import { megabytes, PLANS } from "@/lib/plans";
import { accountSignIn } from "@/lib/server/cognito";
import { contactEmail, realDocsEnabled } from "@/lib/server/flags";

export const metadata: Metadata = {
  title: "FAQ",
  description: "What ShipShape does, what it doesn't, and how it keeps your paperwork safe.",
  alternates: { canonical: "/faq" },
};

/** Worded for whether real accounts are open: the preview answers go once they are (Security MUST-4). */
const faq = (docs: boolean, accounts: boolean): { q: string; a: React.ReactNode }[] => [
  {
    q: "What is ShipShape?",
    a: docs
      ? "An app that keeps a business's everyday paperwork in one place: W-9s, insurance certificates, licenses, permits and agreements. It fills new forms from facts you've confirmed, shares a packet of documents with one link, and tracks expiry dates. Collecting signatures works in the sample workspace today, and for your own documents once ShipShape sends email."
      : "An app that keeps a business's everyday paperwork in one place: W-9s, insurance certificates, licenses, permits and agreements. It fills new forms from facts you've confirmed, shares a packet of documents with one link, tracks expiry dates, and collects signatures.",
  },
  {
    q: "Is ShipShape a law firm? Does it give legal advice?",
    a: "No to both. ShipShape is document software. It doesn't tell you which document to use or what terms to pick, and it never writes or changes the clauses of a document. You review every field before anything is created, and for legal or tax questions you should talk to a professional.",
  },
  {
    q: "Which documents can it fill today?",
    a: docs
      ? "The IRS Form W-9 (the official PDF, filled field by field) and the cover page of Common Paper's Mutual NDA, version 1.0, with its standard terms unchanged. You can also upload your own PDF, PNG or JPEG files (up to 4 MB each)."
      : "The IRS Form W-9 (the official PDF, filled field by field) and the cover page of Common Paper's Mutual NDA, version 1.0, with its standard terms unchanged. Once real accounts open, you can also upload your own PDF, PNG or JPEG files (up to 4 MB each).",
  },
  {
    q: "Where do the templates come from?",
    a: "Only official or openly licensed sources, each named on the document: the IRS for the W-9, and Common Paper (CC BY 4.0) for the NDA.",
  },
  {
    q: "Who can see my documents?",
    a: "People in your workspace, and anyone you send a passport link to, for the documents on that link and until it expires or you turn it off. Every other workspace is walled off in the database itself.",
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
    a: "In your business facts it's encrypted with a key kept outside the database, shown as its last 4 digits, and shown in full only after a recent sign-in, which is recorded. A W-9 you fill carries the full number, as the IRS form requires, so anyone who can open that W-9, or who has a passport link to it, can read it. Our server logs blank out anything shaped like an SSN or EIN.",
  },
  {
    q: "Does ShipShape use AI?",
    a: (
      <>
        One feature uses it, and it&apos;s switched on only after our security review: &ldquo;What are they asking for?&rdquo; reads a
        message you paste and lists the documents it asks for, then ShipShape checks your documents for them. It runs only when you tick
        a box for that message and sends {AI_RECIPIENT} only the text you pasted (numbers shaped like an SSN or EIN removed, never your
        documents). Anthropic says that by default it doesn&apos;t train on what its API receives (
        <a href={AI_TRAINING_SOURCE.href} target="_blank" rel="noopener noreferrer" className="underline">
          {AI_TRAINING_SOURCE.label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        , checked {AI_TRAINING_SOURCE.checked}). The answer is a draft you check, not legal advice.
      </>
    ),
  },
  {
    q: "Can I get my data out, or delete it?",
    a: (
      <>
        Yes. Owners and admins can download everything from Settings as one ZIP file (up to 200 MB; for a bigger workspace, write to
        us) with every version of every document and the full history. Anyone can delete their account there, along with any
        workspace where they&apos;re the only owner. Details are in the <Link href="/privacy" className="underline">privacy policy</Link>.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Free covers {PLANS.free.documents} active documents, {megabytes(PLANS.free.files)} of files and {PLANS.free.passports} open passport link. Pro is ${PLANS.pro.price} a
        month with no limits, plus deadline reminders on your Deadlines page. ShipShape doesn&apos;t send email yet. See{" "}
        <Link href="/pricing" className="underline">
          pricing
        </Link>
        .
      </>
    ),
  },
  ...(accounts
    ? [
        {
          q: "What do I need to sign in?",
          a: "An email address, a password and an authenticator app on your phone for the two-step code. The sample workspace needs none of these.",
        },
      ]
    : []),
  ...(docs
    ? []
    : [
        {
          q: "When can I use it for real documents?",
          a: "After our security review, once our live servers are ready. Until then you can try it in a sample workspace with a made-up business (uploading your own files and editing its facts open with real accounts), and join the waitlist on the home page to hear when accounts open.",
        },
      ]),
];

export default function FaqPage() {
  const contact = contactEmail();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-5 pt-10 pb-20">
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Common questions</h1>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {faq(realDocsEnabled(), accountSignIn(process.env) !== null).map(({ q, a }) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-45 motion-reduce:transition-none">
                  +
                </span>
              </summary>
              <div className="mt-3 text-ink-2">{a}</div>
            </details>
          ))}
        </div>
        <section id="support" aria-labelledby="support-title" className="mt-12 scroll-mt-6">
          <h2 id="support-title" className="font-serif text-2xl font-semibold tracking-tight">
            Still stuck?
          </h2>
          <p className="mt-3 text-ink-2">
            {contact ? (
              <>
                Write to{" "}
                <a href={`mailto:${contact}`} className="underline">
                  {contact}
                </a>
                . If a page showed an error, include the reference it gave.
              </>
            ) : (
              "A support address will be listed here before real accounts open."
            )}
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
