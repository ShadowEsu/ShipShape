"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const MESSAGES: Record<string, string> = {
  bad_code: "That code doesn't match. Check the latest email and try again.",
  locked: "Too many wrong codes. Ask for a new code.",
  expired_code: "That code has expired. Ask for a new one.",
  needs_consent: "Tick the box to agree to sign electronically.",
  needs_name: "Type your name as your signature.",
  unsupported: "This file can't be signed here (it may be password-protected). Ask the sender for another copy.",
  too_large: "The signed copy would be over 10 MB, which ShipShape can't store. Ask the sender for a smaller copy.",
  too_many: "You've asked for the most codes this request allows. Ask the sender for a new signing link.",
  invalid: "This signing link isn't available any more.",
};

export function SignForm({ id, signerName, email, consentText, demo }: { id: string; signerName: string; email: string; consentText: string; demo: boolean }) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // These buttons work only with JavaScript; until the page has hydrated, a click would do nothing.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function post(path: string, body?: object) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/s/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 429) {
        setError("Too many tries from this network. Wait a few minutes.");
        return null;
      }
      const data: { result?: string } = await r.json();
      return data.result ?? "invalid";
    } catch {
      setError("Couldn't reach ShipShape. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset disabled={!ready} className="m-0 min-w-0 space-y-5 border-0 p-0">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
        <span>{consentText}</span>
      </label>
      <div>
        <label htmlFor="typed-name" className="label">
          Type your full name to sign
        </label>
        <input id="typed-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" placeholder={signerName} className="input font-serif text-xl italic" />
      </div>

      {!codeSent ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">
            To confirm it&apos;s you, ShipShape sends a 6-digit code to {email}.
            {demo && " In this sample workspace the code appears under Deadlines → Reminders sent instead of in an inbox."}
          </p>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={async () => {
              const result = await post("code");
              if (result === "ok") setCodeSent(true);
              else if (result) setError(MESSAGES[result] ?? MESSAGES.invalid);
            }}
          >
            {busy ? "Sending…" : "Send me a code"}
          </button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await post("sign", { code, typedName: name, consented });
            if (result === "ok") router.refresh();
            else if (result) setError(MESSAGES[result] ?? MESSAGES.invalid);
          }}
        >
          <label htmlFor="code" className="label">
            6-digit code
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input font-mono tracking-widest sm:w-40" />
            <button className="btn" disabled={busy}>
              {busy ? "Signing…" : "Sign"}
            </button>
          </div>
          <button
            type="button"
            className="text-sm text-ink-2 underline"
            disabled={busy}
            onClick={async () => {
              const result = await post("code");
              if (result && result !== "ok") setError(MESSAGES[result] ?? MESSAGES.invalid);
            }}
          >
            Send a new code
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}
