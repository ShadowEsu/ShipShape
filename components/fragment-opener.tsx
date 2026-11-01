"use client";

import { useEffect, useState } from "react";

/**
 * Secret links (/p/<id>#token, /s/<id>#token): takes the token from the URL fragment, which the
 * browser never sends to a server, hands it over once in a POST body, then loads the bare address,
 * whose page reads the token from an HttpOnly cookie. Both steps replace the history entry, so the
 * token leaves the address bar and the back button.
 */
export function FragmentOpener({ openUrl, unavailable, opening = "Opening the link…" }: { openUrl: string; unavailable: React.ReactNode; opening?: string }) {
  const [state, setState] = useState<"opening" | "missing" | "busy">("opening");

  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setState("missing");
      return;
    }
    const path = window.location.pathname;
    history.replaceState(null, "", path);
    // A full load rather than a router refresh: Next's router would put back the URL it first
    // loaded, token included.
    fetch(openUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then((r) => {
        if (r.status === 429) setState("busy");
        else window.location.replace(path);
      })
      .catch(() => setState("busy"));
  }, [openUrl]);

  if (state === "opening") {
    // The page's frame while the token is exchanged, so the page doesn't jump when it loads.
    return (
      <div aria-busy="true" className="space-y-6">
        <p role="status" className="text-ink-2">
          {opening}
        </p>
        <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
          <div className="h-9 w-64 max-w-full rounded-lg bg-line" />
          <div className="space-y-3">
            <div className="card h-14" />
            <div className="card h-14" />
            <div className="card h-14" />
          </div>
        </div>
      </div>
    );
  }
  // The open routes allow 30 tries per network in 10 minutes (lib/server/links.ts).
  if (state === "busy") return <p role="alert" className="text-ink-2">Too many tries from this network. Wait 10 minutes, then open the link again.</p>;
  return unavailable;
}

/**
 * For a secret link reopened while its cookie is still set: the page renders straight from the
 * cookie and FragmentOpener never mounts, so this takes the token out of the address bar and the
 * history entry, on load and when the link is pasted into the same tab (a fragment-only change
 * doesn't reload the page). Render it only where FragmentOpener isn't, or it could clear the token first.
 */
export function DropFragment() {
  useEffect(() => {
    const drop = () => {
      if (window.location.hash) history.replaceState(history.state, "", window.location.pathname + window.location.search);
    };
    drop();
    window.addEventListener("hashchange", drop);
    return () => window.removeEventListener("hashchange", drop);
  }, []);
  return null;
}
