"use client";

import { useState } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError("");
    const res = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    if (res.ok) return setState("done");
    const data: unknown = await res.json().catch(() => null);
    setError(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Something went wrong. Try again.");
    setState("idle");
  }

  if (state === "done") {
    return (
      <p role="status" className="rounded-full bg-ok-soft px-4 py-2 text-sm font-medium text-ok">
        You&apos;re on the list. We&apos;ll email you once when accounts open.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row" noValidate>
      <label htmlFor="waitlist-email" className="sr-only">
        Email
      </label>
      <input
        id="waitlist-email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@business.com"
        className="input flex-1 rounded-full px-4"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn" disabled={state === "busy"}>
        {state === "busy" ? "Joining…" : "Join the waitlist"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-bad sm:basis-full">
          {error}
        </p>
      )}
    </form>
  );
}
