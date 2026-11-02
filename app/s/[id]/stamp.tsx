"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * When SignForm last heard "ok" from Sign, just before the page refreshes into its signed state (this tab only). The
 * moment plays only if that was under 30 seconds ago, so a refresh that failed doesn't leave it set for a signed page
 * opened later in the same tab (Security INFO-ST2).
 */
let signedAt: number | null = null;
const FRESH_MS = 30_000;

export function markJustSigned() {
  signedAt = performance.now();
}

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const INOUT = "cubic-bezier(0.4, 0, 0.2, 1)";
const RISE: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];
const FADE: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/**
 * The signed state's frame and its moment (Design spec 2026-11-02 §6.4, values from Design's motion.py):
 * 1. the stamp drops (scale 1.6 → 0.94 at 55% → 1.03 at 78% → 1, turning −6° → 0° over its own −8° tilt, opaque by
 *    55%, a 2px press shadow at impact), 600ms;
 * 2. "Signed" and the document rise 6px from +420ms, 60ms apart;
 * 3. the signature rule and the time line under it rise 6px from +560ms, as the typed signature writes on from the
 *    left over 500ms;
 * 4. the "What happens next" label and card rise 6px from +900ms, and its rows fade in inside it, 40ms apart (the card
 *    carries their 6px). Until then neither an empty rule nor an empty card shows (Design, 02 Nov: they read as
 *    loading). The download and its line are there from the first frame.
 * Only right after signing in this tab: opened later or reloaded, the page is already in its final pose (the server
 * render and a fresh load both start with no mark, so the first paint never differs from the hydrated page). Right
 * after signing the page also goes back to its top, so the stamp lands on screen (the signer was down at the Sign
 * button), and "Signed" takes focus, as that button is gone. Under reduced motion, the final pose at once. Web
 * Animations, run before the first paint so nothing shows early; they write no attribute and leave each element as it
 * was when they end.
 */
export function StampMoment({ children }: { children: React.ReactNode }) {
  const [play] = useState(() => signedAt !== null && performance.now() - signedAt < FRESH_MS);
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    signedAt = null;
  }, []);
  useLayoutEffect(() => {
    const root = frame.current;
    if (!play || !root) return;
    window.scrollTo(0, 0);
    root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const run: Animation[] = [];
    const stamp = root.querySelector(".stamp");
    if (stamp)
      run.push(
        stamp.animate(
          [
            { transform: "scale(1.6) rotate(-6deg)", opacity: 0, filter: "drop-shadow(0 0 0 rgb(16 24 40 / 0))", offset: 0 },
            { filter: "drop-shadow(0 0 0 rgb(16 24 40 / 0))", offset: 0.53 },
            { transform: "scale(0.94) rotate(0deg)", opacity: 1, filter: "drop-shadow(0 2px 2px rgb(16 24 40 / 0.18))", offset: 0.55 },
            { filter: "drop-shadow(0 0 0 rgb(16 24 40 / 0))", offset: 0.58 },
            { transform: "scale(1.03) rotate(0deg)", opacity: 1, offset: 0.78 },
            { transform: "scale(1) rotate(0deg)", opacity: 1, filter: "drop-shadow(0 0 0 rgb(16 24 40 / 0))", offset: 1 },
          ],
          { id: "stamp-drop", duration: 600, easing: OUT, fill: "both" },
        ),
      );
    root.querySelectorAll(".stamp-rise").forEach((el, i) => run.push(el.animate(RISE, { id: "stamp-rise", duration: 240, delay: 420 + i * 60, easing: OUT, fill: "both" })));
    const sig = root.querySelector(".stamp-sig");
    if (sig)
      run.push(
        sig.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], { id: "stamp-sign", duration: 500, delay: 560, easing: INOUT, fill: "both" }),
      );
    root.querySelectorAll(".stamp-line").forEach((el) => run.push(el.animate(RISE, { id: "stamp-line", duration: 240, delay: 560, easing: OUT, fill: "both" })));
    const card = root.querySelector(".stamp-card");
    if (card) run.push(card.animate(RISE, { id: "stamp-card", duration: 240, delay: 900, easing: OUT, fill: "both" }));
    root.querySelectorAll(".stamp-next > *").forEach((el, i) => run.push(el.animate(FADE, { id: "stamp-next", duration: 240, delay: 900 + i * 40, easing: OUT, fill: "both" })));
    // The end state is the page as rendered, so the fills can go once each is done (nothing stays composited).
    for (const a of run) a.finished.then(() => a.cancel(), () => {});
    return () => run.forEach((a) => a.cancel());
  }, [play]);
  return (
    <section ref={frame} className="signed-v2">
      {children}
    </section>
  );
}
