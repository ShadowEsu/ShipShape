"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { DaysChoice } from "@/components/days-choice";
import { addVendorAction, deleteVendorFileAction, makeVendorLink, type CollectFormState } from "./actions";

function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" tabIndex={-1} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
      {error}
    </p>
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

/** After a refused submit, the first thing to fix gets focus. */
function useFocusFirstError(state: CollectFormState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [state]);
  return form;
}

export function NewVendorForm({ kinds }: { kinds: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState<CollectFormState, FormData>(addVendorAction, {});
  const typed = state.values;
  const errors = state.fieldErrors ?? {};
  const form = useFocusFirstError(state);
  return (
    <form ref={form} action={action} className="space-y-5" noValidate>
      <div>
        <label htmlFor="vendor-name" className="label">
          Vendor or subcontractor
        </label>
        <input
          id="vendor-name"
          name="name"
          required
          maxLength={120}
          placeholder="e.g. Rivera Electric"
          defaultValue={typed?.name}
          className="input"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "vendor-name-error" : undefined}
        />
        <FieldError id="vendor-name-error" error={errors.name} />
      </div>
      <div>
        <label htmlFor="vendor-email" className="label">
          Email <span className="font-normal text-ink-3">(optional, only for you; ShipShape doesn&apos;t email vendors)</span>
        </label>
        <input
          id="vendor-email"
          name="email"
          type="email"
          maxLength={254}
          autoComplete="off"
          defaultValue={typed?.email}
          className="input"
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "vendor-email-error" : undefined}
        />
        <FieldError id="vendor-email-error" error={errors.email} />
      </div>
      <fieldset aria-describedby={errors.kinds ? "vendor-kinds-error" : undefined}>
        <legend className="label">Documents to ask for</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {kinds.map((k) => (
            <label key={k.key} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
              <input
                type="checkbox"
                name="kind"
                value={k.key}
                defaultChecked={typed ? typed.kinds.includes(k.key) : k.key === "w9" || k.key === "coi"}
                className="size-4 accent-[var(--accent)]"
                aria-invalid={errors.kinds ? true : undefined}
                aria-describedby={errors.kinds ? "vendor-kinds-error" : undefined}
              />
              {k.label}
            </label>
          ))}
        </div>
        <FieldError id="vendor-kinds-error" error={errors.kinds} />
      </fieldset>
      <FormError error={state.error} />
      <button className="btn" disabled={pending}>
        {pending ? "Adding…" : "Add vendor"}
      </button>
    </form>
  );
}

/**
 * The redesigned app's Add a vendor (PR 7 plan): name and email as field rows, the documents to ask for as rows with
 * their box at the right. Same fields, checks, words and action as NewVendorForm; the email's note sits under its row.
 */
export function NewVendorFormV2({ kinds }: { kinds: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState<CollectFormState, FormData>(addVendorAction, {});
  const typed = state.values;
  const errors = state.fieldErrors ?? {};
  const form = useFocusFirstError(state);
  return (
    <form ref={form} action={action} className="space-y-6" noValidate>
      <div>
        <ul className="group-list plain">
          <li className="field-row">
            <label htmlFor="vendor-name">Vendor</label>
            <input
              id="vendor-name"
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Rivera Electric"
              defaultValue={typed?.name}
              className="row-field"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "vendor-name-error" : undefined}
            />
          </li>
          <li className="field-row">
            <label htmlFor="vendor-email">Email</label>
            <input
              id="vendor-email"
              name="email"
              type="email"
              maxLength={254}
              autoComplete="off"
              defaultValue={typed?.email}
              className="row-field"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "vendor-email-note vendor-email-error" : "vendor-email-note"}
            />
          </li>
        </ul>
        <p id="vendor-email-note" className="mt-2 px-1 text-[13px] text-ink-3">
          Email is optional, only for you; ShipShape doesn&apos;t email vendors.
        </p>
        <FieldError id="vendor-name-error" error={errors.name} />
        <FieldError id="vendor-email-error" error={errors.email} />
      </div>
      <fieldset aria-describedby={errors.kinds ? "vendor-kinds-error" : undefined}>
        <legend className="mb-2 px-1 text-[13px] text-ink-3">Documents to ask for</legend>
        <ul className="group-list plain">
          {kinds.map((k) => (
            <li key={k.key}>
              <label className="group-row min-h-13 cursor-pointer hover:bg-tile">
                <span className="min-w-0 flex-1">{k.label}</span>
                <input
                  type="checkbox"
                  name="kind"
                  value={k.key}
                  defaultChecked={typed ? typed.kinds.includes(k.key) : k.key === "w9" || k.key === "coi"}
                  className="size-5 shrink-0 accent-[var(--accent)]"
                  aria-invalid={errors.kinds ? true : undefined}
                  aria-describedby={errors.kinds ? "vendor-kinds-error" : undefined}
                />
              </label>
            </li>
          ))}
        </ul>
        <FieldError id="vendor-kinds-error" error={errors.kinds} />
      </fieldset>
      <FormError error={state.error} />
      <button className="btn press" disabled={pending}>
        {pending ? "Adding…" : "Add vendor"}
      </button>
    </form>
  );
}

