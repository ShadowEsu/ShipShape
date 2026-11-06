"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { CopyLink } from "@/components/copy-link";
import { changed, DiscardDialog, useLeaveGuard } from "@/components/leave-guard";
import { busyButton } from "@/components/submit-button";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_BIG } from "@/lib/upload-limit";
import { addDocument, addVersion, askToSign, saveDetails, type FormState, type SignFormState } from "./actions";
import { size } from "./[id]/shared";

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

/**
 * The line under a form: an error not about one field, or what was saved (the server's own line when it sends one). Field errors show under their field.
 * `savedRef`: the saved line can take focus, for a form whose focused button goes away once it has saved.
 */
function Status({ state, savedText, savedRef }: { state: FormState; savedText: string; savedRef?: RefObject<HTMLParagraphElement | null> }) {
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
      // saved-line: the redesigned app fades it in; it stays (Design spec §6.5: a fading message is lost to a screen reader).
      <p ref={savedRef} tabIndex={savedRef ? -1 : undefined} role="status" className="saved-line text-sm text-ok">
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
 * on the error page. Returns the state to show, the submit handler that stops the post, and the form's
 * change handler. Choosing another file clears an error about the file (the browser's refusal or the
 * server's), which is about a file no longer chosen. Once the browser has refused, the server's last
 * result stays answered until the next one comes back: bringing its error back would also pull focus
 * off the file just chosen.
 */
function useFileGate(state: FormState): [FormState, (e: FormEvent<HTMLFormElement>) => void, (e: FormEvent<HTMLFormElement>) => void] {
  const [refusals, setRefusals] = useState(0);
  const [picked, setPicked] = useState(false);
  const [seen, setSeen] = useState(state);
  // A new result from the server replaces the browser's refusal.
  if (seen !== state) {
    setSeen(state);
    setRefusals(0);
    setPicked(false);
  }
  const shown = useMemo(() => {
    if (refusals && !picked) return { error: UPLOAD_TOO_BIG, field: "file", values: state.values };
    return refusals || (picked && state.field === "file") ? { values: state.values } : state;
  }, [refusals, picked, state]);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const file = e.currentTarget.elements.namedItem("file");
    if (file instanceof HTMLInputElement && (file.files?.[0]?.size ?? 0) > MAX_UPLOAD_BYTES) {
      e.preventDefault();
      setRefusals((n) => n + 1);
      setPicked(false);
    }
  };
  const onChange = (e: FormEvent<HTMLFormElement>) => {
    if (e.target instanceof HTMLInputElement && e.target.type === "file") setPicked(true);
  };
  return [shown, onSubmit, onChange];
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
      <button className="btn-ghost" {...busyButton(pending)}>
        {pending ? "Saving…" : "Save details"}
      </button>
    </form>
  );
}

/**
 * A grouped-list row: the label, the field (children), and the field's error under it. `htmlFor` when the field's id isn't
 * its name. `required`: "(required)" after the label, as the fill form shows, since the row's placeholder says only "Add";
 * hidden from screen readers, which hear the field's own `required`.
 */
function FieldRow({ name, htmlFor, label, required, state, children }: { name: string; htmlFor?: string; label: string; required?: boolean; state: FieldState; children: React.ReactNode }) {
  return (
    <li>
      <div className="field-row">
        <label htmlFor={htmlFor ?? name}>
          {label}
          {required && (
            <span aria-hidden="true" className="text-ink-3">
              {" (required)"}
            </span>
          )}
        </label>
        {children}
      </div>
      {state.field === name && (
        <div className="px-4 pb-2 text-right">
          <FieldError state={state} name={name} />
        </div>
      )}
    </li>
  );
}

/**
 * Runs `sync` once React has put a form back to its defaults (after each action it resets the form, which fires the
 * form's `reset` event before the fields change, and no input event at all).
 */
function useAfterReset(field: RefObject<HTMLInputElement | null>, sync: (el: HTMLInputElement) => void) {
  const latest = useRef(sync);
  useEffect(() => {
    latest.current = sync;
  });
  useEffect(() => {
    const el = field.current;
    const form = el?.form;
    if (!el || !form) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onReset = () => {
      t = setTimeout(() => latest.current(el), 0);
    };
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("reset", onReset);
      clearTimeout(t);
    };
  }, [field]);
}

