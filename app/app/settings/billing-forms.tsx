"use client";

import Link from "next/link";
import { useActionState } from "react";
import { manageBilling, upgrade, type BillingState } from "./actions";

function ActionError({ state, id }: { state: BillingState; id: string }) {
  if (!state.error) return null;
  return (
    <p id={id} role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
      {state.error}
    </p>
  );
}

export function UpgradeForm({ price }: { price: number }) {
  const [state, action, pending] = useActionState<BillingState, FormData>(upgrade, {});
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="agree"
          aria-required="true"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "upgrade-error" : undefined}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="underline" target="_blank">
            Terms
          </Link>
          , including ${price} a month until I cancel, and the refund policy.
        </span>
      </label>
      <ActionError state={state} id="upgrade-error" />
      <button className="btn-accent" disabled={pending}>
        {pending ? "Opening checkout…" : `Move to Pro, $${price}/month`}
      </button>
    </form>
  );
}

export function ManageBillingForm() {
  const [state, action, pending] = useActionState<BillingState, FormData>(manageBilling, {});
  return (
    <form action={action} className="space-y-3">
      <ActionError state={state} id="billing-portal-error" />
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Opening…" : "Manage billing"}
      </button>
    </form>
  );
}
