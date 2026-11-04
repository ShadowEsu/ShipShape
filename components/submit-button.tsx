"use client";

import { Button } from "glisse";
import { useFormStatus } from "react-dom";
import { useGlass } from "@/components/glass";

// Under glass, the app's pill classes become Glisse buttons: the primary stays filled in ink (Design glass spec §1),
// the secondary turns to glass, and a destructive one is filled in the error red. Any other class keeps its own look.
const GLISSE: Record<string, { variant: "glass" | "filled"; tint?: string }> = {
  btn: { variant: "filled", tint: "var(--ink)" },
  "btn-ghost": { variant: "glass" },
  "btn-danger": { variant: "filled", tint: "var(--bad)" },
};

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
  const glass = useGlass();
  const [pill = "", ...rest] = className.split(" ");
  const look = glass === "off" ? undefined : GLISSE[pill];
  if (look) {
    return (
      <Button type="submit" variant={look.variant} tint={look.tint} className={["glass-button", ...rest].join(" ")} disabled={pending} aria-disabled={pending} aria-label={pending ? undefined : label}>
        {pending ? pendingLabel : children}
      </Button>
    );
  }
  return (
    <button className={className} disabled={pending} aria-disabled={pending} aria-label={pending ? undefined : label}>
      {pending ? pendingLabel : children}
    </button>
  );
}