/**
 * A date row's field (Design 02 Nov): an empty date says "Add" like the other rows, where the browser would show
 * mm/dd/yyyy. Native date input underneath, so typing and the picker are the browser's own; while it has focus the
 * browser's segments show.
 */
function DateRowField({ name, defaultValue, state, className = "" }: { name: string; defaultValue: string; state: FieldState; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(defaultValue === "");
  useAfterReset(input, (el) => setEmpty(el.value === ""));
  // A refresh after another action can bring a new saved date with no reset; an untouched field takes it on.
  useEffect(() => {
    if (input.current) setEmpty(input.current.value === "");
  }, [defaultValue]);
  return (
    <span className="date-row" data-empty={empty || undefined}>
      <input
        ref={input}
        id={name}
        name={name}
        type="date"
        defaultValue={defaultValue}
        onChange={(e) => setEmpty(e.currentTarget.value === "")}
        className={`row-field ${className}`.trim()}
        {...invalid(state, name)}
      />
      <span aria-hidden="true" className="date-add">
        Add
      </span>
    </span>
  );
}

/** Who issues a document of each kind, as the Issued by field's hint (Design): none where nobody obvious does. */
const ISSUER_HINT: Record<string, string> = {
  nda: "The other company",
  agreement: "The other company",
  coi: "Insurer",
  permit: "Agency or city",
  license: "Agency or city",
};

/** A document's details as grouped-list rows (the redesigned document page and Add a document). `kind`: the one chosen in the form, for the Issued by hint. */
function DetailRows({ v, state, kind }: { v: Partial<DetailValues>; state: FormState; kind: string }) {
  return (
    <>
      <FieldRow name="title" label="Title" required state={state}>
        <input id="title" name="title" required maxLength={200} defaultValue={v.title} className="row-field" placeholder="Add" {...invalid(state, "title")} />
      </FieldRow>
      <FieldRow name="kind" label="Kind" state={state}>
        {/* Keyed: React applies a select's defaultValue only when it mounts, and resets the form to that after each action. */}
        <select key={v.kind} id="kind" name="kind" defaultValue={v.kind ?? "other"} className="row-field" {...invalid(state, "kind")}>
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow name="issuer" label="Issued by" state={state}>
        {/* An empty row says it can be filled (Design): the kind's issuer where one is obvious, "Add" otherwise. */}
        <input id="issuer" name="issuer" maxLength={200} defaultValue={v.issuer ?? ""} className="row-field" placeholder={ISSUER_HINT[kind] ?? "Add"} {...invalid(state, "issuer")} />
      </FieldRow>
      <FieldRow name="counterparty" label="Other party" state={state}>
        <input id="counterparty" name="counterparty" maxLength={200} defaultValue={v.counterparty ?? ""} className="row-field" placeholder="Add" {...invalid(state, "counterparty")} />
      </FieldRow>
      <FieldRow name="issued_on" label="Issued" state={state}>
        <DateRowField name="issued_on" defaultValue={v.issued_on ?? ""} state={state} />
      </FieldRow>
      <FieldRow name="expires_on" label="Expires" state={state}>
        {/* scroll-mt: Home's "Update its dates" lands on #expires_on; keep the rows above it in view. */}
        <DateRowField name="expires_on" defaultValue={v.expires_on ?? ""} state={state} className="scroll-mt-24" />
      </FieldRow>
      <FieldRow name="renews_on" label="Renewal notice" state={state}>
        <DateRowField name="renews_on" defaultValue={v.renews_on ?? ""} state={state} />
      </FieldRow>
    </>
  );
}

/**
 * The redesigned document page's details (the default look, Design 02 Nov): a grouped list, a label and its field
 * per row, posting to the same `saveDetails` as DetailsForm. Save shows only once something differs from what's
 * saved (on the phone it holds above the tab bar); "Saved" stays until the next change; leaving with changes asks.
 */
export function DetailsListForm({ id, values }: { id: string; values: DetailValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDetails, {});
  const form = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  // The kind chosen in the form, for the Issued by hint.
  const [kind, setKind] = useState(values.kind);
  const router = useRouter();
  useFocusField(state, state.field);
  const saved = useRef<HTMLParagraphElement>(null);
  // Set when a save comes back good: the focused Save button goes with the dock, so the Saved line takes focus.
  const justSaved = useRef(false);
  // A result came back and React put the fields back to their defaults (the saved values, or the ones sent back with an error).
  useEffect(() => {
    setDirty(form.current ? changed(form.current) : false);
    justSaved.current = Boolean(state.saved);
  }, [state]);
  // The Saved line shows a render later (once the fields read as unchanged); only then, and only if focus was lost with the button.
  useEffect(() => {
    if (!justSaved.current || !saved.current) return;
    justSaved.current = false;
    if (document.activeElement === document.body || !document.activeElement) saved.current.focus();
  });
  // A refused save hasn't saved what was sent, even though the fields now show it as their defaults.
  const unsaved = dirty || Boolean(state.error);
  const [leaving, ask] = useLeaveGuard(unsaved);
  const v = state.values ?? values;
  return (
    <form
      ref={form}
      action={action}
      onInput={(e) => {
        setDirty(changed(e.currentTarget));
        if (e.target instanceof HTMLSelectElement && e.target.name === "kind") setKind(e.target.value);
      }}
      className="space-y-3"
      noValidate
    >
      <input type="hidden" name="id" value={id} />
      <ul className="group-list plain">
        <DetailRows v={v} state={state} kind={kind} />
      </ul>
      {(state.error || !dirty) && <Status state={state} savedText="Saved. Reminders follow the new dates." savedRef={saved} />}
      {(unsaved || pending) && (
        // Docked at the foot of the phone's screen, 8px over the home indicator.
        // save-dock: while it shows, the page scrolls fields clear of it (ui-v2.css).
        <div className="save-dock sticky bottom-[calc(8px+env(safe-area-inset-bottom))] z-10 md:static">
          <button className="btn press w-full" {...busyButton(pending)}>
            {pending ? "Saving…" : "Save details"}
          </button>
        </div>
      )}
      <DiscardDialog
        ask={ask}
        body="The changes to this document's details aren't saved yet."
        onDiscard={() => {
          setDirty(false);
          ask.current?.close();
          if (leaving) router.push(leaving);
        }}
      />
    </form>
  );
}

export function NewDocumentForm() {
  const [result, action, pending] = useActionState<FormState, FormData>(addDocument, {});
  const [state, onSubmit, onChange] = useFileGate(result);
  useFocusField(state, state.field);
  const fileError = state.field === "file";
  return (
    <form action={action} onSubmit={onSubmit} onChange={onChange} className="space-y-4" noValidate>
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
      <button className="btn" {...busyButton(pending)}>
        {pending ? "Uploading…" : "Add to documents"}
      </button>
    </form>
  );
}

/** A chosen file's size, rounded up: a file just over the 4 MB limit never reads "4.0 MB" beside the refusal. */
const chosenSize = (n: number) => (n > 1024 * 1024 ? `${(Math.ceil(n / 104857.6) / 10).toFixed(1)}\u00A0MB` : size(n));

/**
 * What the file row's input is described by: the chosen file's name once there is one (its name stays "File Change", so
 * without this the file isn't read out), the size hint, and the error when there is one.
 */
export function fileRowDescribedBy(chosen: boolean, error: boolean): string {
  return [chosen && "file-name", "file-hint", error && "file-error"].filter(Boolean).join(" ");
}

/**
 * The file as a grouped-list row (Design 02 Nov): "Choose a file", then the chosen file's name and size with "Change".
 * One control: the real file input, out of sight but focusable (its focus ring shows on the visible button), named by
 * the row's label and the visible button ("File Choose a file", "File Change", so a spoken "Choose a file" finds it);
 * "Choose a file" and "Change" are labels for it, so a click on either opens the picker.
 */
function FileRow({ state }: { state: FormState }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const read = (el: HTMLInputElement) => {
    const f = el.files?.[0];
    setFile(f ? { name: f.name, size: f.size } : null);
  };
  // After a refused upload React empties the field (a browser can't put a file back), so the row says so too.
  useAfterReset(input, read);
  const error = state.field === "file";
  const ring = "peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2";
  return (
    <li>
      <div className="field-row">
        <span id="file-label" className="w-32 shrink-0 text-[15px] text-ink-2">
          File
        </span>
        <span className="ml-auto flex min-w-0 items-center justify-end gap-3">
          <input
            ref={input}
            id="file"
            name="file"
            type="file"
            required
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => read(e.currentTarget)}
            className="peer sr-only"
            aria-labelledby="file-label file-action"
            aria-invalid={error || undefined}
            aria-describedby={fileRowDescribedBy(file !== null, error)}
          />
          {file ? (
            <>
              {/* A long name truncates; its size always shows. */}
              <span className="flex min-w-0 items-baseline gap-1">
                <span id="file-name" className="min-w-0 truncate">
                  {file.name}
                </span>
                <span className="shrink-0 text-ink-3">· {chosenSize(file.size)}</span>
              </span>
              <label id="file-action" htmlFor="file" className={`shrink-0 cursor-pointer rounded text-sm text-ink underline ${ring}`}>
                Change
              </label>
            </>
          ) : (
            <label id="file-action" htmlFor="file" className={`btn-ghost press cursor-pointer ${ring}`}>
              Choose a file
            </label>
          )}
        </span>
      </div>
      <div className="px-4 pb-2.5">
        <p id="file-hint" className="text-[13px] text-ink-3">
          PDF, PNG or JPEG, up to 4 MB.
        </p>
        <FieldError state={state} name="file" />
      </div>
    </li>
  );
}

