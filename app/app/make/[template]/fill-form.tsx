"use client";

import { useActionState, useState } from "react";
import { isVisible as visible } from "@/lib/templates/catalog";
import type { FieldDef, TemplateInfo } from "@/lib/templates/types";
import { fill, type FillState } from "../actions";

export interface FactChip {
  label: string;
  confirmedAt: string | null;
  stale: boolean;
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
  const errors = state.errors ?? {};
  const set = (k: string, v: string) => setValues((old) => ({ ...old, [k]: v }));
  const sections = [...new Set(template.fields.map((f) => f.section))];
  const errorCount = Object.keys(errors).length;

  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="template" value={template.id} />
      {(state.error || errorCount > 0) && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {state.error ?? `Check ${errorCount === 1 ? "1 field" : `${errorCount} fields`} below.`}
        </p>
      )}
      {sections.map((section) => {
        const fields = template.fields.filter((f) => f.section === section && visible(f, values));
        if (!fields.length) return null;
        return (
          <fieldset key={section} className="card space-y-4">
            <legend className="float-left mb-2 w-full font-semibold">{section}</legend>
            {fields.map((f) => (
              <Field key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} error={errors[f.key]} chip={f.fact ? chips[f.key] : undefined} initial={initial[f.key] ?? ""} />
            ))}
          </fieldset>
        );
      })}

      <section className="card space-y-3 border-ink">
        <h2 className="font-semibold">Before ShipShape makes the PDF</h2>
        <p className="text-sm text-ink-2">{template.finishNote}</p>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" aria-describedby={errors._ack ? "ack-error" : undefined} />
          <span>{ackText}</span>
        </label>
        {errors._ack && (
          <p id="ack-error" className="text-sm text-bad">
            {errors._ack}
          </p>
        )}
        <button className="btn" disabled={pending}>
          {pending ? "Making the PDF…" : `Make the ${template.short}`}
        </button>
      </section>
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
              <input type="radio" name={f.key} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="mt-0.5 accent-[var(--accent)]" />
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
        <p id={`${id}-error`} className="mt-1 text-sm text-bad">
          {error}
        </p>
      )}
    </>
  );
}
