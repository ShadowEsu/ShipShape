"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/** Whether any field differs from what the form was drawn with: a field's default is the saved value. */
export function changed(form: HTMLFormElement): boolean {
  return Array.from(form.elements).some((el) =>
    el instanceof HTMLInputElement
      ? el.type !== "hidden" && el.value !== el.defaultValue
      : el instanceof HTMLSelectElement && Array.from(el.options).some((o) => o.selected !== o.defaultSelected),
  );
}

/**
 * Asks "Discard changes?" before a link in the app leaves the page while `on`; a reload or closing the tab gets the
 * browser's own question. Links that don't leave the page (a #fragment here, a file that downloads, a new tab) pass.
 */
export function useLeaveGuard(on: boolean): [string | null, RefObject<HTMLDialogElement | null>] {
  const [leaving, setLeaving] = useState<string | null>(null);
  const ask = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!on) return;
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    // Capture on the document runs before Next's Link handler on the React root, so stopping it here stops the navigation.
    const click = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download") || a.hasAttribute("data-stays")) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const to = new URL(a.href);
      if (to.origin !== window.location.origin || (to.pathname === window.location.pathname && to.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaving(to.pathname + to.search + to.hash);
      ask.current?.showModal();
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [on]);
  return [leaving, ask];
}

/** The guard's question: what isn't saved (`body`), Keep editing (focused), or Discard, which `onDiscard` carries out. */
export function DiscardDialog({ ask, body, onDiscard }: { ask: RefObject<HTMLDialogElement | null>; body: string; onDiscard: () => void }) {
  return (
    <dialog
      ref={ask}
      aria-labelledby="discard-title"
      aria-describedby="discard-body"
      className="m-auto w-[min(92vw,360px)] rounded-2xl bg-paper p-5 text-ink backdrop:bg-black/30"
    >
      <h2 id="discard-title" className="text-lg font-semibold">
        Discard changes?
      </h2>
      <p id="discard-body" className="mt-1 text-sm text-ink-2">
        {body}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" autoFocus className="btn-ghost" onClick={() => ask.current?.close()}>
          Keep editing
        </button>
        <button type="button" className="btn-danger" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </dialog>
  );
}
