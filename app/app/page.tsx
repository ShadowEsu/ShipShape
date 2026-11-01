import Link from "next/link";
import { ValidityChip } from "@/components/app-ui";
import { DOC_KINDS, listDocuments } from "@/lib/server/documents";
import { realDocsEnabled } from "@/lib/server/flags";
import { listPassports } from "@/lib/server/passport";
import { loadProfile } from "@/lib/server/profile";
import { DEFAULT_WORKSPACE_NAME, requireWorkspace } from "@/lib/server/session";

const TASKS = [
  { href: "/app/make/irs-w9", title: "Fill a W-9", body: "Filled from your business facts." },
  { href: "/app/make/common-paper-mnda", title: "Start an NDA", body: "Common Paper's mutual NDA, cover page filled for you." },
  { href: "/app/documents/new", title: "Add a certificate or license", body: "Keep it with its dates so nothing lapses." },
];

export default async function AppHome() {
  const ctx = await requireWorkspace();
  const [docs, profile, links] = await Promise.all([listDocuments(ctx), loadProfile(ctx), listPassports(ctx)]);
  const attention = docs.filter((d) => d.validity === "expired" || d.validity === "expiring");
  const current = docs.filter((d) => d.validity === "ok" || d.validity === "none").length;
  const canUpload = !ctx.demo && realDocsEnabled();

  // First-run checklist, worked out from what's actually in the workspace.
  const setup = [
    {
      done: ctx.name !== DEFAULT_WORKSPACE_NAME || ctx.role === "member",
      href: "/app/settings#workspace",
      title: "Name your workspace",
      body: "People you share with see this name on your links.",
    },
    { done: Object.keys(profile.confirmed).length > 0, href: "/app/facts", title: "Confirm your business facts", body: "Name, address, EIN: typed once, used everywhere." },
    { done: docs.length > 0, href: "/app/documents/new", title: "Add a document you already have", body: "A certificate, license or signed agreement." },
    { done: docs.some((d) => d.template_id === "irs-w9"), href: "/app/make/irs-w9", title: "Fill a W-9", body: "The official IRS form, filled from your facts." },
    {
      done: docs.some((d) => d.expires_on || d.renews_on),
      // Straight to the Expires field: the first document (none has dates yet), or a new one.
      href: docs[0] ? `/app/documents/${docs[0].id}#expires_on` : "/app/documents/new#expires_on",
      title: "Add an expiry date",
      body: docs[0] ? `Start with ${docs[0].title}, so ShipShape can warn you before it lapses.` : "So ShipShape can warn you before it lapses.",
    },
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
          <p className="text-sm text-ink-2">Once these are done, this page lists only what needs you: documents about to lapse, and what to do about each.</p>
          <ol className="space-y-2">
            {setup.map((s) =>
              s === next ? (
                // The next step is the one action on the card: its body says why, its button does it.
                <li key={s.href} className="flex items-start gap-3 rounded-xl bg-canvas px-2 py-1.5">
                  <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line text-xs" />
                  <span className="space-y-2">
                    <span className="block text-sm font-medium">
                      {s.title}
                      <span className="sr-only"> (next step)</span>
                    </span>
                    <span className="block text-sm text-ink-2">{s.body}</span>
                    <Link href={s.href} className="btn">
                      {s.title}
                    </Link>
                  </span>
                </li>
              ) : (
                <li key={s.href}>
                  <Link href={s.href} className="flex items-start gap-3 rounded-xl px-2 py-1.5 hover:bg-canvas">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-ok text-white" : "border border-line"}`}
                    >
                      {s.done ? "✓" : ""}
                    </span>
                    <span className={`block text-sm font-medium ${s.done ? "text-ink-3 line-through" : ""}`}>
                      {s.title}
                      <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                    </span>
                  </Link>
                </li>
              ),
            )}
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
          {docs.length > 0 && (
            <p className="text-sm text-ink-2">
              {current} of {docs.length} documents current
            </p>
          )}
        </div>
        {attention.length === 0 ? (
          <p className="card text-sm text-ink-2">
            {docs.length === 0
              ? "Documents that have expired or expire in the next 30 days will be listed here, each with what renews it."
              : "Nothing has expired or expires in the next 30 days."}
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {attention.map((d) => {
              const daysLeft = d.expires_on ? Math.round((Date.parse(d.expires_on) - Date.parse(ctx.today)) / 86_400_000) : 0;
              return (
                <li key={d.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{d.title}</span>
                      <span className="text-sm text-ink-3">{DOC_KINDS[d.kind]}</span>
                      <ValidityChip validity={d.validity} expiresOn={d.expires_on} />
                    </span>
                    {/* Rule 6: one line on what it means, one action that fixes it. */}
                    <span className="block text-sm text-ink-2">
                      {d.validity === "expired" ? "It has lapsed." : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left.`} Renew it with the issuer, then{" "}
                      {canUpload ? "add the new copy and its new date, so your passport links share the current one." : "update its dates here."}
                    </span>
                  </span>
                  <Link
                    href={canUpload ? `/app/documents/${d.id}#version-file` : `/app/documents/${d.id}#expires_on`}
                    className="inline-flex min-h-6 shrink-0 items-center text-sm text-ink-2 underline"
                  >
                    {canUpload ? "Add the renewed copy" : "Update its dates"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