/**
 * The end of making an upload link: what was made, what happens next, and the one thing to do (copy it). In the
 * redesigned app it arrives (§6.5) and Copy turns to a check.
 */
export function VendorLinkReady({ vendorName, days, url, v2 }: { vendorName: string; days: number; url: string; v2?: boolean }) {
  return (
    <div className={v2 ? "arrive space-y-3" : "space-y-3"} role="status">
      <h2 className="font-semibold">Upload link for {vendorName} is ready</h2>
      <p className="text-sm text-ink-2">
        It works for {days} days. Copy it and send it to {vendorName} yourself: ShipShape keeps only a fingerprint of it and can&apos;t show
        it again. The files they send land under Files received.
      </p>
      <CopyLink id="collect-url" label="Upload link" url={url} v2={v2} />
    </div>
  );
}

export function VendorLinkForm({ vendorId, vendorName, days, v2 }: { vendorId: string; vendorName: string; days: readonly number[]; v2?: boolean }) {
  const [state, action, pending] = useActionState<CollectFormState, FormData>(makeVendorLink, {});
  const [url, setUrl] = useState<string | null>(null);
  const form = useFocusFirstError(state);

  useEffect(() => {
    if (state.link) setUrl(`${window.location.origin}/c/${state.link.id}#${state.link.token}`);
  }, [state.link]);

  if (url && state.link) return <VendorLinkReady vendorName={vendorName} days={state.link.days} url={url} v2={v2} />;
  return (
    <form ref={form} action={action} className="space-y-4" noValidate>
      <input type="hidden" name="vendor" value={vendorId} />
      <fieldset>
        {v2 ? (
          <>
            <legend className="mb-2 px-1 text-[13px] text-ink-3">The link stops working after</legend>
            <DaysChoice days={days} defaultDays={days[1]} />
          </>
        ) : (
          <>
            <legend className="label">The link stops working after</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {days.map((d, i) => (
                <label key={d} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
                  <input type="radio" name="days" value={d} defaultChecked={i === 1} className="accent-[var(--accent)]" />
                  {d} days
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>
      <FormError error={state.error} />
      <button className={v2 ? "btn press" : "btn"} disabled={pending}>
        {pending ? "Making the link…" : "Make an upload link"}
      </button>
    </form>
  );
}

/** Delete asks once more in place: the file and its stored copy go for good. */
export function DeleteVendorFileForm({ fileId, filename }: { fileId: string; filename: string }) {
  const [state, action, pending] = useActionState<CollectFormState, FormData>(deleteVendorFileAction, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setConfirming(true)} aria-label={`Delete ${filename}`}>
        Delete
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={fileId} />
      <span className="text-sm text-ink-2">Delete this file for good?</span>
      <button className="btn-danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete file"}
      </button>
      <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </button>
      <FormError error={state.error} />
    </form>
  );
}
