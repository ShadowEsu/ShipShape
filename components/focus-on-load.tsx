"use client";

import { useEffect, useRef } from "react";

/**
 * An answer that arrives with a full page load (a form post's redirect): it takes focus once shown,
 * so a screen reader reads it out and the keyboard starts there. A live region that already holds its
 * text at load isn't announced. It wraps a Notice, so its focus outline takes the Notice's corners.
 */
export function FocusOnLoad({ role, children }: { role: "status" | "alert"; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} role={role} tabIndex={-1} className="rounded-xl">
      {children}
    </div>
  );
}
