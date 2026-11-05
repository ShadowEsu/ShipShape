import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { accountSignIn } from "@/lib/server/cognito";
import { contactEmail, realDocsEnabled } from "@/lib/server/flags";
import { faqItems } from "../faq-content";

export const metadata: Metadata = {
  title: "FAQ",
  description: "What ShipShape does, what it doesn't, and how it keeps your paperwork safe.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  const contact = contactEmail();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-5 pt-10 pb-20">
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Common questions</h1>
        <div className="mt-10 divide-y divide-line border-y border-line">
          {faqItems(realDocsEnabled(), accountSignIn(process.env) !== null).map(({ q, a }) => (
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
