"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { signProblem, type SignField } from "./messages";

const FIELD_ID: Record<SignField, string> = { consent: "sign-consent", name: "typed-name", code: "code" };

/** A message for the signer: about one field, or (`field: null`) about the whole form. */
type SignError = { field: SignField | null; message: string };

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
  consentText,
  demo,
}: {
  id: string;
  title: string;
  sender: string;
  signerName: string;
  email: string;
  consentText: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState<"code" | "sign" | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<SignError | null>(null);
  // These buttons work only with JavaScript; until the page has hydrated, a click would do nothing.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // The field a message is about takes focus, so the fix starts where the message is.
  useEffect(() => {
    if (error?.field) document.getElementById(FIELD_ID[error.field])?.focus();
  }, [error]);
  // Once a code is on its way, the field it goes in takes focus: the button just pressed may be gone.
  useEffect(() => {
    if (sent) document.getElementById(FIELD_ID.code)?.focus();
  }, [sent]);

  /** One of the route's answers; `chars` comes only with `name_chars` (what the certificate can't print). */
  async function post(path: "code" | "sign", body?: object): Promise<{ result: string; chars: string[] } | null> {
    setBusy(path);
    setError(null);
    setSent(null);
    try {
      const r = await fetch(`/s/${id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (r.status === 429) {
        setError({ field: null, message: "Too many tries from this network. Wait 10 minutes, then try again." });
        return null;
      }
      const data: { result?: string; chars?: string[] } = await r.json();
      return { result: data.result ?? "invalid", chars: Array.isArray(data.chars) ? data.chars.filter((c) => typeof c === "string").slice(0, 5) : [] };
    } catch {
      setError({ field: null, message: "Couldn't reach ShipShape. Check your connection and try again." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function sendCode() {
    const answer = await post("code");
    if (answer?.result === "ok") {
      setCodeSent(true);
      setCode("");
      setSent(demo ? "We sent a 6-digit code. In this sample workspace it's under Deadlines → Reminders sent. It works for 10 minutes." : `We sent a 6-digit code to ${email}. It works for 10 minutes.`);
    } else if (answer) setError(signProblem(answer.result, sender, answer.chars));
  }

  async function sign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const answer = await post("sign", { code, typedName: name, consented });
    if (answer?.result === "ok") router.refresh();
    // The name stays as typed, so the person can see which character the message names and change only that.
    else if (answer) setError(signProblem(answer.result, sender, answer.chars));
  }

  return (
    <SignFormView
      title={title}
      signerName={signerName}
      email={email}
      consentText={consentText}
      demo={demo}
      ready={ready}
      consented={consented}
      name={name}
      code={code}
      codeSent={codeSent}
      busy={busy}
      sent={sent}
      error={error}
      onConsent={setConsented}
      onName={setName}
      onCode={setCode}
      onSendCode={sendCode}
      onSign={sign}
    />
  );
}

/** The form drawn from SignForm's state; it holds none itself, so any state of it can be rendered. */
export function SignFormView({
  title,
  signerName,
  email,
  consentText,
  demo,
  ready,
  consented,
  name,
  code,
  codeSent,
  busy,
  sent,
  error,
  onConsent,
  onName,
  onCode,
  onSendCode,
  onSign,
}: {
  title: string;
  signerName: string;
  email: string;
  consentText: string;
  demo: boolean;
  ready: boolean;
  consented: boolean;
  name: string;
  code: string;
  codeSent: boolean;
  busy: "code" | "sign" | null;
  sent: string | null;
  error: SignError | null;
  onConsent: (checked: boolean) => void;
  onName: (name: string) => void;
  onCode: (code: string) => void;
  onSendCode: () => void;
  onSign: (e: FormEvent<HTMLFormElement>) => void;
}) {
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
            onChange={(e) => onConsent(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            {...described("consent")}
          />
          <span>{consentText}</span>
        </label>
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
          onChange={(e) => onName(e.target.value)}
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

      {/* Always here, empty until a code is sent: a screen reader reads out a live region's new text, not one mounted with it. */}
      <p role="status" className={sent ? "text-sm text-ink-2" : "sr-only"}>
        {sent}
      </p>
      {!codeSent ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">
            To confirm it&apos;s you, ShipShape sends a 6-digit code to {email}.
            {demo && " In this sample workspace the code appears under Deadlines → Reminders sent instead of in an inbox."}
          </p>
          <button type="button" className="btn-ghost" disabled={busy !== null} onClick={onSendCode}>
            {busy === "code" ? "Sending…" : "Send me a code"}
          </button>
        </div>
      ) : (
        <form className="space-y-2" noValidate onSubmit={onSign}>
          <label htmlFor={FIELD_ID.code} className="label">
            6-digit code
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={FIELD_ID.code}
              value={code}
              onChange={(e) => onCode(e.target.value)}
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
          <button type="button" className="text-sm text-ink-2 underline" disabled={busy !== null} onClick={onSendCode}>
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
