"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { deleteMyAccount, renameMyWorkspace, type DeleteState, type RenameState } from "./actions";

/** After a refused submit, the thing to fix gets focus. */
function useFocusFirstError(state: object) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [state]);
  return form;
}

export function RenameWorkspaceForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<RenameState, FormData>(renameMyWorkspace, {});
  const form = useFocusFirstError(state);
  return (
    <form ref={form} action={action} className="space-y-3">
      <div>
        <label htmlFor="workspace-name" className="label">
          Name
        </label>
        <input
          id="workspace-name"
          name="name"
          defaultValue={state.name ?? name}
          required
          maxLength={120}
          autoComplete="organization"
          className="input"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "workspace-name-error workspace-name-hint" : "workspace-name-hint"}
        />
        {state.error && (
          <p id="workspace-name-error" className="mt-1 text-sm text-bad">
            {state.error}
          </p>
        )}
        <p id="workspace-name-hint" className="mt-1 text-xs text-ink-3">
          People you share with see this name on your passport links, signature requests and upload links.
        </p>
      </div>
      {state.saved && (
        <p role="status" className="text-sm text-ok">
          Saved. People you share with see the new name from now on.
        </p>
      )}
      <button className="btn" disabled={pending}>
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
    <form ref={form} action={action} className="space-y-3">
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
      {formError && (
        <div role="alert" tabIndex={-1} className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {formError}
          {state.reauth && (
            <>
              {" "}
              <Link href="/signin" className="underline">
                Sign in again
              </Link>
            </>
          )}
        </div>
      )}
      {!state.reauth && (
        <button className="btn-danger" disabled={pending}>
          {pending ? "Deleting…" : "Delete my account"}
        </button>
      )}
    </form>
  );
}
