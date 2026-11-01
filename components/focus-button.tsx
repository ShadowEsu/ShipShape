"use client";

/** A button that moves focus to a field elsewhere on the same page (e.g. an empty list's "add the first one"). */
export function FocusButton({ target, className, children }: { target: string; className: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => document.getElementById(target)?.focus()}>
      {children}
    </button>
  );
}
