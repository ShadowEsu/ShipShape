"use client";

import { useRef, useState } from "react";

/** A secret link shown once: read-only field plus a copy button. */
export function CopyLink({ id, label, url }: { id: string; label: string; url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input ref={input} id={id} readOnly value={url} className="input flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setState("copied");
            } catch {
              // No clipboard access (permission, an insecure page, an older browser): the link is
              // selected so the keyboard shortcut copies it.
              setState("failed");
              input.current?.focus();
              input.current?.select();
            }
          }}
        >
          {state === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>
      {state === "failed" && (
        <p role="alert" className="text-sm text-bad">
          Couldn&apos;t copy. The link is selected: press ⌘C or Ctrl+C.
        </p>
      )}
    </div>
  );
}
