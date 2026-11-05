"use client";

import { useEffect } from "react";

/**
 * Site reveals (Quiet SPEC §5): each `[data-reveal]` section that starts below the fold fades in and rises 4px once,
 * when it enters the viewport (app/site-quiet.css holds the timing). The server HTML has every section in place; only
 * sections nobody can see yet are hidden, after the first paint, so nothing on screen ever disappears. Reduced motion,
 * or a browser without IntersectionObserver: nothing moves.
 */
export function SiteReveals() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const below = Array.from(document.querySelectorAll<HTMLElement>(".site-quiet [data-reveal]")).filter(
      (el) => el.getBoundingClientRect().top >= window.innerHeight,
    );
    if (below.length === 0) return;
    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("is-pending");
        seen.unobserve(entry.target);
      }
    });
    for (const el of below) {
      el.classList.add("is-pending");
      seen.observe(el);
    }
    return () => {
      seen.disconnect();
      for (const el of below) el.classList.remove("is-pending");
    };
  }, []);
  return null;
}
