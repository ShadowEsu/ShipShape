"use client";

import { useState } from "react";

const COPY = {
  accounts: { button: "Join the waitlist", busy: "Joining…", done: "You're on the list. We'll email you once when accounts open." },
  collect: { button: "Tell me when it's for sale", busy: "Saving…", done: "Noted. We'll email you once if Collect goes on sale." },
} as const;

/** Waitlist sign-up; `interest` records that the person wants to hear about one unsold feature. */
export function WaitlistForm({ interest }: { interest?: "collect" }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const copy = COPY[interest ?? "accounts"];
  const inputId = interest ? `waitlist-email-${interest}` : "waitlist-email";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError("");
    const res = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, interest }) });
    if (res.ok) return setState("done");
    const data: unknown = await res.json().catch(() => null);
    setError(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Something went wrong. Try again.");
    setState("idle");
  }

  if (state === "done") {
    return (
      <p role="status" className="rounded-full bg-ok-soft px-4 py-2 text-sm font-medium text-ok">
        {copy.done}
      </p>
    );
  }
  // The interest form sits in a narrow card, so it stays stacked.
  return (
    <form onSubmit={submit} className={`flex w-full max-w-md flex-col gap-2 ${interest ? "" : "sm:flex-row"}`} noValidate>
      <label htmlFor={inputId} className="sr-only">
        Email
      </label>
      <input
        id={inputId}
        type="email"
        required
        autoComplete="email"
        placeholder="you@business.com"
        className="input flex-1 rounded-full px-4"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn" disabled={state === "busy"}>
        {state === "busy" ? copy.busy : copy.button}
      </button>
      {error && (
        <p role="alert" className="text-sm text-bad sm:basis-full">
          {error}
        </p>
      )}
    </form>
  );
}
