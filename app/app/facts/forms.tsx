"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { changed, DiscardDialog, useLeaveGuard } from "@/components/leave-guard";
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

/**
 * The redesigned app's business facts (PR 7 plan): a grouped list, a label and its field per row, as on a document's
 * Details, posting to the same `saveFacts`; "Saved" stays until the next change, and leaving with changes asks. Unlike
 * Details, Save and confirm is always there (docked above the tab bar on the phone): confirming unchanged facts is what
 * "still true?" asks for. Same fields, words and checks as FactsForm.
 */
export function FactsFormV2({ values, readOnly }: { values: Record<ProfileKey, string>; readOnly: boolean }) {
  const [state, action, pending] = useActionState<FactsState, FormData>(saveFacts, {});
  const form = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  useFocusField(state);
  // A result came back and React put the fields back to their defaults (the saved values, or the ones sent back with an error).
  useEffect(() => {
    setDirty(form.current ? changed(form.current) : false);
  }, [state]);
  // A refused save hasn't saved what was sent, even though the fields now show it as their defaults.
  const [leaving, ask] = useLeaveGuard(dirty || Boolean(state.error));
  const v = state.values ?? values;
  const row = (key: string, label: string, field: React.ReactNode, hint?: string) => (
    <li key={key}>
      {/* flex-wrap: a field may take its own line under the label on the phone (Business type, whose choices are long). */}
      <div className="field-row flex-wrap">
        <label htmlFor={key}>{label}</label>
        {field}
      </div>
      {(hint || state.field === key) && (
        <div className="px-4 pb-2.5">
          {hint && (
            <p id={`${key}-hint`} className="text-[13px] text-ink-3">
              {hint}
            </p>
          )}
          <FieldError state={state} name={key} />
        </div>
      )}
    </li>
  );
  return (
    <form ref={form} action={action} onInput={(e) => setDirty(changed(e.currentTarget))} className="space-y-3">
      <fieldset disabled={readOnly} className="min-w-0">
        <ul className="group-list plain">
          {row(
            "entity_type",
            "Business type",
            // Keyed: React applies a select's defaultValue only when it mounts, and resets the form to that after each action.
            // On the phone it takes its own line: "LLC taxed as a partnership" doesn't fit beside the label, and a select can't ellipsize.
            <select
              key={v.entity_type}
              id="entity_type"
              name="entity_type"
              defaultValue={v.entity_type}
              className="row-field basis-full px-0 text-left sm:basis-0 sm:px-2 sm:text-right"
              aria-invalid={state.field === "entity_type" || undefined}
              aria-describedby={describedBy(state, "entity_type", false)}
            >
              <option value="">Choose…</option>
              {Object.entries(ENTITY_TYPES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>,
          )}
          {PROFILE_FIELDS.map((f) =>
            row(
              f.key,
              f.label,
              <input
                id={f.key}
                name={f.key}
                defaultValue={v[f.key]}
                maxLength={f.max}
                autoComplete={f.autoComplete}
                className="row-field"
                // An empty row reads as a static list without it (Design 02 Nov); nothing to add where nobody can edit.
                placeholder={readOnly ? undefined : "Add"}
                aria-invalid={state.field === f.key || undefined}
                aria-describedby={describedBy(state, f.key, Boolean(f.hint))}
              />,
              f.hint,
            ),
          )}
        </ul>
      </fieldset>
      {state.error && !state.field && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.saved && !dirty && (
        <p role="status" className="text-sm text-ok">
          Saved and marked as confirmed today. New forms fill from these facts; documents you already made stay as they are.
        </p>
      )}
      {!readOnly && (
        // Docked at the foot of the phone's screen, 8px over the home indicator, as on a document's Details.
        <div className="save-dock sticky bottom-[calc(8px+env(safe-area-inset-bottom))] z-10 md:static">
          <button className="btn press w-full md:w-auto" disabled={pending}>
            {pending ? "Saving…" : "Save and confirm"}
          </button>
        </div>
      )}
      <DiscardDialog
        ask={ask}
        body="The changes to your business facts aren't saved yet."
        onDiscard={() => {
          setDirty(false);
          ask.current?.close();
          if (leaving) router.push(leaving);
        }}
      />
    </form>
  );
}

/** The EIN: masked, shown in full for 30 seconds on request, replaced through its own form. In the redesigned app (v2) its value and its field are grouped-list rows. */
export function EinPanel({ masked, readOnly, sample, v2 }: { masked: string | null; readOnly: boolean; sample: boolean; v2?: boolean }) {
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

  const number = (
    <span className="font-mono text-lg tracking-wider" aria-live="polite">
      {visible && shown.ein ? shown.ein : (masked ?? "Not saved")}
    </span>
  );
  const show = masked && (
    <form action={revealAction}>
      <button className={v2 ? "btn-ghost press" : "btn-ghost"} disabled={revealing}>
        {revealing ? "Showing…" : visible ? "Shown for 30 seconds" : "Show full EIN"}
      </button>
    </form>
  );
  const input = (className: string) => (
    <input
      key={saveState.typed}
      id="ein"
      name="ein"
      inputMode="numeric"
      autoComplete="off"
      placeholder="12-3456789"
      maxLength={11}
      defaultValue={saveState.typed}
      className={className}
      aria-invalid={saveState.field === "ein" || undefined}
      aria-describedby={describedBy(saveState, "ein", false)}
    />
  );
  const label = masked ? "Replace EIN" : "Add EIN";
  const save = (
    <button className={v2 ? "btn-ghost press" : "btn-ghost"} disabled={saving}>
      {saving ? "Saving…" : "Save EIN"}
    </button>
  );

  return (
    <div className="space-y-4">
      {v2 ? (
        <ul className="group-list plain">
          <li className="group-row flex-wrap justify-between">
            {number}
            {show}
          </li>
        </ul>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {number}
          {show}
        </div>
      )}
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
      <p className="text-xs text-ink-3">
        {sample
          ? "In a real workspace, showing the full EIN needs a recent sign-in. This one is made up, so it shows straight away."
          : "Stored encrypted. Showing it here needs a recent sign-in and is recorded in the workspace history (your export includes it). Every W-9 you make carries the full number, as the IRS form requires."}
      </p>
      {!readOnly &&
        (v2 ? (
          <form action={saveAction} className="space-y-3">
            <ul className="group-list plain">
              <li className="field-row">
                <label htmlFor="ein">{label}</label>
                {input("row-field font-mono")}
              </li>
            </ul>
            {save}
          </form>
        ) : (
          <form action={saveAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="ein" className="label">
                {label}
              </label>
              {input("input font-mono")}
            </div>
            {save}
          </form>
        ))}
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
