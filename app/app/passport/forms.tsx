"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { fmtDay, plusDays } from "@/lib/today";
import { makePassport, type PassportFormState } from "./actions";

export interface PickableDoc {
  id: string;
  title: string;
  kindLabel: string;
  note: string | null;
  /** A W-9: the file shows the full EIN or SSN to whoever opens the link. */
  holdsTaxId: boolean;
}

/** What making the link means, said before it exists: who can open it, what a W-9 reveals, what stays private. */
export function WhoCanOpen({ label, documents, taxId }: { label: string; documents: number; taxId: boolean }) {
  const who = label.trim() || "the person it's for";
  const what = documents === 0 ? "the documents you tick" : documents === 1 ? "this document" : `these ${documents} documents`;
  return (
    <section aria-labelledby="who-can-open" className="space-y-2 rounded-lg border border-line bg-canvas px-3 py-3 text-sm text-ink-2">
      <h3 id="who-can-open" className="font-medium text-ink">
        Who can open it
      </h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Anyone who has the link can view and download {what}. Send it only to {who}.
        </li>
        {taxId && <li>Your W-9 shows your full EIN or SSN to whoever opens it.</li>}
        <li>They can&apos;t see your other documents, business facts or history.</li>
        <li>You see each time it&apos;s opened.</li>
      </ul>
    </section>
  );
}

/** The end of making a link: what was made, what happens next, and the one thing to do (copy it). */
export function PassportReady({ label, documents, days, url }: { label: string; documents: number; days: number; url: string }) {
  return (
    <div className="space-y-3" role="status">
      <h2 className="font-semibold">Your link for {label} is ready</h2>
      <p className="text-sm text-ink-2">
        It shares {documents} {documents === 1 ? "document" : "documents"} for {days} days. Copy it now and send it yourself: ShipShape keeps only a
        fingerprint of it and can&apos;t show it again. Each time someone opens it, you&apos;ll see it under Your links.
      </p>
      <CopyLink id="passport-url" label="Passport link" url={url} />
    </div>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-bad">
      {error}
    </p>
  );
}

export function NewPassportForm({
  docs,
  days,
  preselected,
  today,
  initial = { label: "", days: Number.NaN },
}: {
  docs: PickableDoc[];
  days: readonly number[];
  preselected: string[];
  /** Today's date in UTC (YYYY-MM-DD), from the server: the browser must not count from its own clock, or hydration differs around midnight. */
  today: string;
  /** What the person had typed before opening the preview (the preview's "Back" carries it in the address). */
  initial?: { label: string; days: number };
}) {
  const [state, action, pending] = useActionState<PassportFormState, FormData>(makePassport, {});
  const typed = state.values;
  const errors = state.fieldErrors ?? {};
  const [url, setUrl] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const startLabel = typed?.label ?? initial.label;
  const startDays = typed ? Number(typed.days) : days.includes(initial.days) ? initial.days : days[1];
  // The days picked since the page loaded (null: the default, or what was sent last).
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = picked ?? startDays;
  // Mirrors of the label and the ticked documents, for the "Who can open it" box and the preview's address.
  const [label, setLabel] = useState(startLabel);
  const [ticked, setTicked] = useState<string[]>(typed?.docs ?? preselected);
  const tick = (id: string, on: boolean) => setTicked((old) => (on ? [...new Set([...old, id])] : old.filter((x) => x !== id)));
  const chosenDocs = ticked.filter((id) => docs.some((d) => d.id === id));
  const previewHref = `/app/passport/preview?${new URLSearchParams({ docs: chosenDocs.join(","), label, days: String(chosen) })}`;

  useEffect(() => {
    if (state.created) setUrl(`${window.location.origin}/p/${state.created.id}#${state.created.token}`);
  }, [state.created]);

  // After a refused submit, the first thing to fix gets focus.
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [state]);

  if (url && state.created) return <PassportReady label={state.created.label} documents={state.created.documents} days={state.created.days} url={url} />;

  if (docs.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-2">A link shares documents from this workspace, so it needs at least one. Add one, then choose it here.</p>
        <Link href="/app/documents/new" className="btn">
          Add a document
        </Link>
      </div>
    );
  }

  return (
    <form ref={form} action={action} className="space-y-5" noValidate>
      <div>
        <label htmlFor="label" className="label">
          Who is it for?
        </label>
        <input
          id="label"
          name="label"
          required
          maxLength={120}
          placeholder="e.g. Northwind Builders onboarding"
          defaultValue={startLabel}
          onChange={(e) => setLabel(e.target.value)}
          className="input"
          aria-invalid={errors.label ? true : undefined}
          aria-describedby={errors.label ? "label-error" : undefined}
        />
        <FieldError id="label-error" error={errors.label} />
      </div>
      <fieldset aria-describedby={errors.docs ? "docs-error" : undefined}>
        <legend className="label">Documents to include</legend>
        <ul className="mt-1 grid gap-2">
          {docs.map((d) => (
            <li key={d.id}>
              <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
                <input
                  type="checkbox"
                  name="doc"
                  value={d.id}
                  defaultChecked={(typed?.docs ?? preselected).includes(d.id)}
                  onChange={(e) => tick(d.id, e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                  aria-invalid={errors.docs ? true : undefined}
                  aria-describedby={errors.docs ? "docs-error" : undefined}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{d.title}</span>
                  <span className="block text-xs text-ink-3">
                    {d.kindLabel}
                    {d.note && ` · ${d.note}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <FieldError id="docs-error" error={errors.docs} />
      </fieldset>
      <fieldset aria-describedby={[days.includes(chosen) ? "days-end" : null, errors.days ? "days-error" : null].filter(Boolean).join(" ") || undefined}>
        <legend className="label">The link stops working after</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {days.map((d) => (
            <label key={d} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
              <input
                type="radio"
                name="days"
                value={d}
                defaultChecked={d === startDays}
                onChange={() => setPicked(d)}
                className="accent-[var(--accent)]"
                aria-invalid={errors.days ? true : undefined}
                aria-describedby={errors.days ? "days-error" : undefined}
              />
              {d} days
            </label>
          ))}
        </div>
        {/* The server counts the days from the moment the link is made, and dates show in UTC (fmtDay). */}
        {days.includes(chosen) && (
          <p id="days-end" className="mt-2 text-sm text-ink-2">
            {`Stops working on ${fmtDay(plusDays(today, chosen))}. You can turn it off sooner.`}
          </p>
        )}
        <FieldError id="days-error" error={errors.days} />
      </fieldset>
      <WhoCanOpen label={label} documents={chosenDocs.length} taxId={docs.some((d) => d.holdsTaxId && ticked.includes(d.id))} />
      {state.error && (
        <div role="alert" tabIndex={-1} className="space-y-2 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          <p>{state.error}</p>
          {state.fix && (
            <Link href={state.fix.href} className="underline">
              {state.fix.label}
            </Link>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={pending}>
          {pending ? "Making the link…" : "Make the link"}
        </button>
        {chosenDocs.length > 0 && (
          <Link href={previewHref} className="btn-ghost">
            Preview what they&apos;ll see
          </Link>
        )}
      </div>
    </form>
  );
}
