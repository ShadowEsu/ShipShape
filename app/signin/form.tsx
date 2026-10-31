"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

export function SignInForm({ allowEmail }: { allowEmail: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {allowEmail && (
        <div>
          <label htmlFor="email" className="label">
            Email <span className="font-normal text-ink-3">(local development only)</span>
          </label>
          <input id="email" name="email" type="email" autoComplete="email" className="input" placeholder="you@business.com" />
        </div>
      )}
      <label className="flex items-start gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          name="terms"
          required
          aria-required="true"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "signin-error" : undefined}
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
      {state.error && (
        <p id="signin-error" role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button type="submit" name="mode" value="demo" className="btn" disabled={pending}>
          {pending ? "Opening…" : "Try the sample workspace"}
        </button>
        {allowEmail && (
          <button type="submit" name="mode" value="email" className="btn-ghost" disabled={pending}>
            Sign in with email
          </button>
        )}
      </div>
    </form>
  );
}
