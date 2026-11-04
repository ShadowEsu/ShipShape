"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { deleteMyAccount, renameMyWorkspace, type DeleteState, type RenameState } from "./actions";

/** After a refused submit, the thing to fix gets focus. Billing's Upgrade uses it too. */
export function useFocusFirstError(state: object) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [state]);
  return form;
}

/** The workspace's name; in the redesigned app (v2) the field is a grouped-list row with its hint under the group. */
export function RenameWorkspaceForm({ name, v2 }: { name: string; v2?: boolean }) {
  const [state, action, pending] = useActionState<RenameState, FormData>(renameMyWorkspace, {});
  const form = useFocusFirstError(state);
  const input = (className: string) => (
    <input
      id="workspace-name"
      name="name"
      defaultValue={state.name ?? name}
      required
      maxLength={80}
      autoComplete="organization"
      className={className}
      aria-invalid={state.error ? true : undefined}
      aria-describedby={state.error ? "workspace-name-error workspace-name-hint" : "workspace-name-hint"}
    />
  );
  const notes = (
    <>
      {state.error && (
        <p id="workspace-name-error" className={v2 ? "mt-2 px-1 text-sm text-bad" : "mt-1 text-sm text-bad"}>
          {state.error}
        </p>
      )}
      <p id="workspace-name-hint" className={v2 ? "mt-2 px-1 text-[13px] text-ink-3" : "mt-1 text-xs text-ink-3"}>
        People you share with see this name on your passport links, signature requests and upload links.
      </p>
    </>
  );
  return (
    <form ref={form} action={action} className="space-y-3" noValidate>
      {v2 ? (
        <div>
          <ul className="group-list plain">
            <li className="field-row">
              <label htmlFor="workspace-name">Name</label>
              {input("row-field")}
            </li>
          </ul>
          {notes}
        </div>
      ) : (
        <div>
          <label htmlFor="workspace-name" className="label">
            Name
          </label>
          {input("input")}
          {notes}
        </div>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-ok">
          Saved. People you share with see the new name from now on.
        </p>
      )}
      <button className={v2 ? "btn press" : "btn"} disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

/**
 * The last step before deleting: what goes, by name, then one button named for the action.
 * `deleted` are the workspaces where the person is the only owner; `left` the ones they leave.
 */
export function DeleteAccountForm({ deleted, left }: { deleted: string[]; left: string[] }) {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteMyAccount, {});
  const form = useFocusFirstError(state);
  const confirmError = state.field === "confirm" ? state.error : undefined;
  const formError = state.field ? undefined : state.error;
  return (
    <form ref={form} action={action} className="space-y-3" noValidate>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-ink-2">Deleted with everything in it</dt>
        <dd>{deleted.length ? deleted.join(", ") : "None: every workspace you're in has another owner"}</dd>
        {left.length > 0 && (
          <>
            <dt className="text-ink-2">You leave</dt>
            <dd>{left.join(", ")}</dd>
          </>
        )}
      </dl>
      <div>
        <label htmlFor="confirm-delete" className="label">
          Type DELETE to confirm
        </label>
        <input
          id="confirm-delete"
          name="confirm"
          required
          autoComplete="off"
          spellCheck={false}
          defaultValue={state.typed}
          className="input sm:w-56"
          aria-invalid={confirmError ? true : undefined}
          aria-describedby={confirmError ? "confirm-delete-error" : undefined}
        />
        {confirmError && (
          <p id="confirm-delete-error" className="mt-1 text-sm text-bad">
            {confirmError}
          </p>
        )}
      </div>
      {formError && <DeleteRefused error={formError} reauth={state.reauth} write={state.write} />}
      {!state.reauth && (
        <button className="btn-danger" disabled={pending}>
          {pending ? "Deleting…" : "Delete my account"}
        </button>
      )}
    </form>
  );
}

/** Why the deletion didn't happen, with the one next step: sign in again, write to us, or wait for payments. */
export function DeleteRefused({ error, reauth, write }: Pick<DeleteState, "reauth" | "write"> & { error: string }) {
  return (
    <div role="alert" tabIndex={-1} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
      {error}
      {reauth && (
        <>
          {" "}
          <Link href="/signin?next=delete" className="underline">
            Sign in again
          </Link>
        </>
      )}
      {write &&
        (write.contact ? (
          <>
            {" "}
            <a href={`mailto:${write.contact}?subject=${encodeURIComponent("Cancel my ShipShape subscription")}`} className="underline">
              Write to us
            </a>{" "}
            and we&apos;ll cancel it; then delete your account.
          </>
        ) : (
          " ShipShape can't cancel it until payments are back on. Try again later: deleting cancels it for you."
        ))}
    </div>
  );
}
