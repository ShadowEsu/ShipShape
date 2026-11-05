"use client";

import { useFormStatus } from "react-dom";

/**
 * A button's props while its form is sending (`busy`): it can't be pressed again, yet stays focusable, so focus stays on
 * it and its sending text ("Saving…") is read. A disabled button would drop focus to the page. A press (or Enter in a
 * field, which presses the form's first button) is cancelled instead. `data-busy` styles it (globals.css): dimmed in
 * v1, its own colours with a progress pointer in v2 (the label says it's busy). `onClick` runs only while not busy.
 */
export function busyButton(busy: boolean, onClick?: () => void) {
  return {
    "aria-disabled": busy || undefined,
    "data-busy": busy || undefined,
    onClick: (e: { preventDefault(): void }) => {
      if (busy) e.preventDefault();
      else onClick?.();
    },
  };
}

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
    <button className={className} {...busyButton(pending)} aria-label={pending ? undefined : label}>
      {pending ? pendingLabel : children}
    </button>
  );
}
