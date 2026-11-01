"use client";

import { useEffect } from "react";

/**
 * Finishes a landing on a #fragment (Home's "Add an expiry date" → /app/documents/<id>#expires_on, the account
 * banner's /app/settings#delete) on pages behind a loading.tsx. Two things lose it otherwise: on a click, Next
 * (16.4) looks for the target while the loading skeleton is showing, finds nothing and drops the intent; on a
 * full load, any scroll before the load completes (the nav strip bringing its active tab into view) cancels
 * the browser's own landing. Mounts with the page's content, so the target exists by then.
 */
export function HashLanding() {
  useEffect(() => {
    let id = "";
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return; // "#%" and the like: nothing to land on.
    }
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    target.scrollIntoView();
    // A field as the target (#expires_on, #version-file) takes focus too, as a browser does after a fragment link.
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) target.focus({ preventScroll: true });
  }, []);
  return null;
}
