"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The upload form's button. The form is a plain post (it works without JavaScript), which
 * useFormStatus can't see, so this listens for its form's submit: the label says "Sending…" at once
 * and a second press doesn't post the file again. A file over `maxBytes` isn't posted at all: the
 * page opens at `tooBigHref`, the address the upload route answers a too-big file with.
 */
export function SendButton({ label, maxBytes, tooBigHref }: { label: string; maxBytes: number; tooBigHref: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const form = button.current?.form;
    if (!form) return;
    let posted = false;
    const submit = (e: SubmitEvent) => {
      // Vercel answers a body over 4.5 MB with its own 413 page before the upload route runs
      // (next.config.ts), so the route's too-big message would never show; the browser checks first.
      // A sample link's form has no file field.
      const file = form.elements.namedItem("file");
      if (file instanceof HTMLInputElement && (file.files?.[0]?.size ?? 0) > maxBytes) {
        e.preventDefault();
        window.location.assign(tooBigHref);
        return;
      }
      if (posted) e.preventDefault();
      posted = true;
      setSending(true);
    };
    // Back from the next page, the browser can show this one as it was left; the post is over by then.
    const shown = () => {
      posted = false;
      setSending(false);
    };
    form.addEventListener("submit", submit);
    window.addEventListener("pageshow", shown);
    return () => {
      form.removeEventListener("submit", submit);
      window.removeEventListener("pageshow", shown);
    };
  }, [maxBytes, tooBigHref]);
  return (
    <button ref={button} className="btn" aria-disabled={sending || undefined}>
      {sending ? "Sending…" : label}
    </button>
  );
}
