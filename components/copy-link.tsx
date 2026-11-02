"use client";

import { startTransition, useEffect, useRef, useState, ViewTransition } from "react";
import { Icon } from "./icons";

/** How long "Copied" stays before the button says "Copy link" again, in the redesigned app (Design spec §6.4). */
const COPIED_MS = 1600;

/**
 * A secret link shown once: read-only field plus a copy button. In the redesigned app (`v2`) the button's label flips
 * to a check and "Copied" (the chip's crossfade, §6.3), holds 1.6s, then flips back, so a second copy reads as one.
 */
export function CopyLink({ id, label, url, v2 = false }: { id: string; label: string; url: string; v2?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(back.current), []);
  const copied = state === "copied";
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input ref={input} id={id} readOnly value={url} className="input flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className={v2 ? "btn press min-w-36" : "btn"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              if (!v2) return setState("copied");
              clearTimeout(back.current);
              startTransition(() => setState("copied"));
              back.current = setTimeout(() => startTransition(() => setState("idle")), COPIED_MS);
            } catch {
              // No clipboard access (permission, an insecure page, an older browser): the link is
              // selected so the keyboard shortcut copies it.
              setState("failed");
              input.current?.focus();
              input.current?.select();
            }
          }}
        >
          {v2 ? (
            <ViewTransition update="v2-chip" default="none">
              <span className="inline-flex items-center gap-1.5">
                {copied && <Icon name="tick" size={18} />}
                {copied ? "Copied" : "Copy link"}
              </span>
            </ViewTransition>
          ) : copied ? (
            "Copied"
          ) : (
            "Copy link"
          )}
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
