"use client";

import { useActionState, useEffect, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { addDocument, addVersion, askToSign, saveDetails, type FormState, type SignFormState } from "./actions";

const KINDS: [string, string][] = [
  ["w9", "W-9"],
  ["coi", "Insurance certificate"],
  ["license", "License"],
  ["permit", "Permit"],
  ["nda", "NDA"],
  ["agreement", "Agreement"],
  ["registration", "Registration"],
  ["tax", "Tax document"],
  ["other", "Other"],
];

export interface DetailValues {
  title: string;
  kind: string;
  issuer: string | null;
  counterparty: string | null;
  issued_on: string | null;
  expires_on: string | null;
  renews_on: string | null;
}

/** The line under a form: an error not about one field, or what was saved. Field errors show under their field. */
function Status({ state, savedText }: { state: FormState; savedText: string }) {
  if (state.error && !state.field)
    return (
      <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
        {state.error}
      </p>
    );
  if (state.saved)
    return (
      <p role="status" className="text-sm text-ok">
        {savedText}
      </p>
    );
  return null;
}

/** Marks the field an error is about as invalid and points it at the message under it. */
function invalid(state: FormState, name: string) {
  return state.field === name ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
}

function FieldError({ state, name }: { state: FormState; name: string }) {
  if (state.field !== name) return null;
  return (
    <p id={`${name}-error`} className="mt-1 text-sm text-bad">
      {state.error}
    </p>
  );
}

/** Moves focus to the field an error is about, once for each result the form gets back. */
function useFocusField(state: FormState, id: string | undefined) {
  useEffect(() => {
    if (id) document.getElementById(id)?.focus();
  }, [state, id]);
}

// Container queries: the same fields sit in the wide add form and the narrow document rail.
function DetailFields({ v, state }: { v?: DetailValues; state: FormState }) {
  return (
    <div className="@container space-y-3">
      <div>
        <label htmlFor="title" className="label">
          Title
        </label>
        <input id="title" name="title" required maxLength={200} defaultValue={v?.title} className="input" {...invalid(state, "title")} />
        <FieldError state={state} name="title" />
      </div>
      <div>
        <label htmlFor="kind" className="label">
          Kind
        </label>
        {/* Keyed: React applies a select's defaultValue only when it mounts, and resets the form to that after each action. */}
        <select key={v?.kind} id="kind" name="kind" defaultValue={v?.kind ?? "other"} className="input" {...invalid(state, "kind")}>
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <FieldError state={state} name="kind" />
      </div>
      <div className="grid gap-3 @md:grid-cols-2">
        <div>
          <label htmlFor="issuer" className="label">
            Issued by
          </label>
          <input id="issuer" name="issuer" maxLength={200} defaultValue={v?.issuer ?? ""} className="input" placeholder="Insurer, agency, city" {...invalid(state, "issuer")} />
          <FieldError state={state} name="issuer" />
        </div>
        <div>
          <label htmlFor="counterparty" className="label">
            Other party
          </label>
          <input id="counterparty" name="counterparty" maxLength={200} defaultValue={v?.counterparty ?? ""} className="input" {...invalid(state, "counterparty")} />
          <FieldError state={state} name="counterparty" />
        </div>
      </div>
      <div className="grid gap-3 @md:grid-cols-3">
        <div>
          <label htmlFor="issued_on" className="label">
            Issued
          </label>
          <input id="issued_on" name="issued_on" type="date" defaultValue={v?.issued_on ?? ""} className="input" {...invalid(state, "issued_on")} />
          <FieldError state={state} name="issued_on" />
        </div>
        <div>
          <label htmlFor="expires_on" className="label">
            Expires
          </label>
          {/* scroll-mt: the setup checklist links to #expires_on; keep the label in view above it. */}
          <input id="expires_on" name="expires_on" type="date" defaultValue={v?.expires_on ?? ""} className="input scroll-mt-16" {...invalid(state, "expires_on")} />
          <FieldError state={state} name="expires_on" />
        </div>
        <div>
          <label htmlFor="renews_on" className="label">
            Renewal notice
          </label>
          <input id="renews_on" name="renews_on" type="date" defaultValue={v?.renews_on ?? ""} className="input" {...invalid(state, "renews_on")} />
          <FieldError state={state} name="renews_on" />
        </div>
      </div>
    </div>
  );
}

export function DetailsForm({ id, values }: { id: string; values: DetailValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDetails, {});
  useFocusField(state, state.field);
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <DetailFields v={state.values ?? values} state={state} />
      <Status state={state} savedText="Saved. Reminders follow the new dates." />
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}

export function NewDocumentForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addDocument, {});
  useFocusField(state, state.field);
  const fileError = state.field === "file";
  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label htmlFor="file" className="label">
          File
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          accept="application/pdf,image/png,image/jpeg"
          className="input py-1.5"
          aria-invalid={fileError || undefined}
          aria-describedby={fileError ? "file-hint file-error" : "file-hint"}
        />
        <p id="file-hint" className="mt-1 text-xs text-ink-3">
          PDF, PNG or JPEG, up to 4 MB.
        </p>
        <FieldError state={state} name="file" />
      </div>
      <DetailFields v={state.values} state={state} />
      <Status state={state} savedText="" />
      <button className="btn" disabled={pending}>
        {pending ? "Uploading…" : "Add to vault"}
      </button>
    </form>
  );
}

