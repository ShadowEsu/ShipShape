"use client";

import { useActionState, useEffect, useState } from "react";
import { ENTITY_TYPES, PROFILE_FIELDS, type ProfileKey } from "@/lib/profile-fields";
import { reveal, saveFacts, saveTaxId, type FactsState } from "./actions";

export function FactsForm({ values, readOnly }: { values: Record<ProfileKey, string>; readOnly: boolean }) {
  const [state, action, pending] = useActionState<FactsState, FormData>(saveFacts, {});
  const v = state.values ?? values;
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="entity_type" className="label">
            Business type
          </label>
          {/* Keyed: React applies a select's defaultValue only when it mounts, and resets the form to that after each action. */}
          <select key={v.entity_type} id="entity_type" name="entity_type" defaultValue={v.entity_type} className="input">
            <option value="">Choose…</option>
            {Object.entries(ENTITY_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {PROFILE_FIELDS.map((f) => (
          <div key={f.key} className={f.key === "legal_name" || f.key === "address_line1" ? "sm:col-span-2" : ""}>
            <label htmlFor={f.key} className="label">
              {f.label}
            </label>
            <input id={f.key} name={f.key} defaultValue={v[f.key]} maxLength={f.max} autoComplete={f.autoComplete} className="input" aria-describedby={f.hint ? `${f.key}-hint` : undefined} />
            {f.hint && (
              <p id={`${f.key}-hint`} className="mt-1 text-xs text-ink-3">
                {f.hint}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-ok">
          Saved and marked as confirmed today.
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
              {visible ? "Shown for 30 seconds" : "Show full EIN"}
            </button>
          </form>
        )}
      </div>
      {shown.error && (
        <p role="alert" className="text-sm text-bad">
          {shown.error}
        </p>
      )}
      <p className="text-xs text-ink-3">Stored encrypted. Showing it needs a recent sign-in and is recorded in your history.</p>
      {!readOnly && (
        <form action={saveAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="ein" className="label">
              {masked ? "Replace EIN" : "Add EIN"}
            </label>
            <input id="ein" name="ein" inputMode="numeric" autoComplete="off" placeholder="12-3456789" maxLength={11} className="input font-mono" />
          </div>
          <button className="btn-ghost" disabled={saving}>
            {saving ? "Saving…" : "Save EIN"}
          </button>
        </form>
      )}
      {saveState.error && (
        <p role="alert" className="text-sm text-bad">
          {saveState.error}
        </p>
      )}
      {saveState.saved && (
        <p role="status" className="text-sm text-ok">
          EIN saved.
        </p>
      )}
    </div>
  );
}
