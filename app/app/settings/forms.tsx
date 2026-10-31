"use client";

import { useActionState } from "react";
import { deleteMyAccount, renameMyWorkspace, type DeleteState, type RenameState } from "./actions";

export function RenameWorkspaceForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState<RenameState, FormData>(renameMyWorkspace, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="workspace-name" className="label">
          Name
        </label>
        <input id="workspace-name" name="name" defaultValue={state.name ?? name} required maxLength={120} autoComplete="organization" className="input" aria-describedby="workspace-name-hint" />
        <p id="workspace-name-hint" className="mt-1 text-xs text-ink-3">
          People you share with see this name on your passport links, signature requests and upload links.
        </p>
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm text-ok">
          Saved.
        </p>
      )}
      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </button>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteMyAccount, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="confirm-delete" className="label">
          Type DELETE to confirm
        </label>
        <input id="confirm-delete" name="confirm" required autoComplete="off" spellCheck={false} className="input sm:w-56" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn-danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete my account"}
      </button>
    </form>
  );
}
