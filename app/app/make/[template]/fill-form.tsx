"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { flushSync } from "react-dom";
import { isVisible as visible, stepOf, stepsOf } from "@/lib/templates/catalog";
import type { FieldDef, TemplateInfo } from "@/lib/templates/types";
import { fill, type FillState } from "../actions";

export interface FactChip {
  label: string;
  confirmedAt: string | null;
  stale: boolean;
}

/** A value as the review shows it: option labels, Yes/No, and never more than the last 4 digits of a tax id. */
function shownValue(f: FieldDef, value: string, initial: string): string {
  if (f.kind === "radio") return f.options?.find((o) => o.value === value)?.label ?? value;
  if (f.key === "sign") return value === "on" ? "Yes" : "Not signed. The PDF's signature line stays empty.";
  if (f.kind === "checkbox") return value === "on" ? "Yes" : "No";
  if (f.key === "ssn") return value ? `•••-••-${value.replace(/[\s-]/g, "").slice(-4)}` : "";
  // A saved EIN arrives masked already; one typed here is masked the same way.
  if (f.fact === "ein" && !initial) return value ? `••-•••${value.replace(/[\s-]/g, "").slice(-4)}` : "";
  return value;
}

/** Where a value came from, in the same terms as the record the document keeps (fillRecord in lib/server/fill.ts). */
function sourceOf(f: FieldDef, value: string, initial: string, chip: FactChip | undefined, saving: boolean): string {
  if (f.key === "ssn") return "You typed it · used in this PDF only, not saved in Business facts";
  if (f.fact === "ein") {
    if (initial) return "From Business facts";
    return saving ? "You typed it · saved to Business facts when you approve" : "You typed it · used in this PDF only, not saved in Business facts";
  }
  if (f.fact && initial) {
    if (value !== initial) return "You changed it · was from Business facts";
    return `From Business facts${chip?.confirmedAt ? ` · confirmed ${chip.confirmedAt}` : ""}`;
  }
  if (initial && value === initial) return "Filled in for you · change it if it isn't right";
  return value ? "You typed it" : "";
}

/** The element a field's summary link points at: its input, the radio group, or the EIN's error line (it has no input). */
function fieldAnchor(key: string) {
  return key === "_ack" ? "ack" : `f-${key}`;
}

/** Focuses a field's input, or its error line when it has none (the EIN shows as text). `_ack` is the approval box. */
function focusField(form: HTMLFormElement | null, key: string) {
  form?.querySelector<HTMLElement>(`[name="${key === "_ack" ? "ack" : key}"]:not([type=hidden]), #f-${key}-error`)?.focus();
}

/** What the form shows: the step, whether it's the review, and the result it came from. */
interface Shown {
  current: number;
  reviewing: boolean;
  state: FillState;
}

/**
 * Whether a change of what's shown should move focus to the new heading: the step or review changed, and the
 * change isn't a fresh result with errors (the summary takes focus then). A step change on an old result
 * (Back after a failed check) still moves, or focus would fall to the page when the Back button unmounts.
 */
export function headingFocusDue(was: Shown, now: Shown): boolean {
  if (was.current === now.current && was.reviewing === now.reviewing) return false;
  const freshErrors = now.state !== was.state && Boolean(now.state.errors && Object.keys(now.state.errors).length > 0);
  return !freshErrors;
}

/** An SSN as the form shows it after you leave the field: 123-45-6789 when it has 9 digits, otherwise as typed. */
export function formatSsn(value: string): string {
  const d = value.replace(/[\s-]/g, "");
  return /^[0-9]{9}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : value;
}

/** One wrong answer: the field it's about, the label a person knows it by, and what to do. */
export interface Problem {
  key: string;
  label: string;
  message: string;
}

/**
 * The list at the top of a form after a check: how many answers need fixing, and one link per answer
 * (its label and what to do) leading to the field. Takes focus when it appears (tabIndex -1, ref).
 */
