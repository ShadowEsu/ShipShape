"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signProblem, type SignField } from "./messages";

const FIELD_ID: Record<SignField, string> = { consent: "sign-consent", name: "typed-name", code: "code" };

/** The button that signs names what is signed ("Sign the Mutual NDA"); while signing it says so and can't be pressed. */
export function SignButton({ title, busy, signing }: { title: string; busy: boolean; signing: boolean }) {
  return (
    <button className="btn" disabled={busy}>
      {signing ? "Signing…" : `Sign the ${title}`}
    </button>
  );
}

export function SignForm({
  id,
  title,
  sender,
  signerName,
  email,
  consent,
  demo,
}: {
  id: string;
  title: string;
  sender: string;
  signerName: string;
  email: string;
  /** The summary sits beside the box; the full consent opens under it; the version shows beside the box. */
  consent: { summary: string; full: { heading: string; text: string }[]; version: string };
  demo: boolean;
}) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState<"code" | "sign" | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<{ field: SignField | null; message: string } | null>(null);
  // These buttons work only with JavaScript; until the page has hydrated, a click would do nothing.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // The field a message is about takes focus, so the fix starts where the message is.
  useEffect(() => {
    if (error?.field) document.getElementById(FIELD_ID[error.field])?.focus();
  }, [error]);

  async function post(path: "code" | "sign", body?: object) {
    setBusy(path);
    setError(null);
    setSent(null);
    try {
      const r = await fetch(`/s/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 429) {
        setError({ field: null, message: "Too many tries from this network. Wait 10 minutes, then try again." });
        return null;
      }
      const data: { result?: string } = await r.json();
      return data.result ?? "invalid";
    } catch {
      setError({ field: null, message: "Couldn't reach ShipShape. Check your connection and try again." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    const result = await post("code");
    if (result === "ok") {
      setCodeSent(true);
      setCode("");
      setSent(demo ? "We sent a 6-digit code. In this sample workspace it's under Deadlines → Reminders sent. It works for 10 minutes." : `We sent a 6-digit code to ${email}. It works for 10 minutes.`);
    } else if (result) setError(signProblem(result, sender));
  }

  const fieldError = (field: SignField) => (error?.field === field ? error.message : null);
  const described = (field: SignField) => (error?.field === field ? { "aria-invalid": true, "aria-describedby": `${FIELD_ID[field]}-error` } : {});

  return (
    <fieldset disabled={!ready} className="m-0 min-w-0 space-y-5 border-0 p-0">
      <div>
        <label className="flex items-start gap-3 text-sm">
          <input
            id={FIELD_ID.consent}
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            {...described("consent")}
          />
          <span>
            {consent.summary} <span className="whitespace-nowrap text-ink-3">Version {consent.version}</span>
          </span>
        </label>
        <details className="mt-2 pl-7 text-sm">
          <summary className="cursor-pointer text-ink-2">Read the full consent</summary>
          <ul className="mt-2 space-y-2 text-ink-2">
            {consent.full.map((p) => (
              <li key={p.heading}>
                <span className="font-medium text-ink">{p.heading}</span> {p.text}
              </li>
            ))}
          </ul>
        </details>
        {fieldError("consent") && (
          <p id={`${FIELD_ID.consent}-error`} className="mt-1 text-sm text-bad">
            {fieldError("consent")}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={FIELD_ID.name} className="label">
          Type your full name to sign
        </label>
        <input
          id={FIELD_ID.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoComplete="name"
          placeholder={signerName}
          className="input font-serif text-xl italic"
          {...described("name")}
        />
        {fieldError("name") && (
          <p id={`${FIELD_ID.name}-error`} className="mt-1 text-sm text-bad">
            {fieldError("name")}
          </p>
        )}
      </div>

      {!codeSent ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">
            To confirm it&apos;s you, ShipShape sends a 6-digit code to {email}.
            {demo && " In this sample workspace the code appears under Deadlines → Reminders sent instead of in an inbox."}
          </p>
          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={sendCode}>
            {busy === "code" ? "Sending…" : "Send me a code"}
          </button>
        </div>
      ) : (
        <form
          className="space-y-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await post("sign", { code, typedName: name, consented });
            if (result === "ok") router.refresh();
            else if (result) setError(signProblem(result, sender));
          }}
        >
          {sent && (
            <p role="status" className="text-sm text-ink-2">
              {sent}
            </p>
          )}
          <label htmlFor={FIELD_ID.code} className="label">
            6-digit code
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={FIELD_ID.code}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input font-mono tracking-widest sm:w-40"
              {...described("code")}
            />
            <SignButton title={title} busy={busy !== null} signing={busy === "sign"} />
          </div>
          {fieldError("code") && (
            <p id={`${FIELD_ID.code}-error`} className="text-sm text-bad">
              {fieldError("code")}
            </p>
          )}
          <button type="button" className="text-sm text-ink-2 underline" disabled={busy !== null} onClick={sendCode}>
            {busy === "code" ? "Sending…" : "Send a new code"}
          </button>
        </form>
      )}
      {error && !error.field && (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error.message}
        </p>
      )}
    </fieldset>
  );
}
