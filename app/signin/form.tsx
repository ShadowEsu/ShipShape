"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type SignInState } from "./actions";

/** One way in; only the button that was pressed says it's working, and every button waits. */
function ModeButton({ mode, label, working, primary }: { mode: "account" | "demo" | "email"; label: string; working: string; primary: boolean }) {
  const { pending, data } = useFormStatus();
  return (
    <button type="submit" name="mode" value={mode} className={primary ? "btn" : "btn-ghost"} disabled={pending}>
      {pending && data?.get("mode") === mode ? working : label}
    </button>
  );
}

export function SignInForm({ allowEmail, accounts }: { allowEmail: boolean; accounts: boolean }) {
  const [state, action] = useActionState<SignInState, FormData>(signIn, {});
  const email = useRef<HTMLInputElement>(null);
  const terms = useRef<HTMLInputElement>(null);
  // The field an error is about takes focus, so the fix starts where the message is.
  useEffect(() => {
    if (state.field === "email") email.current?.focus();
    if (state.field === "terms") terms.current?.focus();
  }, [state]);
  const general = state.error && !state.field;
  return (
    <form action={action} className="space-y-4" noValidate>
      {allowEmail && (
        <div>
          <label htmlFor="email" className="label">
            Email <span className="font-normal text-ink-3">(local development only)</span>
          </label>
          <input
            ref={email}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="input"
            placeholder="you@business.com"
            defaultValue={state.email}
            aria-invalid={state.field === "email" ? true : undefined}
            aria-describedby={state.field === "email" ? "email-error" : undefined}
          />
          {state.field === "email" && (
            <p id="email-error" className="mt-1 text-sm text-bad">
              {state.error}
            </p>
          )}
        </div>
      )}
      <div>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input
            ref={terms}
            type="checkbox"
            name="terms"
            required
            aria-required="true"
            defaultChecked={state.terms}
            aria-invalid={state.field === "terms" ? true : undefined}
            aria-describedby={state.field === "terms" ? "terms-error" : undefined}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="underline" target="_blank">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline" target="_blank">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {state.field === "terms" && (
          <p id="terms-error" className="mt-1 text-sm text-bad">
            {state.error}
          </p>
        )}
      </div>
      {general && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {accounts && <ModeButton mode="account" label="Sign in or create an account" working="Opening…" primary />}
        <ModeButton mode="demo" label="Try the sample workspace" working="Opening…" primary={!accounts} />
        {allowEmail && <ModeButton mode="email" label="Sign in with email" working="Signing in…" primary={false} />}
      </div>
    </form>
  );
}
