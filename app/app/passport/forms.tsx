"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { makePassport, type PassportFormState } from "./actions";

export interface PickableDoc {
  id: string;
  title: string;
  kindLabel: string;
  note: string | null;
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

export function NewPassportForm({ docs, days, preselected }: { docs: PickableDoc[]; days: readonly number[]; preselected: string[] }) {
  const [state, action, pending] = useActionState<PassportFormState, FormData>(makePassport, {});
  const typed = state.values;
  const errors = state.fieldErrors ?? {};
  const [url, setUrl] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

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
    <form ref={form} action={action} className="space-y-5">
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
          defaultValue={typed?.label}
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
      <fieldset aria-describedby={errors.days ? "days-error" : undefined}>
        <legend className="label">The link stops working after</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {days.map((d, i) => (
            <label key={d} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
              <input
                type="radio"
                name="days"
                value={d}
                defaultChecked={typed ? typed.days === String(d) : i === 1}
                className="accent-[var(--accent)]"
                aria-invalid={errors.days ? true : undefined}
                aria-describedby={errors.days ? "days-error" : undefined}
              />
              {d} days
            </label>
          ))}
        </div>
        <FieldError id="days-error" error={errors.days} />
      </fieldset>
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
      <button className="btn" disabled={pending}>
        {pending ? "Making the link…" : "Make the link"}
      </button>
    </form>
  );
}
