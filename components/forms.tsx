"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CONSENT_TEXT } from "@/lib/consent";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function ScanForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [target, setTarget] = useState(initial);
  const { busy, error, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const scan = await post<{ id: string }>("/api/scans", { target });
          router.push(`/app/scans/${scan.id}`);
        });
      }}
    >
      <input className="input" placeholder="https://github.com/you/your-app  or  https://yourstore.com" value={target} onChange={(e) => setTarget(e.target.value)} required />
      <button className="btn" disabled={busy}>{busy ? "Scanning, this takes up to a minute..." : "Run scan"}</button>
      {error && <p className="text-sm text-blocker">{error}</p>}
    </form>
  );
}

export function GenerateDocsButton({ scanId }: { scanId: string }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <div>
      <button
        className="btn"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await post("/api/documents", { scanId });
            router.push("/app/vault");
          })
        }
      >
        {busy ? "Writing drafts..." : "Draft matching documents"}
      </button>
      {error && <p className="mt-2 text-sm text-blocker">{error}</p>}
    </div>
  );
}

export function RequestSignatureForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await post("/api/signatures", { documentId, name, email });
          router.push("/app/signatures");
        });
      }}
    >
      <input className="input" placeholder="Signer name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="input" type="email" placeholder="Signer email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button className="btn w-full" disabled={busy}>Request signature on this version</button>
      {error && <p className="text-sm text-blocker">{error}</p>}
    </form>
  );
}

export function SignForm({ id, expectedName }: { id: string; expectedName: string }) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [typed, setTyped] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await post(`/api/signatures/${id}/sign`, { typedName: typed, consent: agree });
          router.refresh();
        });
      }}
    >
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>{CONSENT_TEXT}</span>
      </label>
      <input className="input font-serif text-lg italic" placeholder={`Type your full name (${expectedName})`} value={typed} onChange={(e) => setTyped(e.target.value)} required />
      <button className="btn w-full" disabled={busy || !agree || typed.trim().length < 2}>Sign</button>
      {error && <p className="text-sm text-blocker">{error}</p>}
    </form>
  );
}

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  if (done) return <p className="font-semibold text-good">You're on the list. We'll email you when your spot opens.</p>;
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await post("/api/waitlist", { email });
          setDone(true);
        });
      }}
    >
      <input className="input sm:max-w-xs" type="email" placeholder="you@startup.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button className="btn" disabled={busy}>Join the waitlist</button>
      {error && <p className="text-sm text-blocker">{error}</p>}
    </form>
  );
}
