"use client";

import { useRef } from "react";
import { Icon } from "@/components/icons";

/**
 * A sample paper's first page in the document page's 3:4 crop; a tap opens the whole page in a sheet (Design, 4 Nov):
 * from the bottom on a phone, centred from md up. Both are the same drawing the server sent (`page`), so opening it
 * reads no file and asks the server for nothing.
 */
export function PagePreview({ title, page }: { title: string; page: React.ReactNode }) {
  const sheet = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-controls="page-preview"
        onClick={() => sheet.current?.showModal()}
        className="press block h-52 w-full overflow-hidden rounded-2xl border border-line px-8 pt-6 text-left md:h-64"
      >
        <span className="sr-only">Show the first page of {title}</span>
        <span className="mx-auto block w-full max-w-[300px] overflow-hidden rounded-t-md border border-b-0 border-[var(--line-2)]">{page}</span>
      </button>
      <dialog
        ref={sheet}
        id="page-preview"
        aria-labelledby="page-preview-title"
        className="sheet fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-none rounded-t-[20px] bg-paper p-0 pb-[env(safe-area-inset-bottom)] text-ink backdrop:bg-black/30 md:inset-0 md:m-auto md:h-fit md:w-[min(92vw,640px)] md:rounded-2xl"
        onClick={(e) => {
          // A click on the backdrop lands on the dialog element itself.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line md:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-1">
          <h2 id="page-preview-title" className="section-title min-w-0 truncate">
            First page
          </h2>
          <button type="button" autoFocus onClick={() => sheet.current?.close()} className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="max-h-[80dvh] overflow-y-auto px-4 pb-4">
          <div className="overflow-hidden rounded-md border border-[var(--line-2)]">{page}</div>
        </div>
      </dialog>
    </>
  );
}
