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
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
