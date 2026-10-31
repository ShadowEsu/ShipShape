"use client";

import { useActionState } from "react";
import { addDocument, addVersion, saveDetails, type FormState } from "./actions";

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

function Status({ state, savedText }: { state: FormState; savedText: string }) {
  if (state.error)
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

function DetailFields({ v }: { v?: DetailValues }) {
  return (
    <>
      <div>
        <label htmlFor="title" className="label">
          Title
        </label>
        <input id="title" name="title" required maxLength={200} defaultValue={v?.title} className="input" />
      </div>
      <div>
        <label htmlFor="kind" className="label">
          Kind
        </label>
        <select id="kind" name="kind" defaultValue={v?.kind ?? "other"} className="input">
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="issuer" className="label">
            Issued by
          </label>
          <input id="issuer" name="issuer" maxLength={200} defaultValue={v?.issuer ?? ""} className="input" placeholder="Insurer, agency, city" />
        </div>
        <div>
          <label htmlFor="counterparty" className="label">
            Other party
          </label>
          <input id="counterparty" name="counterparty" maxLength={200} defaultValue={v?.counterparty ?? ""} className="input" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="issued_on" className="label">
            Issued
          </label>
          <input id="issued_on" name="issued_on" type="date" defaultValue={v?.issued_on ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="expires_on" className="label">
            Expires
          </label>
          <input id="expires_on" name="expires_on" type="date" defaultValue={v?.expires_on ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="renews_on" className="label">
            Renewal notice
          </label>
          <input id="renews_on" name="renews_on" type="date" defaultValue={v?.renews_on ?? ""} className="input" />
        </div>
      </div>
    </>
  );
}

export function DetailsForm({ id, values }: { id: string; values: DetailValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDetails, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <DetailFields v={values} />
      <Status state={state} savedText="Saved. Reminders follow the new dates." />
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}

export function NewDocumentForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addDocument, {});
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="file" className="label">
          File
        </label>
        <input id="file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg" className="input py-1.5" />
        <p className="mt-1 text-xs text-ink-3">PDF, PNG or JPEG, up to 10 MB.</p>
      </div>
      <DetailFields />
      <Status state={state} savedText="" />
      <button className="btn" disabled={pending}>
        {pending ? "Uploading…" : "Add to vault"}
      </button>
    </form>
  );
}

export function VersionForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addVersion, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="version-file" className="label">
        Upload a new version
      </label>
      <input id="version-file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg" className="input py-1.5" />
      <Status state={state} savedText="New version added. Earlier versions stay in the history." />
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Uploading…" : "Add version"}
      </button>
    </form>
  );
}
