import { SiteFooter, SiteHeader } from "@/components/site";
import { paymentsLive } from "@/lib/server/billing-config";
import { realDocsEnabled } from "@/lib/server/flags";

/** Layout for /terms and /privacy: a preview note while the service isn't fully open, and a readable measure inside the site's header and footer. */
export function LegalPage({ title, version, children }: { title: string; version: string; children: React.ReactNode }) {
  const docs = realDocsEnabled();
  const live = paymentsLive();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-2xl px-5 pt-6 pb-16">
        {/* What isn't open yet, said where the terms are read. Live payments need real documents, so live means fully open
            and the note goes (Security L6: no test-mode line once payments are live). */}
        {!live && (
          <p role="note" className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
            ShipShape is in preview. {!docs && "Only sample workspaces with made-up documents are open. "}
            Payments run in Stripe&apos;s test mode: no real money moves.
          </p>
        )}
        <h1 className="mt-8 font-serif text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-ink-3">Version {version}</p>
        <div className="mt-8 text-[15px] leading-7 text-ink-2 [&_a]:text-ink [&_a]:underline [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mt-1 [&_p]:mt-3 [&_strong]:text-ink [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
