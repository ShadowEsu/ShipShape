"use client";

import { useEffect } from "react";

/** One slow pulse: scale 1 → 1.04 → 1 over 1.2s on the state-change curve (Design spec 2026-11-02 §6.3). */
const PULSE: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }];
const PULSE_TIMING: KeyframeAnimationOptions = { id: "v2-pulse", duration: 1200, easing: "cubic-bezier(0.4, 0, 0.2, 1)" };

/**
 * "Expires soon" (`[data-pulse]`, components/app-ui.tsx) pulses once, the first time its chip is fully on screen; a chip
 * that arrives later (a page change, a saved new date) is watched too. Never a loop; nothing under reduced motion.
 *
 * The pulse runs through the Web Animations API and the chips already pulsed are kept here, not marked in the DOM:
 * the shell's effect runs before a streamed page has hydrated, and an attribute added to a chip React hasn't reached
 * yet is a hydration mismatch.
 */
export function PulseOnView() {
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pulsed = new WeakSet<Element>();
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || pulsed.has(e.target)) continue;
          pulsed.add(e.target);
          seen.unobserve(e.target);
          if (!still.matches) e.target.animate(PULSE, PULSE_TIMING);
        }
      },
      { threshold: 1 },
    );
    // observe() ignores an element it already watches, so watching again after every change is cheap.
    const watch = () =>
      document.querySelectorAll("[data-pulse]").forEach((el) => {
        if (!pulsed.has(el)) seen.observe(el);
      });
    watch();
    const arrivals = new MutationObserver(watch);
    arrivals.observe(document.body, { childList: true, subtree: true });
    return () => {
      arrivals.disconnect();
      seen.disconnect();
    };
  }, []);
  return null;
}
