"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Secret links (/p/<id>#token, /s/<id>#token): takes the token from the URL fragment, which the
 * browser never sends to a server, hands it over once in a POST body, removes it from the address
 * bar, and reloads the page, which now reads it from an HttpOnly cookie.
 */
export function FragmentOpener({ openUrl, unavailable }: { openUrl: string; unavailable: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"opening" | "missing" | "busy">("opening");

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setState("missing");
      return;
    }
    history.replaceState(null, "", window.location.pathname);
    fetch(openUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then((r) => {
        if (r.status === 429) setState("busy");
        else router.refresh();
      })
      .catch(() => setState("busy"));
  }, [openUrl, router]);

  if (state === "opening") return <p className="text-ink-2">Opening…</p>;
  if (state === "busy") return <p className="text-ink-2">Too many tries from this network. Wait a few minutes and open the link again.</p>;
  return unavailable;
}
