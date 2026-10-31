"use client";

import { useActionState, useEffect, useState } from "react";
import { CopyLink } from "@/components/copy-link";
import { addVendorAction, deleteVendorFileAction, makeVendorLink, type CollectFormState } from "./actions";

function FormError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
      {error}
    </p>
  );
}

export function NewVendorForm({ kinds }: { kinds: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState<CollectFormState, FormData>(addVendorAction, {});
  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="vendor-name" className="label">
          Vendor or subcontractor
        </label>
        <input id="vendor-name" name="name" required maxLength={120} placeholder="e.g. Rivera Electric" className="input" />
      </div>
      <div>
        <label htmlFor="vendor-email" className="label">
          Email <span className="font-normal text-ink-3">(optional, only for you; ShipShape doesn&apos;t email vendors)</span>
        </label>
        <input id="vendor-email" name="email" type="email" maxLength={254} autoComplete="off" className="input" />
      </div>
      <fieldset>
        <legend className="label">Documents to ask for</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {kinds.map((k) => (
            <label key={k.key} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
              <input type="checkbox" name="kind" value={k.key} defaultChecked={k.key === "w9" || k.key === "coi"} className="size-4 accent-[var(--accent)]" />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>
      <FormError error={state.error} />
      <button className="btn" disabled={pending}>
        {pending ? "Adding…" : "Add vendor"}
      </button>
    </form>
  );
}

export function VendorLinkForm({ vendorId, vendorName, days }: { vendorId: string; vendorName: string; days: readonly number[] }) {
  const [state, action, pending] = useActionState<CollectFormState, FormData>(makeVendorLink, {});
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (state.link) setUrl(`${window.location.origin}/c/${state.link.id}#${state.link.token}`);
  }, [state.link]);

  if (url) {
    return (
      <div className="space-y-3">
        <h2 className="font-semibold">Upload link ready</h2>
        <p className="text-sm text-ink-2">
          Copy it now and send it to {vendorName} yourself: ShipShape keeps only a fingerprint of it and can&apos;t show it again.
          Anyone with the link can send files to this workspace until it expires or you turn it off.
        </p>
        <CopyLink id="collect-url" label="Upload link" url={url} />
        <button type="button" className="text-sm text-ink-2 underline" onClick={() => window.location.reload()}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="vendor" value={vendorId} />
      <fieldset>
        <legend className="label">The link stops working after</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {days.map((d, i) => (
            <label key={d} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-ink">
              <input type="radio" name="days" value={d} defaultChecked={i === 1} className="accent-[var(--accent)]" />
              {d} days
            </label>
          ))}
        </div>
      </fieldset>
      <FormError error={state.error} />
      <button className="btn" disabled={pending}>
        {pending ? "Making the link…" : "Make an upload link"}
      </button>
    </form>
  );
}

/** Delete asks once more in place: the file and its stored copy go for good. */
export function DeleteVendorFileForm({ fileId, filename }: { fileId: string; filename: string }) {
  const [state, action, pending] = useActionState<CollectFormState, FormData>(deleteVendorFileAction, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setConfirming(true)} aria-label={`Delete ${filename}`}>
        Delete
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={fileId} />
      <span className="text-sm text-ink-2">Delete this file for good?</span>
      <button className="btn-danger" disabled={pending}>
        {pending ? "Deleting…" : "Delete file"}
      </button>
      <button type="button" className="btn-ghost" onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </button>
      <FormError error={state.error} />
    </form>
  );
}
