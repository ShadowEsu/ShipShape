"use client";

import { useEffect, useRef } from "react";

/**
 * A filter menu's <details>, closing the way a menu does: Escape closes it and puts focus back on its summary, and it
 * closes when focus moves to something outside it (Tab past its last choice) or a press lands outside it. Focus leaving
 * for nowhere (a click on plain text, Safari's links that don't take focus on a click) doesn't count, so a click on one of
 * its own links is never undone mid-press. Without script it's the plain disclosure.
 */
export function FilterDetails({ className, children }: { className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const press = (e: PointerEvent) => {
      const d = ref.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) d.open = false;
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, []);
  return (
    <details
      ref={ref}
      className={className}
      onKeyDown={(e) => {
        const d = e.currentTarget;
        if (e.key !== "Escape" || !d.open) return;
        e.preventDefault();
        d.open = false;
        d.querySelector("summary")?.focus();
      }}
      onBlur={(e) => {
        const d = e.currentTarget;
        if (d.open && e.relatedTarget instanceof Node && !d.contains(e.relatedTarget)) d.open = false;
      }}
    >
      {children}
    </details>
  );
}
