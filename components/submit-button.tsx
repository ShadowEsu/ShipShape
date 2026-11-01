"use client";

import { useFormStatus } from "react-dom";

/** A plain form's submit button: while the form is sending it says so and can't be pressed again. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn",
  label,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  /** The accessible name when the visible text repeats down a list ("Sign out" per browser). */
  label?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-disabled={pending} aria-label={label}>
      {pending ? pendingLabel : children}
    </button>
  );
}
