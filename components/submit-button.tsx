"use client";

import { useFormStatus } from "react-dom";

/** A plain form's submit button: while the form is sending it says so and can't be pressed again. */
export function SubmitButton({ children, pendingLabel, className = "btn" }: { children: React.ReactNode; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
