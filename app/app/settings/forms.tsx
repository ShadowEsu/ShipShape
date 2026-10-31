"use client";

import { useActionState } from "react";
import { deleteMyAccount, type DeleteState } from "./actions";

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
