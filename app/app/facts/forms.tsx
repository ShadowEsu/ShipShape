"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { ENTITY_TYPES, PROFILE_FIELDS, type ProfileKey } from "@/lib/profile-fields";
import { reveal, saveFacts, saveTaxId, type FactsState } from "./actions";

/** Moves focus to the field an error is about, once for each result the form gets back. */
function useFocusField(state: FactsState) {
  useEffect(() => {
    if (state.field) document.getElementById(state.field)?.focus();
  }, [state]);
}

/** A field's description: its hint, and the error about it when there is one. */
const describedBy = (state: FactsState, key: string, hint: boolean) => [hint && `${key}-hint`, state.field === key && `${key}-error`].filter(Boolean).join(" ") || undefined;

function FieldError({ state, name }: { state: FactsState; name: string }) {
  if (state.field !== name) return null;
  return (
    <p id={`${name}-error`} className="mt-1 text-sm text-bad">
      {state.error}
    </p>
  );
}

export function FactsForm({ values, readOnly }: { values: Record<ProfileKey, string>; readOnly: boolean }) {
  const [state, action, pending] = useActionState<FactsState, FormData>(saveFacts, {});
  useFocusField(state);
  const v = state.values ?? values;
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="entity_type" className="label">
            Business type
          </label>
          {/* Keyed: React applies a select's defaultValue only when it mounts, and resets the form to that after each action. */}
          <select
            key={v.entity_type}
            id="entity_type"
            name="entity_type"
            defaultValue={v.entity_type}
            className="input"
            aria-invalid={state.field === "entity_type" || undefined}
            aria-describedby={describedBy(state, "entity_type", false)}
          >
            <option value="">Choose…</option>
            {Object.entries(ENTITY_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <FieldError state={state} name="entity_type" />
        </div>
        {PROFILE_FIELDS.map((f) => (
          <div key={f.key} className={f.key === "legal_name" || f.key === "address_line1" ? "sm:col-span-2" : ""}>
            <label htmlFor={f.key} className="label">
              {f.label}
            </label>
            <input
              id={f.key}
              name={f.key}
              defaultValue={v[f.key]}
              maxLength={f.max}
              autoComplete={f.autoComplete}
              className="input"
              aria-invalid={state.field === f.key || undefined}
              aria-describedby={describedBy(state, f.key, Boolean(f.hint))}
            />
            {f.hint && (
              <p id={`${f.key}-hint`} className="mt-1 text-xs text-ink-3">
                {f.hint}
              </p>
            )}
            <FieldError state={state} name={f.key} />
          </div>
        ))}
      </fieldset>
      {state.error && !state.field && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-ok">
          Saved and marked as confirmed today. New forms fill from these facts; documents you already made stay as they are.
        </p>
      )}
      {!readOnly && (
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save and confirm"}
        </button>
      )}
    </form>
  );
}

export function EinPanel({ masked, readOnly }: { masked: string | null; readOnly: boolean }) {
  const [shown, revealAction, revealing] = useActionState<FactsState>(reveal, {});
  const [saveState, saveAction, saving] = useActionState<FactsState, FormData>(saveTaxId, {});
  const [visible, setVisible] = useState(false);
  useFocusField(saveState);

  // A revealed number hides itself again after 30 seconds.
  useEffect(() => {
    if (!shown.ein) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 30_000);
    return () => clearTimeout(t);
  }, [shown]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-lg tracking-wider" aria-live="polite">
          {visible && shown.ein ? shown.ein : (masked ?? "Not saved")}
        </span>
        {masked && (
          <form action={revealAction}>
            <button className="btn-ghost" disabled={revealing}>
              {revealing ? "Showing…" : visible ? "Shown for 30 seconds" : "Show full EIN"}
            </button>
          </form>
        )}
      </div>
      {shown.error && (
        <p role="alert" className="text-sm text-bad">
          {shown.error}
          {shown.reauth && (
            <>
              {" "}
              <Link href="/signin?next=ein" className="underline">
                Sign in again
              </Link>
            </>
          )}
        </p>
      )}
      <p className="text-xs text-ink-3">Stored encrypted. Showing it needs a recent sign-in and is recorded in your history.</p>
      {!readOnly && (
        <form action={saveAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="ein" className="label">
              {masked ? "Replace EIN" : "Add EIN"}
            </label>
            <input
              key={saveState.typed}
              id="ein"
              name="ein"
              inputMode="numeric"
              autoComplete="off"
              placeholder="12-3456789"
              maxLength={11}
              defaultValue={saveState.typed}
              className="input font-mono"
              aria-invalid={saveState.field === "ein" || undefined}
              aria-describedby={describedBy(saveState, "ein", false)}
            />
          </div>
          <button className="btn-ghost" disabled={saving}>
            {saving ? "Saving…" : "Save EIN"}
          </button>
        </form>
      )}
      <FieldError state={saveState} name="ein" />
      {saveState.error && !saveState.field && (
        <p role="alert" className="text-sm text-bad">
          {saveState.error}
        </p>
      )}
      {saveState.saved && (
        <p role="status" className="text-sm text-ok">
          EIN saved and marked as confirmed today. New W-9s fill it in for you.
        </p>
      )}
    </div>
  );
}