export function VersionForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addVersion, {});
  useFocusField(state, state.field && "version-file");
  return (
    <form action={action} className="space-y-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <label htmlFor="version-file" className="label">
        Upload a new version
      </label>
      <input id="version-file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg" className="input py-1.5" {...invalid(state, "file")} />
      <FieldError state={state} name="file" />
      <Status state={state} savedText="New version added. Earlier versions stay in the history." />
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Uploading…" : "Add version"}
      </button>
    </form>
  );
}

export function SignRequestForm({ id, days, demo }: { id: string; days: readonly number[]; demo: boolean }) {
  const [state, action, pending] = useActionState<SignFormState, FormData>(askToSign, {});
  const [url, setUrl] = useState<string | null>(null);
  const created = state.created;

  useEffect(() => {
    if (created) setUrl(`${window.location.origin}/s/${created.id}#${created.token}`);
  }, [created]);

  if (url && created) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Signing link ready</p>
        <p className="text-sm text-ink-2">
          The signer gets ShipShape&apos;s own copy of this document: form fields and notes drawn in as they show on screen, and nothing that can run.{" "}
          <a href={`/app/documents/${id}/file?request=${created.id}`} className="underline">
            Download that copy
          </a>{" "}
          and check it before you send the link.
        </p>
        <p className="text-sm text-ink-2">
          Send it to the signer yourself; ShipShape shows it only once. They confirm their email with a code before they sign.
          {demo && " To try it, open the link in this browser; the code lands under Deadlines → Reminders sent."}
        </p>
        <CopyLink id="sign-url" label="Signing link" url={url} />
        <button type="button" className="text-sm text-ink-2 underline" onClick={() => setUrl(null)}>
          Ask someone else
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <div>
        <label htmlFor="signer-name" className="label">
          Signer&apos;s name
        </label>
        <input id="signer-name" name="signer_name" required maxLength={120} autoComplete="off" defaultValue={state.values?.signer_name} className="input" />
      </div>
      <div>
        <label htmlFor="signer-email" className="label">
          Signer&apos;s email
        </label>
        <input id="signer-email" name="signer_email" type="email" required maxLength={200} autoComplete="off" defaultValue={state.values?.signer_email} className="input" />
      </div>
      <div>
        <label htmlFor="sign-days" className="label">
          Open for
        </label>
        <select key={state.values?.days} id="sign-days" name="days" defaultValue={state.values?.days ?? days[1]} className="input">
          {days.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Making the link…" : "Make a signing link"}
      </button>
    </form>
  );
}