/** Add a document in the redesigned app (the default look, Design 02 Nov): the same action, fields and words as NewDocumentForm, as grouped-list rows; the one primary docked on the phone. */
export function NewDocumentFormV2() {
  const [result, action, pending] = useActionState<FormState, FormData>(addDocument, {});
  const [state, onSubmit, onChange] = useFileGate(result);
  const [kind, setKind] = useState(state.values?.kind ?? "other");
  useFocusField(state, state.field);
  return (
    <form
      action={action}
      onSubmit={onSubmit}
      onChange={onChange}
      onInput={(e) => {
        if (e.target instanceof HTMLSelectElement && e.target.name === "kind") setKind(e.target.value);
      }}
      className="space-y-3"
      noValidate
    >
      <ul className="group-list plain">
        <FileRow state={state} />
        <DetailRows v={state.values ?? {}} state={state} kind={kind} />
      </ul>
      <Status state={state} savedText="" />
      {/* Docked at the foot of the phone's screen, as Business facts' Save and confirm. */}
      <div className="save-dock sticky bottom-[calc(8px+env(safe-area-inset-bottom))] z-10 md:static">
        <button className="btn press w-full md:w-auto" {...busyButton(pending)}>
          {pending ? "Uploading…" : "Add to documents"}
        </button>
      </div>
    </form>
  );
}

