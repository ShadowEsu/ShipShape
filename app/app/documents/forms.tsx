"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, type FormEvent } from "react";
import { CopyLink } from "@/components/copy-link";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_BIG } from "@/lib/upload-limit";
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

/** The line under a form: an error not about one field, or what was saved (the server's own line when it sends one). Field errors show under their field. */
function Status({ state, savedText }: { state: FormState; savedText: string }) {
  if (state.error && !state.field)
    return (
      <div role="alert" className="space-y-2 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
        <p>{state.error}</p>
        {state.fix && (
          <Link href={state.fix.href} className="underline">
            {state.fix.label}
          </Link>
        )}
      </div>
    );
  if (state.saved)
    return (
      <p role="status" className="text-sm text-ok">
        {state.savedText ?? savedText}
      </p>
    );
  return null;
}

/** What the field helpers need from a form's state: which input the error is about, and the message. */
interface FieldState {
  error?: string;
  field?: string;
}

/** Marks the field an error is about as invalid and points it at the message under it. */
function invalid(state: FieldState, name: string) {
  return state.field === name ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {};
}

function FieldError({ state, name }: { state: FieldState; name: string }) {
  if (state.field !== name) return null;
  return (
    <p id={`${name}-error`} className="mt-1 text-sm text-bad">
      {state.error}
    </p>
  );
}

/** Moves focus to the field an error is about, once for each result the form gets back. */
function useFocusField(state: FieldState, id: string | undefined) {
  useEffect(() => {
    if (id) document.getElementById(id)?.focus();
  }, [state, id]);
}

/**
 * The server's too-big refusal, given in the browser before the post: Next's action body limit and
 * Vercel's request cap answer a larger post with a bare 413 before the action runs, which would land
 * on the error page. Returns the state to show (the refusal, until the next result comes back) and
 * the submit handler that stops the post.
 */
function useFileGate(state: FormState): [FormState, (e: FormEvent<HTMLFormElement>) => void] {
  const [refusals, setRefusals] = useState(0);
  const [seen, setSeen] = useState(state);
  // A new result from the server replaces the browser's refusal.
  if (seen !== state) {
    setSeen(state);
    setRefusals(0);
  }
  const shown = useMemo(() => (refusals ? { error: UPLOAD_TOO_BIG, field: "file", values: state.values } : state), [refusals, state]);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const file = e.currentTarget.elements.namedItem("file");
    if (file instanceof HTMLInputElement && (file.files?.[0]?.size ?? 0) > MAX_UPLOAD_BYTES) {
      e.preventDefault();
      setRefusals((n) => n + 1);
    }
  };
  return [shown, onSubmit];
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
  const [result, action, pending] = useActionState<FormState, FormData>(addDocument, {});
  const [state, onSubmit] = useFileGate(result);
  useFocusField(state, state.field);
  const fileError = state.field === "file";
  return (
    <form action={action} onSubmit={onSubmit} className="space-y-4" noValidate>
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
        {pending ? "Uploading…" : "Add to documents"}
      </button>
    </form>
  );
}

/** `warning`: shown under the file field while a signing request is open, since a new version withdraws it (Design, wave 8 #7). */
export function VersionForm({ id, warning }: { id: string; warning?: string }) {
  const [result, action, pending] = useActionState<FormState, FormData>(addVersion, {});
  const [state, onSubmit] = useFileGate(result);
  useFocusField(state, state.field && "version-file");
  const describedBy = [warning && "version-file-warning", state.field === "file" && "file-error"].filter(Boolean).join(" ") || undefined;
  return (
    <form action={action} onSubmit={onSubmit} className="space-y-2" noValidate>
      <input type="hidden" name="id" value={id} />
      <label htmlFor="version-file" className="label">
        Upload a new version
      </label>
      <input
        id="version-file"
        name="file"
        type="file"
        required
        accept="application/pdf,image/png,image/jpeg"
        className="input py-1.5"
        aria-invalid={state.field === "file" || undefined}
        aria-describedby={describedBy}
      />
      {warning && (
        <p id="version-file-warning" className="text-xs text-ink-2">
          {warning}
        </p>
      )}
      <FieldError state={state} name="file" />
      <Status state={state} savedText="New version added. Earlier versions stay in the history." />
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Uploading…" : "Add version"}
      </button>
    </form>
  );
}

/** The sign form's input ids by input name, for focus. */
const SIGN_IDS = { signer_name: "signer-name", signer_email: "signer-email", days: "sign-days" };

export function SignRequestForm({ id, days, demo }: { id: string; days: readonly number[]; demo: boolean }) {
  const [state, action, pending] = useActionState<SignFormState, FormData>(askToSign, {});
  const [url, setUrl] = useState<string | null>(null);
  const created = state.created;
  useFocusField(state, state.field && SIGN_IDS[state.field]);

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
        <input id="signer-name" name="signer_name" required maxLength={120} autoComplete="off" defaultValue={state.values?.signer_name} className="input" {...invalid(state, "signer_name")} />
        <FieldError state={state} name="signer_name" />
      </div>
      <div>
        <label htmlFor="signer-email" className="label">
          Signer&apos;s email
        </label>
        <input id="signer-email" name="signer_email" type="email" required maxLength={200} autoComplete="off" defaultValue={state.values?.signer_email} className="input" {...invalid(state, "signer_email")} />
        <FieldError state={state} name="signer_email" />
      </div>
      <div>
        <label htmlFor="sign-days" className="label">
          Open for
        </label>
        <select key={state.values?.days} id="sign-days" name="days" defaultValue={state.values?.days ?? days[1]} className="input" {...invalid(state, "days")}>
          {days.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
        <FieldError state={state} name="days" />
      </div>
      {state.error && !state.field && (
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