export function ErrorSummary({ problems, onPick, ref }: { problems: Problem[]; onPick?: (key: string) => void; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad focus:outline-2 focus:outline-offset-2 focus:outline-accent">
      <h2 className="font-semibold">{problems.length === 1 ? "1 answer needs fixing" : `${problems.length} answers need fixing`}</h2>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {problems.map((p) => (
          <li key={p.key}>
            <a
              href={`#${fieldAnchor(p.key)}`}
              className="underline"
              onClick={(e) => {
                if (!onPick) return;
                e.preventDefault();
                onPick(p.key);
              }}
            >
              {p.label} – {p.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The review row's action cell for a saved EIN, which has no field on the step: the way to change it is
 * Business facts, for those who can; a member is told who can; the sample workspace gets nothing.
 */
export function SavedEinNote({ canSaveFacts, member }: { canSaveFacts: boolean; member: boolean }) {
  if (canSaveFacts) {
    return (
      <Link href="/app/facts" className="inline-flex min-h-6 items-center text-sm text-ink-2 underline">
        Change in Business facts
      </Link>
    );
  }
  return member ? <span className="inline-flex min-h-6 items-center text-sm text-ink-2">Only an owner or admin can change this.</span> : null;
}

export function FillForm({
  template,
  initial,
  chips,
  ackText,
  canSaveFacts,
  member = false,
}: {
  template: TemplateInfo;
  initial: Record<string, string>;
  chips: Record<string, FactChip>;
  ackText: string;
  /** Whether this person may save a typed EIN to Business facts (owners and admins of a real workspace, once real documents are open). */
  canSaveFacts: boolean;
  /** A member of someone else's workspace: can't change its facts, and the review says who can. */
  member?: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [ack, setAck] = useState(false);
  const [state, action, pending] = useActionState<FillState, FormData>(fill, {});
  // The review a "Change" link left: back to editing until the next review comes back.
  const [left, setLeft] = useState<FillState | null>(null);
  // Fields changed since this result came back: their error clears at once (it's being corrected) until the next check.
  const [fixed, setFixed] = useState<{ of: FillState; keys: string[] }>({ of: state, keys: [] });
  // The step the person moved to on their own (Back, a summary link, Change) since this result; the result's step otherwise.
  const [moved, setMoved] = useState<{ of: FillState; at: number } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const steps = stepsOf(template);
  const reviewing = state.review === true && left !== state;
  const current = Math.min(moved?.of === state ? moved.at : (state.at ?? 0), steps.length - 1);
  const last = current === steps.length - 1;
  const fixedKeys = fixed.of === state ? fixed.keys : [];
  const errors = Object.fromEntries(Object.entries(state.errors ?? {}).filter(([k]) => !fixedKeys.includes(k)));
  const set = (k: string, v: string) => {
    setValues((old) => ({ ...old, [k]: v }));
    setFixed((old) => (old.of === state ? { of: state, keys: old.keys.includes(k) ? old.keys : [...old.keys, k] } : { of: state, keys: [k] }));
  };
  // "Also save it" only exists while no EIN is saved (a saved one arrives masked in `initial`) and for people who may save facts.
  const shownFields = template.fields.filter((f) => visible(f, values) && !(f.key === "save_ein" && (initial.ein || !canSaveFacts)));
  const problems = shownFields.filter((f) => errors[f.key]).map((f) => ({ key: f.key, label: f.label, message: errors[f.key] }));

  // Each result with errors moves focus to the summary (its links lead to each field) or, on the review, to the approval box.
  useEffect(() => {
    if (!state.errors || Object.keys(state.errors).length === 0) return;
    if (summaryRef.current) summaryRef.current.focus();
    else if (state.errors._ack) focusField(formRef.current, "_ack");
  }, [state]);

  // Any other change of step (Continue, Back, the review arriving) moves focus to the new heading, so it's read out
  // and keyboard focus doesn't fall to the page when the pressed button unmounts. Not on first paint; not when a
  // summary link or Change is about to focus a field (fieldAhead); the errors effect above wins on a fresh result.
  const stepRef = useRef<HTMLHeadingElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef<Shown>({ current, reviewing, state });
  const fieldAhead = useRef(false);
  useEffect(() => {
    const was = shown.current;
    const now = { current, reviewing, state };
    shown.current = now;
    if (fieldAhead.current || !headingFocusDue(was, now)) return;
    (reviewing ? reviewRef : stepRef).current?.focus();
  }, [current, reviewing, state]);

  /** Shows the step a field is on, then focuses the field. */
  function goTo(key: string) {
    fieldAhead.current = true;
    flushSync(() => setMoved({ of: state, at: stepOf(template, key) }));
    fieldAhead.current = false;
    focusField(formRef.current, key);
  }

  function change(key: string) {
    // Show the fields before moving focus into them; changed values need approving afresh.
    fieldAhead.current = true;
    flushSync(() => {
      setLeft(state);
      setAck(false);
    });
    goTo(key);
  }

  return (
    <form ref={formRef} action={action} className="space-y-6" noValidate>
      <input type="hidden" name="template" value={template.id} />
      <input type="hidden" name="at" value={current} />
      {state.error && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {state.error}
        </p>
      )}
      {!reviewing && problems.length > 0 && <ErrorSummary ref={summaryRef} problems={problems} onPick={goTo} />}

      {/* Every step stays in the form (hidden) so the next check and the approval post every value. */}
      <div hidden={reviewing} className="space-y-6">
        {steps.length > 1 && !reviewing && (
          <h2 ref={stepRef} tabIndex={-1} className="-mx-1 rounded px-1 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className="block font-mono text-xs font-medium tracking-widest text-ink-3 uppercase">
              Step {current + 1} of {steps.length}
            </span>
            {steps[current].title}
          </h2>
        )}
        {steps.map((step, i) => (
          <div key={step.title} hidden={i !== current} className="space-y-6">
            {step.sections.map((section) => {
              const fields = shownFields.filter((f) => f.section === section);
              if (!fields.length) return null;
              return (
                <fieldset key={section} className="card">
                  {/* A floated legend sits inside the card instead of on its border; fields clear it. */}
                  {/* A step with one section already says its name in the step heading: the legend stays for screen readers only. */}
                  <legend className={step.sections.length === 1 && steps.length > 1 ? "sr-only" : "float-left mb-4 w-full font-semibold"}>{section}</legend>
                  <div className="clear-both space-y-4">
                    {fields.map((f) => (
                      <Field key={f.key} f={f} value={values[f.key] ?? ""} onChange={(v) => set(f.key, v)} error={errors[f.key]} chip={f.fact ? chips[f.key] : undefined} initial={initial[f.key] ?? ""} />
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        ))}
      </div>

      {reviewing ? (
        <>
          <section aria-labelledby="review-title" className="card space-y-3">
            <h2 id="review-title" ref={reviewRef} tabIndex={-1} className="-mx-1 rounded px-1 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              Check your {template.short}
            </h2>
            <p className="text-sm text-ink-2">Every value that goes on the form, where it came from, and a way to change it.</p>
            <dl className="grid text-sm">
              {shownFields.map((f) => {
                const value = values[f.key] ?? "";
                const source = sourceOf(f, value, initial[f.key] ?? "", chips[f.key], values.save_ein === "on");
                // Under 640 px: label and Change on one line, then the value, then its source, each full width.
                return (
                  <div key={f.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 border-b border-line py-2 sm:grid-cols-[auto_1fr_auto]">
                    <dt className="order-1 text-ink-2">{f.label}</dt>
                    <dd className="order-3 col-span-2 min-w-0 sm:order-2 sm:col-span-1 sm:text-right">
                      <span className="block break-words whitespace-pre-line">{shownValue(f, value, initial[f.key] ?? "") || "Left blank"}</span>
                      {source && <span className="block font-mono text-xs text-ink-3">{source}</span>}
                    </dd>
                    <dd className="order-2 justify-self-end sm:order-3">
                      {f.fact === "ein" && initial[f.key] ? (
                        <SavedEinNote canSaveFacts={canSaveFacts} member={member} />
                      ) : (
                        <button type="button" onClick={() => change(f.key)} className="inline-flex min-h-6 items-center text-sm text-ink-2 underline">
                          Change<span className="sr-only"> {f.label}</span>
                        </button>
                      )}
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
                id="ack"
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
            {pending && (
              <p role="status" className="text-sm text-ink-2">
                Making your {template.short} from the official form…
              </p>
            )}
            <p className="text-sm text-ink-3">Nothing is saved until you approve.</p>
          </section>
        </>
      ) : left ? (
        <section className="card space-y-3 border-ink">
          <p className="text-sm text-ink-2">Your other answers are kept. Changed values need approving afresh.</p>
          <button className="btn" name="step" value="review" disabled={pending}>
            {pending ? "Checking…" : "Return to the check"}
          </button>
        </section>
      ) : last ? (
        <section className="card space-y-3 border-ink">
          <p className="text-sm text-ink-2">Next, you check every value and where it came from. Nothing is saved until you approve.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" name="step" value="review" disabled={pending}>
              {pending ? "Checking…" : `Review the ${template.short}`}
            </button>
            {steps.length > 1 && <BackButton onClick={() => setMoved({ of: state, at: current - 1 })} />}
          </div>
        </section>
      ) : (
        <section className="card space-y-3 border-ink">
          <p className="text-sm text-ink-2">
            Next: {steps[current + 1].title.toLowerCase()}. Nothing is saved until you approve at the end.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" name="step" value="next" disabled={pending}>
              {pending ? "Checking…" : "Continue"}
            </button>
            {current > 0 && <BackButton onClick={() => setMoved({ of: state, at: current - 1 })} />}
          </div>
        </section>
      )}
    </form>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn-ghost" onClick={onClick}>
      Back
    </button>
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
      <fieldset id={id} aria-describedby={describedBy}>
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
          <input type="checkbox" id={id} name={f.key} checked={value === "on"} onChange={(e) => onChange(e.target.checked ? "on" : "")} className="mt-0.5 size-4 accent-[var(--accent)]" aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
          {f.label}
        </label>
        <Help id={id} hint={f.hint} error={error} />
      </div>
    );
  }
  if (f.kind === "secret" && f.fact === "ein" && initial) {
    // Saved in Business facts: shown masked, as a labelled value (no input to type into).
    return (
      <div id={id}>
        <p id={`${id}-label`} className="label">
          {label}
        </p>
        <p className="font-mono text-sm" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
          {value}
        </p>
        <Help id={id} hint="From your business facts. The full number goes only into the PDF." error={error} />
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
          autoComplete={f.kind === "secret" ? "off" : f.autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={f.key === "ssn" ? (e) => formatSsn(e.target.value) !== e.target.value && onChange(formatSsn(e.target.value)) : undefined}
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
