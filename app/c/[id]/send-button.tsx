"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The upload form's button. The form is a plain post (it works without JavaScript), which
 * useFormStatus can't see, so this listens for its form's submit: the label says "Sending…" at once
 * and a second press doesn't post the file again.
 */
export function SendButton({ label }: { label: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const form = button.current?.form;
    if (!form) return;
    let posted = false;
    const submit = (e: SubmitEvent) => {
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
  }, []);
  return (
    <button ref={button} className="btn" aria-disabled={sending || undefined}>
      {sending ? "Sending…" : label}
    </button>
  );
}
