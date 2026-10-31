"use client";

import { useState } from "react";

/** A secret link shown once: read-only field plus a copy button. */
export function CopyLink({ id, label, url }: { id: string; label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input id={id} readOnly value={url} className="input flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
