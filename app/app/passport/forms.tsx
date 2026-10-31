"use client";

import { useActionState, useEffect, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { makePassport, type PassportFormState } from "./actions";

export interface PickableDoc {
  id: string;
  title: string;
  kindLabel: string;
  note: string | null;
}

export function NewPassportForm({ docs, days, preselected }: { docs: PickableDoc[]; days: readonly number[]; preselected: string[] }) {
  const [state, action, pending] = useActionState<PassportFormState, FormData>(makePassport, {});
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (state.created) setUrl(`${window.location.origin}/p/${state.created.id}#${state.created.token}`);
  }, [state.created]);

  if (url) {
    return (
      <div className="space-y-3">
        <h2 className="font-semibold">Your link is ready</h2>
        <p className="text-sm text-ink-2">
          Copy it now: for your safety ShipShape keeps only a fingerprint of it and can&apos;t show it again. Anyone with the link
          can download these documents until it expires or you turn it off.
        </p>
        <CopyLink id="passport-url" label="Passport link" url={url} />
        <button type="button" className="text-sm text-ink-2 underline" onClick={() => window.location.reload()}>
          Make another link
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="label" className="label">
          Who is it for?
        </label>
        <input id="label" name="label" required maxLength={120} placeholder="e.g. Northwind Builders onboarding" className="input" />
      </div>
      <fieldset>
        <legend className="label">Documents to include</legend>
        {docs.length === 0 ? (
          <p className="text-sm text-ink-3">Add or make a document first.</p>
        ) : (
          <ul className="mt-1 grid gap-2">
            {docs.map((d) => (
              <li key={d.id}>
                <label className="flex items-start gap-3 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
                  <input type="checkbox" name="doc" value={d.id} defaultChecked={preselected.includes(d.id)} className="mt-0.5 size-4 accent-[var(--accent)]" />
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
        )}
      </fieldset>
      <fieldset>
        <legend className="label">The link stops working after</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {days.map((d, i) => (
            <label key={d} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
              <input type="radio" name="days" value={d} defaultChecked={i === 1} className="accent-[var(--accent)]" />
              {d} days
            </label>
          ))}
        </div>
      </fieldset>
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn" disabled={pending || docs.length === 0}>
        {pending ? "Making the link…" : "Make the link"}
      </button>
    </form>
  );
}
