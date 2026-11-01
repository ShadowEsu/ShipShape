"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isVisible as visible } from "@/lib/templates/catalog";
import type { FieldDef, TemplateInfo } from "@/lib/templates/types";
import { fill, type FillState } from "../actions";

export interface FactChip {
  label: string;
  confirmedAt: string | null;
  stale: boolean;
}

/** A value as the review shows it: option labels, Yes/No, and never more than the last 4 digits of an SSN. */
function shownValue(f: FieldDef, value: string): string {
  if (f.kind === "radio") return f.options?.find((o) => o.value === value)?.label ?? value;
  if (f.kind === "checkbox") return value === "on" ? "Yes" : "No";
  if (f.key === "ssn") return value ? `•••-••-${value.replace(/[\s-]/g, "").slice(-4)}` : "";
  return value;
}

/** Where a value came from, in the same terms as the record the document keeps (fillRecord in lib/server/fill.ts). */
function sourceOf(f: FieldDef, value: string, initial: string, chip: FactChip | undefined): string {
  if (f.key === "ssn") return "You typed it · used in this PDF only, not saved in Business facts";
  if (f.fact === "ein") return "From Business facts";
  if (f.fact && initial) {
    if (value !== initial) return "You changed it · was from Business facts";
    return `From Business facts${chip?.confirmedAt ? ` · confirmed ${chip.confirmedAt}` : ""}`;
  }
  if (initial && value === initial) return "Filled in for you · change it if it isn't right";
  return value ? "You typed it" : "";
}

/** Focuses a field's input, or its error line when it has none (the EIN shows as text). `_ack` is the approval box. */
function focusField(form: HTMLFormElement | null, key: string) {
  form?.querySelector<HTMLElement>(`[name="${key === "_ack" ? "ack" : key}"]:not([type=hidden]), #f-${key}-error`)?.focus();
}

