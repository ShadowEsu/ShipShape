import { SiteFooter, SiteHeader } from "@/components/site";

/** Layout for /terms and /privacy: draft banner and a readable measure inside the site's header and footer. */
export function LegalPage({ title, version, children }: { title: string; version: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-5 pt-6 pb-16">
        <p role="note" className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          <strong>Draft, pending lawyer review.</strong> ShipShape is in preview: only sample workspaces with made-up documents are
          open, and payments run in Stripe&apos;s test mode. This text will change before real accounts open.
        </p>
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
