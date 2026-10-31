"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Takes the token from the URL fragment (never sent to any server by the browser), hands it to the
 * server once in a POST body, removes it from the address bar, and reloads the page.
 */
export function PassportOpener({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"opening" | "missing" | "busy">("opening");

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setState("missing");
      return;
    }
    history.replaceState(null, "", window.location.pathname);
    fetch(`/p/${id}/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then((r) => {
        if (r.status === 429) setState("busy");
        else router.refresh();
      })
      .catch(() => setState("busy"));
  }, [id, router]);

  if (state === "opening") return <p className="text-ink-2">Opening the documents…</p>;
  if (state === "busy") return <p className="text-ink-2">Too many tries from this network. Wait a few minutes and open the link again.</p>;
  return <Unavailable />;
}

export function Unavailable() {
  return (
    <div className="space-y-2">
      <h1 className="font-serif text-3xl font-semibold">This link isn&apos;t available</h1>
      <p className="text-ink-2">
        It may have expired or been turned off, or the address was copied without its last part. Ask the person who sent it for a
        new link.
      </p>
    </div>
  );
}
