import Link from "next/link";
import { SiteFooter, SiteHeader, StatusLabel, type Status } from "@/components/site";

/** One thing this kind of business gets asked for, what ShipShape does with it, and where that stands. */
export interface Ask {
  title: string;
  body: string;
  status: Status;
}

/**
 * A page for one kind of business (/for/...): what its customers ask for, what ShipShape does with each, what the sample
 * workspace shows for it, and what ShipShape doesn't do. Every line is written for that page; only the layout is shared.
 * `docs`: real documents are open, so "Works today" no longer means "in the sample".
 */
export function UseCasePage({
  eyebrow,
  title,
  lede,
  asksTitle,
  asks,
  sampleTitle,
  sampleIntro,
  sample,
  limits,
  docs,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  asksTitle: string;
  asks: Ask[];
  sampleTitle: string;
  sampleIntro: string;
  sample: string[];
  limits: string[];
  docs: boolean;
}) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-4xl px-5 pt-10 pb-20">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 max-w-3xl font-serif text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-2">{lede}</p>
        <div className="mt-6 flex flex-col items-start gap-3 min-[400px]:flex-row min-[400px]:flex-wrap min-[400px]:items-center">
          <Link href="/signin" className="btn-accent">
            {docs ? "Sign in or try the sample" : "Try the sample workspace"}
          </Link>
          <Link href="/pricing" className="btn-ghost">
            See pricing
          </Link>
        </div>

        <section className="mt-16" aria-labelledby="asks">
          <h2 id="asks" className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            {asksTitle}
          </h2>
          <ul className="mt-6 divide-y divide-line rounded-2xl border border-line bg-paper">
            {asks.map((a) => (
              <li key={a.title} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{a.title}</h3>
                  <StatusLabel status={a.status} />
                </div>
                <p className="mt-1 text-base text-ink-2 sm:text-sm">{a.body}</p>
              </li>
            ))}
          </ul>
          {!docs && <p className="mt-3 text-base text-ink-3 sm:text-sm">&ldquo;Works today&rdquo; means in the sample workspace.</p>}
        </section>

        <section className="mt-16" aria-labelledby="sample">
          <h2 id="sample" className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            {sampleTitle}
          </h2>
          <p className="mt-3 max-w-2xl text-ink-2">{sampleIntro}</p>
          <ul className="mt-4 max-w-2xl list-disc space-y-2 pl-5 text-ink-2">
            {sample.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>

        <section className="mt-16" aria-labelledby="limits">
          <h2 id="limits" className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            What ShipShape doesn&apos;t do
          </h2>
          <ul className="mt-4 max-w-2xl list-disc space-y-2 pl-5 text-ink-2">
            {limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
