"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPersonAction, editPersonAction, type PersonField, type PersonFormState } from "./actions";

const LABELS: Record<PersonField, string> = { name: "Name", email: "Email (optional)", company: "Company (optional)" };

/**
 * Add a person (People) or Edit (a person's page): name, then the optional email and company. The redesigned look as field
 * rows, the earlier one as labelled inputs; same fields, checks and words. After a refused submit the first thing to fix
 * gets focus, as Collect's vendor form does.
 */
export function PersonForm({ v2, person }: { v2: boolean; person?: { id: string; name: string; email: string | null; company: string | null } }) {
  const [state, action, pending] = useActionState<PersonFormState, FormData>(person ? editPersonAction : addPersonAction, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [state]);
  const errors = state.fieldErrors ?? {};
  const prefix = person ? "person-edit" : "person";
  const value = (f: PersonField) => state.values?.[f] ?? (person ? (person[f] ?? "") : undefined);
  const input = (f: PersonField) => (
    <input
      id={`${prefix}-${f}`}
      name={f}
      type={f === "email" ? "email" : "text"}
      required={f === "name"}
      maxLength={f === "email" ? 200 : 120}
      autoComplete="off"
      defaultValue={value(f)}
      className={v2 ? "row-field" : "input"}
      aria-invalid={errors[f] ? true : undefined}
      aria-describedby={errors[f] ? `${prefix}-${f}-error` : undefined}
    />
  );
  const error = (f: PersonField) =>
    errors[f] && (
      <p id={`${prefix}-${f}-error`} className="mt-1 text-sm text-bad">
        {errors[f]}
      </p>
    );
  const fields: PersonField[] = ["name", "email", "company"];
  return (
    <form ref={form} action={action} className="space-y-4" noValidate>
      {person && <input type="hidden" name="id" value={person.id} />}
      {v2 ? (
        <div>
          <ul className="group-list plain">
            {fields.map((f) => (
              <li key={f} className="field-row">
                <label htmlFor={`${prefix}-${f}`}>{LABELS[f]}</label>
                {input(f)}
              </li>
            ))}
          </ul>
          {fields.map((f) => (
            <div key={f} className="px-1">
              {error(f)}
            </div>
          ))}
        </div>
      ) : (
        fields.map((f) => (
          <div key={f}>
            <label htmlFor={`${prefix}-${f}`} className="label">
              {LABELS[f]}
            </label>
            {input(f)}
            {error(f)}
          </div>
        ))
      )}
      {state.error && (
        <p role="alert" tabIndex={-1} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className={v2 ? "btn press" : "btn"} disabled={pending}>
        {person ? (pending ? "Saving…" : "Save changes") : pending ? "Adding…" : "Add person"}
      </button>
    </form>
  );
}
