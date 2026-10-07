import { Logo } from "./ui";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Logo />
      <p className="mt-8 rounded-lg bg-amber-50 p-3 text-sm text-warn">Draft for lawyer review before launch. Last updated October 7, 2026.</p>
      <h1 className="mt-6 text-3xl font-bold">{title}</h1>
      <div className="mt-6 space-y-4 text-slate-700 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink">{children}</div>
    </main>
  );
}
