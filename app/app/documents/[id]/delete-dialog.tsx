"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { busyButton } from "@/components/submit-button";
import { deleteForGood, type DeleteDocumentState } from "../actions";
import { DELETE_PROMISE } from "../messages";

/**
 * Delete for good, on an archived document's page for owners and admins (C17). The button opens a native dialog that
 * names the document and says what happens to it (Security D5), with Cancel focused. A refusal (signed by someone,
 * a sign-in that's too old) keeps the dialog open with the reason and gets focus; done, the action goes to Documents.
 */
export function DeleteForGood({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState<DeleteDocumentState, FormData>(deleteForGood, {});
  const dialog = useRef<HTMLDialogElement>(null);
  const refusal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    refusal.current?.focus();
  }, [state]);
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-controls="delete-document" className="btn-danger" onClick={() => dialog.current?.showModal()}>
        Delete for good
      </button>
      <dialog
        ref={dialog}
        id="delete-document"
        aria-labelledby="delete-document-title"
        aria-describedby="delete-document-what"
        className="m-auto w-[min(92vw,400px)] rounded-2xl bg-paper p-5 text-ink backdrop:bg-black/30"
      >
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <h2 id="delete-document-title" className="text-lg font-semibold">
            {`Delete “${title}” for good?`}
          </h2>
          <p id="delete-document-what" className="mt-1 text-sm text-ink-2">
            {DELETE_PROMISE} Its versions and signature requests go with it; History keeps a line saying a document was deleted.
          </p>
          {state.error && (
            <div ref={refusal} role="alert" tabIndex={-1} className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {state.error}
              {state.reauth && (
                <>
                  {" "}
                  <Link href="/signin?next=documents" className="underline">
                    Sign in again
                  </Link>
                </>
              )}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" autoFocus className="btn-ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            {!state.reauth && (
              <button className="btn-danger" {...busyButton(pending)}>
                {pending ? "Deleting…" : "Delete for good"}
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