/** `warning`: shown under the file field while a signing request is open, since a new version withdraws it (Design, wave 8 #7). */
export function VersionForm({ id, warning }: { id: string; warning?: string }) {
  const [result, action, pending] = useActionState<FormState, FormData>(addVersion, {});
  const [state, onSubmit, onChange] = useFileGate(result);
  useFocusField(state, state.field && "version-file");
  const describedBy = [warning && "version-file-warning", state.field === "file" && "file-error"].filter(Boolean).join(" ") || undefined;
  return (
    <form action={action} onSubmit={onSubmit} onChange={onChange} className="space-y-2" noValidate>
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
      <button className="btn-ghost" {...busyButton(pending)}>
        {pending ? "Uploading…" : "Add version"}
      </button>
    </form>
  );
}

/** The sign form's input ids by input name, for focus. */
const SIGN_IDS = { signer_name: "signer-name", signer_email: "signer-email", days: "sign-days" };

/** `rows`: the redesigned page's grouped list (Design, 02 Nov), the same fields and action as the boxed form. */
/** `signer`: a person from People ("Ask to sign" on their page), read by the server under row level security, filled in to start with. */
export function SignRequestForm({
  id,
  days,
  demo,
  rows = false,
  signer,
}: {
  id: string;
  days: readonly number[];
  demo: boolean;
  rows?: boolean;
  signer?: { name: string; email: string } | null;
}) {
  const [state, action, pending] = useActionState<SignFormState, FormData>(askToSign, {});
  const [url, setUrl] = useState<string | null>(null);
  const created = state.created;
  const ready = useRef<HTMLHeadingElement>(null);
  useFocusField(state, state.field && SIGN_IDS[state.field]);

  useEffect(() => {
    if (created) setUrl(`${window.location.origin}/s/${created.id}#${created.token}`);
  }, [created]);
  // The form (and its focused button) is replaced by the link, shown only once: its heading takes focus so it's read out.
  useEffect(() => {
    if (url) ready.current?.focus();
  }, [url]);

  if (url && created) {
    return (
      <div className="space-y-3">
        <h3 ref={ready} tabIndex={-1} className="text-sm font-medium">
          Signing link ready
        </h3>
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
        {/* The redesigned page's is a 24px target (WCAG 2.5.8); the earlier page's as it was. */}
        <button type="button" className={rows ? "inline-flex min-h-6 items-center text-sm text-ink-2 underline" : "text-sm text-ink-2 underline"} onClick={() => setUrl(null)}>
          Ask someone else
        </button>
      </div>
    );
  }

  const name = (
    // scroll-mt: "Ask to sign" lands here (rows) and keeps the row above in view under the phone's header.
    <input
      id="signer-name"
      name="signer_name"
      required
      maxLength={120}
      autoComplete="off"
      defaultValue={state.values?.signer_name ?? signer?.name}
      placeholder={rows ? "Add" : undefined}
      className={rows ? "row-field scroll-mt-24" : "input"}
      {...invalid(state, "signer_name")}
    />
  );
  const email = (
    <input
      id="signer-email"
      name="signer_email"
      type="email"
      required
      maxLength={200}
      autoComplete="off"
      defaultValue={state.values?.signer_email ?? signer?.email}
      placeholder={rows ? "name@company.com" : undefined}
      className={rows ? "row-field" : "input"}
      {...invalid(state, "signer_email")}
    />
  );
  const open = (
    <select key={state.values?.days} id="sign-days" name="days" defaultValue={state.values?.days ?? days[1]} className={rows ? "row-field" : "input"} {...invalid(state, "days")}>
      {days.map((d) => (
        <option key={d} value={d}>
          {d} days
        </option>
      ))}
    </select>
  );
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="id" value={id} />
      {rows ? (
        <ul className="group-list plain">
          <FieldRow name="signer_name" htmlFor="signer-name" label="Signer's name" required state={state}>
            {name}
          </FieldRow>
          <FieldRow name="signer_email" htmlFor="signer-email" label="Signer's email" required state={state}>
            {email}
          </FieldRow>
          <FieldRow name="days" htmlFor="sign-days" label="Open for" state={state}>
            {open}
          </FieldRow>
        </ul>
      ) : (
        <>
          <div>
            <label htmlFor="signer-name" className="label">
              Signer&apos;s name
            </label>
            {name}
            <FieldError state={state} name="signer_name" />
          </div>
          <div>
            <label htmlFor="signer-email" className="label">
              Signer&apos;s email
            </label>
            {email}
            <FieldError state={state} name="signer_email" />
          </div>
          <div>
            <label htmlFor="sign-days" className="label">
              Open for
            </label>
            {open}
            <FieldError state={state} name="days" />
          </div>
        </>
      )}
      {state.error && !state.field && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn-ghost" {...busyButton(pending)}>
        {pending ? "Making the link…" : "Make a signing link"}
      </button>
    </form>
  );
}