export function FillForm({
  template,
  initial,
  chips,
  ackText,
}: {
  template: TemplateInfo;
  initial: Record<string, string>;
  chips: Record<string, FactChip>;
  ackText: string;
}) {
  const [values, setValues] = useState(initial);
  const [ack, setAck] = useState(false);
  const [state, action, pending] = useActionState<FillState, FormData>(fill, {});
  // The review a "Change" link left: back to editing until the next review comes back.
  const [left, setLeft] = useState<FillState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const reviewing = state.review === true && left !== state;
  const errors = state.errors ?? {};
  const set = (k: string, v: string) => setValues((old) => ({ ...old, [k]: v }));
  const sections = [...new Set(template.fields.map((f) => f.section))];
  const shownFields = template.fields.filter((f) => visible(f, values));
  const fieldErrors = shownFields.filter((f) => errors[f.key]);

  // Each result with errors moves focus to the first one, in the form's order.
  useEffect(() => {
    const first = [...template.fields.map((f) => f.key), "_ack"].find((k) => state.errors?.[k]);
    if (first) focusField(formRef.current, first);
  }, [state, template]);

  function change(key: string) {
    // Show the fields before moving focus into them; changed values need approving afresh.
    flushSync(() => {
      setLeft(state);
      setAck(false);
    });
    focusField(formRef.current, key);
  }

  return (
    <form ref={formRef} action={action} className="space-y-6" noValidate>
      <input type="hidden" name="template" value={template.id} />
      {state.error && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {state.error}
        </p>
      )}
      {!reviewing && fieldErrors.length > 0 && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          Fix {fieldErrors.length === 1 ? "1 field" : `${fieldErrors.length} fields`} below: {fieldErrors.map((f) => f.label).join("; ")}.
        </p>
      )}

      {/* While reviewing, the fields stay in the form (hidden) so approving posts the reviewed values. */}
      <div hidden={reviewing} className="space-y-6">
        {sections.map((section) => {
          const fields = shownFields.filter((f) => f.section === section);
          if (!fields.length) return null;
          return (
            <fieldset key={section} className="card">
              {/* A floated legend sits inside the card instead of on its border; fields clear it. */}
              <legend className="float-left mb-4 w-full font-semibold">{section}</legend>
              <div className="clear-both space-y-4">
                {fields.map((f) => (
                  <Field key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} error={errors[f.key]} chip={f.fact ? chips[f.key] : undefined} initial={initial[f.key] ?? ""} />
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>

      {reviewing ? (
        <>
          <section aria-labelledby="review-title" className="card space-y-3">
            <h2 id="review-title" className="font-semibold">
              Check your {template.short}
            </h2>
            <p className="text-sm text-ink-2">Every value that goes on the form, where it came from, and a way to change it.</p>
            <dl className="grid text-sm">
              {shownFields.map((f) => {
                const value = values[f.key] ?? "";
                const source = sourceOf(f, value, initial[f.key] ?? "", chips[f.key]);
                return (
                  <div key={f.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line py-2">
                    <dt className="text-ink-2">{f.label}</dt>
                    <dd className="min-w-0 flex-1 text-right">
                      <span className="block break-words whitespace-pre-line">{shownValue(f, value) || "Left blank"}</span>
                      {source && <span className="block font-mono text-xs text-ink-3">{source}</span>}
                    </dd>
                    <dd className="shrink-0">
                      <button type="button" onClick={() => change(f.key)} className="inline-flex min-h-6 items-center text-sm text-ink-2 underline">
                        Change<span className="sr-only"> {f.label}</span>
                      </button>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>

          <section className="card space-y-3 border-ink">
            <h2 className="font-semibold">Before ShipShape makes the PDF</h2>
            <p className="text-sm text-ink-2">{template.finishNote}</p>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="ack"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                aria-invalid={errors._ack ? true : undefined}
                aria-describedby={errors._ack ? "ack-error" : undefined}
              />
              <span>{ackText}</span>
            </label>
            {errors._ack && (
              <p id="ack-error" className="text-sm text-bad">
                {errors._ack}
              </p>
            )}
            <button className="btn" disabled={pending}>
              {pending ? "Making the PDF…" : `Approve and make the ${template.short}`}
            </button>
            <p className="text-sm text-ink-3">Nothing is saved until you approve.</p>
          </section>
        </>
      ) : (
        <section className="card space-y-3 border-ink">
          <p className="text-sm text-ink-2">Next, you check every value and where it came from. Nothing is saved until you approve.</p>
          <button className="btn" name="step" value="review" disabled={pending}>
            {pending ? "Checking…" : `Review the ${template.short}`}
          </button>
        </section>
      )}
    </form>
  );
}

function Field({
  f,
  value,
  onChange,
  error,
  chip,
  initial,
}: {
  f: FieldDef;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  chip?: FactChip;
  initial: string;
}) {
  const id = `f-${f.key}`;
  const describedBy = [f.hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const edited = chip && initial !== "" && value !== initial;
  const label = (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        {f.label}
        {f.required && <span className="text-ink-3"> (required)</span>}
      </span>
      {chip && initial !== "" && (
        <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${chip.stale ? "bg-warn-soft text-warn" : "bg-canvas text-ink-3"}`}>
          {edited ? "Edited · was from Business facts" : chip.stale ? "Business facts · still true?" : `From Business facts${chip.confirmedAt ? ` · confirmed ${chip.confirmedAt}` : ""}`}
        </span>
      )}
    </span>
  );

  if (f.kind === "radio") {
    return (
      <fieldset aria-describedby={describedBy}>
        <legend className="label">{label}</legend>
        <div className="mt-1 grid gap-2">
          {f.options!.map((o) => (
            <label key={o.value} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${value === o.value ? "border-ink" : "border-line"}`}>
              <input type="radio" name={f.key} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-0.5 accent-[var(--accent)]" aria-invalid={error ? true : undefined} />
              {o.label}
            </label>
          ))}
        </div>
        <Help id={id} hint={f.hint} error={error} />
      </fieldset>
    );
  }
  if (f.kind === "checkbox") {
    return (
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" id={id} name={f.key} checked={value === "on"} onChange={(e) => onChange(e.target.checked ? "on" : "")} className="mt-0.5 size-4 accent-[var(--accent)]" aria-describedby={describedBy} />
          {f.label}
        </label>
        <Help id={id} hint={f.hint} error={error} />
      </div>
    );
  }
  if (f.kind === "secret" && f.fact === "ein") {
    return (
      <div>
        <p className="label">{label}</p>
        <p className="font-mono text-sm">{value || "No EIN saved in Business facts"}</p>
        <Help id={id} hint={f.hint} error={error} />
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {f.kind === "textarea" ? (
        <textarea id={id} name={f.key} value={value} onChange={(e) => onChange(e.target.value)} maxLength={f.max} rows={3} className="input" aria-invalid={Boolean(error)} aria-describedby={describedBy} />
      ) : (
        <input
          id={id}
          name={f.key}
          type={f.kind === "date" ? "date" : f.kind === "secret" ? "password" : "text"}
          inputMode={f.kind === "number" || f.kind === "secret" ? "numeric" : undefined}
          autoComplete={f.kind === "secret" ? "off" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={f.max}
          min={f.kind === "date" ? "1900-01-01" : undefined}
          max={f.kind === "date" ? "2200-12-31" : undefined}
          className={`input ${f.kind === "number" ? "w-24" : ""}`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      )}
      <Help id={id} hint={f.hint} error={error} />
    </div>
  );
}

function Help({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        // Focusable from script: a field with no input (the EIN, shown as text) gets focus here instead.
        <p id={`${id}-error`} tabIndex={-1} className="mt-1 text-sm text-bad">
          {error}
        </p>
      )}
    </>
  );
}
