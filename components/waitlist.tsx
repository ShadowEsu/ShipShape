"use client";

import { useEffect, useRef, useState } from "react";

// No "we'll email you" while ShipShape can't send email (finish list A11; Privacy says it doesn't email the list yet).
const COPY = {
  accounts: { button: "Join the waitlist", busy: "Joining…", done: "You're on the list." },
  collect: { button: "Tell me when it's for sale", busy: "Saving…", done: "Noted: you'd like to hear if Collect goes on sale." },
} as const;

/**
 * Waitlist sign-up; `interest` records that the person wants to hear about one unsold feature. `label` is shown above
 * the field (a placeholder alone disappears while typing). The status region is always mounted, so screen readers
 * announce the confirmation, and focus moves to it because the button that had focus goes away.
 */
export function WaitlistForm({ interest, label }: { interest?: "collect"; label: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const copy = COPY[interest ?? "accounts"];
  const inputId = interest ? `waitlist-email-${interest}` : "waitlist-email";

  useEffect(() => {
    if (state === "done") doneRef.current?.focus();
  }, [state]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError("");
    let message: string;
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, interest }) });
      if (res.ok) return setState("done");
      const data: unknown = await res.json().catch(() => null);
      message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "We couldn't add you just now. Try again in a minute.";
    } catch {
      message = "Couldn't reach ShipShape. Check your connection and try again.";
    }
    setError(message);
    setState("idle");
    inputRef.current?.focus();
  }

  return (
    <div className="w-full max-w-md">
      <div role="status">
        {state === "done" && (
          <p ref={doneRef} tabIndex={-1} className="rounded-full bg-ok-soft px-4 py-2 text-sm font-medium text-ok">
            {copy.done}
          </p>
        )}
      </div>
      {state !== "done" && (
        <form onSubmit={submit} className="space-y-2" noValidate>
          <label htmlFor={inputId} className={interest ? "block text-sm text-ink-2" : "block text-sm font-medium"}>
            {label}
          </label>
          {/* The interest form sits in a narrow card, so it stays stacked. */}
          <div className={`flex flex-col gap-2 ${interest ? "" : "sm:flex-row"}`}>
            <input
              ref={inputRef}
              id={inputId}
              type="email"
              required
              autoComplete="email"
              placeholder="you@business.com"
              className="input min-w-0 flex-1 rounded-full px-4"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
            />
            <button className="btn" disabled={state === "busy"}>
              {state === "busy" ? copy.busy : copy.button}
            </button>
          </div>
          {error && (
            <p id={`${inputId}-error`} role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
