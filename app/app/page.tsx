import Link from "next/link";
import { ValidityChip } from "@/components/app-ui";
import { DOC_KINDS, listDocuments } from "@/lib/server/documents";
import { listPassports } from "@/lib/server/passport";
import { loadProfile } from "@/lib/server/profile";
import { requireWorkspace } from "@/lib/server/session";

const TASKS = [
  { href: "/app/make/irs-w9", title: "Send a W-9", body: "Filled from your business facts in a minute." },
  { href: "/app/make/common-paper-mnda", title: "Start an NDA", body: "Common Paper's mutual NDA, cover page filled for you." },
  { href: "/app/documents/new", title: "Add a certificate or license", body: "Keep it with its dates so nothing lapses." },
];

export default async function AppHome() {
  const ctx = await requireWorkspace();
  const [docs, profile, links] = await Promise.all([listDocuments(ctx), loadProfile(ctx), listPassports(ctx)]);
  const attention = docs.filter((d) => d.validity === "expired" || d.validity === "expiring");
  const current = docs.filter((d) => d.validity === "ok" || d.validity === "none").length;

  // First-run checklist, worked out from what's actually in the workspace.
  const setup = [
    { done: Object.keys(profile.confirmed).length > 0, href: "/app/facts", title: "Confirm your business facts", body: "Name, address, EIN: typed once, used everywhere." },
    { done: docs.length > 0, href: "/app/documents/new", title: "Add a document you already have", body: "A certificate, license or signed agreement." },
    { done: docs.some((d) => d.template_id === "irs-w9"), href: "/app/make/irs-w9", title: "Make a W-9", body: "The official IRS form, filled from your facts." },
    { done: docs.some((d) => d.expires_on || d.renews_on), href: "/app/deadlines", title: "Add an expiry date", body: "So ShipShape can warn you before it lapses." },
    { done: links.length > 0, href: "/app/passport", title: "Share a passport link", body: "One link with the documents a customer asked for." },
  ];
  const done = setup.filter((s) => s.done).length;
  const next = setup.find((s) => !s.done);

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <p className="eyebrow">{ctx.name}</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">What do you need to get done?</h1>
      </section>

      {next && (
        <section aria-labelledby="setup-title" className="card space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="setup-title" className="font-semibold">
              Get set up
            </h2>
            <p className="text-sm text-ink-2">
              {done} of {setup.length} done
            </p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(done / setup.length) * 100}%` }} />
          </div>
          <ol className="space-y-2">
            {setup.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className={`flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-canvas ${s === next ? "bg-canvas" : ""}`}>
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-ok text-white" : "border border-line"}`}
                  >
                    {s.done ? "✓" : ""}
                  </span>
                  <span>
                    <span className={`block text-sm font-medium ${s.done ? "text-ink-3 line-through" : ""}`}>
                      {s.title}
                      <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                    </span>
                    {s === next && <span className="block text-sm text-ink-2">{s.body}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ul className="grid gap-3 sm:grid-cols-3">
        {TASKS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="card block h-full hover:border-ink">
              <span className="block font-semibold">{t.title}</span>
              <span className="mt-1 block text-sm text-ink-2">{t.body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-2xl font-semibold">Needs attention</h2>
          <p className="text-sm text-ink-2">
            {current} of {docs.length} documents current
          </p>
        </div>
        {attention.length === 0 ? (
          <p className="card text-sm text-ink-2">Nothing has expired or expires in the next 30 days.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {attention.map((d) => (
              <li key={d.id}>
                <Link href={`/app/documents/${d.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    <span className="font-medium">{d.title}</span>
                    <span className="ml-2 text-sm text-ink-3">{DOC_KINDS[d.kind]}</span>
                  </span>
                  <ValidityChip validity={d.validity} expiresOn={d.expires_on} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
