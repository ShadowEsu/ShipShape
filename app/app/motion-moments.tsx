"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The motion moments that need a script (Design's shared spec, 4 Nov, §2-§3): count-ups, staggered arrival and
 * celebrations; the shimmer and the branded loader are CSS only (app/motion.css). Every one renders its final state in
 * the server HTML and does nothing under reduced motion; a count-up or a celebration ends at once on a click, key,
 * wheel or touch (spec §3.3). None waits for anything: a list's rows are already in the page when they rise (Quiet §5:
 * the 8th starts 210ms after the 1st, and all are in place by 450ms).
 */

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// False while hydrating the server HTML, true for anything that mounts later (a page reached by a link). After
// hydration React re-renders with true, so a component keeps what it was at its first render.
const noSubscribe = () => () => {};
const useMountedLate = () => {
  const late = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  return useState(late)[0];
};
const SKIP = ["pointerdown", "keydown", "wheel", "touchstart"];

/** The spec's arrival curve, cubic-bezier(0.22, 1, 0.36, 1), as y for progress x (solved for t by Newton's method). */
export function easeSmooth(x: number): number {
  const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1];
  const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const slope = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t ** 2;
    if (Math.abs(slope) < 1e-6) break;
    t -= (at(t, x1, x2) - x) / slope;
    t = Math.min(1, Math.max(0, t));
  }
  return at(t, y1, y2);
}

/** How long a count to `n` runs: 700ms under 100, 1000ms under 10,000, else 1200ms. */
export const countDuration = (n: number) => (Math.abs(n) < 100 ? 700 : Math.abs(n) < 10_000 ? 1000 : 1200);

/**
 * A number that counts up from 0 once per page view (spec §2): when it first comes on screen below the fold, or at
 * once when its page was reached by a link. A number on screen in the first paint stays still (spec §3.4). While it
 * counts, screen readers get the final number and the moving digits are hidden from them.
 */
export function CountUp({ value }: { value: number }) {
  const late = useMountedLate();
  const [running, setRunning] = useState(false);
  const counted = useRef(false);
  const box = useRef<HTMLSpanElement>(null);
  const digits = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || counted.current || value === 0 || still()) return;
    const start = () => {
      counted.current = true;
      setRunning(true);
    };
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight) {
      if (late) start();
      else counted.current = true;
      return;
    }
    const seen = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      seen.disconnect();
      start();
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [value, late]);

  useLayoutEffect(() => {
    const el = digits.current;
    if (!running || !el) return;
    el.textContent = "0";
    const duration = countDuration(value);
    let start = 0;
    let frame = requestAnimationFrame(function step(now) {
      start ||= now;
      const p = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(value * easeSmooth(p)));
      if (p < 1) frame = requestAnimationFrame(step);
      else finish();
    });
    function finish() {
      cancelAnimationFrame(frame);
      for (const type of SKIP) window.removeEventListener(type, finish, true);
      setRunning(false);
    }
    for (const type of SKIP) window.addEventListener(type, finish, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      for (const type of SKIP) window.removeEventListener(type, finish, true);
    };
  }, [running, value]);

  return (
    <span ref={box} className="count-up">
      {running ? (
        <>
          <span className="sr-only">{value}</span>
          <span ref={digits} aria-hidden="true">
            {value}
          </span>
        </>
      ) : (
        value
      )}
    </span>
  );
}

// The lists that have arrived in this visit: each arrives once, not again on a re-sort, a filter or a return.
const arrived = new Set<string>();
// The longest arrival: the 8th row starts after 7 staggers of 30ms and runs 240ms (app/motion.css, Quiet §5).
const ARRIVAL_MS = 7 * 30 + 240;

/**
 * A list whose first 8 rows rise into place the first time it loads in a visit (Quiet §5, staggered arrival; each
 * row's delay comes from its place, app/motion.css). The class comes off once they're in place, so rows added, sorted
 * or filtered later just appear.
 */
export function Arrive({ list, className, children }: { list: string; className: string; children: React.ReactNode }) {
  const [on, setOn] = useState(() => !arrived.has(list));
  useEffect(() => {
    arrived.add(list);
    if (!on) return;
    const t = setTimeout(() => setOn(false), ARRIVAL_MS);
    return () => clearTimeout(t);
  }, [list, on]);
  return <ul className={on ? `${className} m-arrive` : className}>{children}</ul>;
}

/** The celebration setting (Settings, on by default), kept in this browser. */
export const CELEBRATE_KEY = "ss-celebrate";
export type CelebrationTrigger = "check-all" | "all-current" | "start-done";
const subscribeStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
// Where this browser's storage is off or refused (Firefox's dom.storage.enabled, some policies), celebrations stay on
// and nothing is remembered, rather than the page failing.
function readKey(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function writeKey(key: string, value: string) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Storage off or full: nothing kept.
  }
}

/** Whether celebrations are on here: a switch for Settings that reads and writes this browser's setting. */
export function CelebrationSwitch() {
  const on = useSyncExternalStore(
    subscribeStorage,
    () => readKey(CELEBRATE_KEY) !== "off",
    () => true,
  );
  const [, rerender] = useState(0);
  return (
    <label className="group-row cursor-pointer items-center gap-3 hover:bg-tile">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">Celebrate wins</span>
        <span className="block text-[13px] text-ink-3">A short burst for a real win, like a request where you have everything. In this browser.</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => {
          writeKey(CELEBRATE_KEY, e.target.checked ? "on" : "off");
          rerender((n) => n + 1);
        }}
        className="size-5 shrink-0 accent-[var(--accent)]"
      />
    </label>
  );
}

// The burst (spec §2): 8 shapes, 10px and 8px in turn, in the full-strength state colours (the "You have it" green,
// the "Expires soon" amber, ink), fanned over the right half of the check from -70° to 70°, 30-48px out, so most fly
// above and below the words rather than across them. A row needs about 12px above and below its line for the fan.
const REACH = [40, 30, 48, 34, 34, 48, 30, 40];
const BURST = REACH.map((reach, i) => ({
  angle: -70 + 20 * i,
  reach,
  look: `${i % 2 === 0 ? "size-2.5 rounded-full" : "size-2 rounded-[2px]"} ${["bg-ok", "bg-warn", "bg-ink"][i % 3]}`,
}));

/**
 * Resolves once nothing holding `el` is moving: a route's view transition, a list's arrival. Endless animations (a
 * loader's rock) don't count. So a burst starts with its row at rest (spec §2).
 */
function settled(el: Element): Promise<unknown> {
  const moving = document.getAnimations().filter((a) => {
    const fx = a.effect;
    return fx instanceof KeyframeEffect && fx.target?.contains(el) && fx.getComputedTiming().iterations !== Infinity;
  });
  return Promise.all(moving.map((a) => a.finished.catch(() => undefined)));
}

/**
 * A real win's row, once a day per trigger (spec §2, celebration): `mark` (the check) then the words. Once the row is
 * at rest, the check pops and the shapes burst from it and fade in 900ms, clipped to the row. Off in Settings, under
 * reduced motion, or when already seen today (the person's own calendar day, as everywhere in the app), the check is
 * just there.
 */
export function Celebrate({
  trigger,
  mark,
  className,
  role,
  children,
}: {
  trigger: CelebrationTrigger;
  mark: React.ReactNode;
  className: string;
  role?: "status";
  children: React.ReactNode;
}) {
  const [burst, setBurst] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    const today = new Date().toLocaleDateString("en-CA");
    const key = `ss-celebrated-${trigger}`;
    if (!el || still() || readKey(CELEBRATE_KEY) === "off" || readKey(key) === today) return;
    // Seen once it has played or been skipped, so a page left mid-burst plays it next time. Whichever ends it first,
    // the timer or a skip (before or during the burst), takes the other away.
    let over = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      over = true;
      clearTimeout(t);
      for (const type of SKIP) window.removeEventListener(type, end, true);
    };
    const end = () => {
      stop();
      writeKey(key, today);
      setBurst(false);
    };
    for (const type of SKIP) window.addEventListener(type, end, { capture: true, passive: true });
    settled(el).then(() => {
      if (over) return;
      setBurst(true);
      t = setTimeout(end, 900);
    });
    return stop;
  }, [trigger]);
  return (
    <p role={role} className={`isolate overflow-clip ${className}`}>
      <span ref={box} className="relative inline-grid shrink-0 place-items-center">
        <span className={burst ? "celebrate-check" : undefined}>{mark}</span>
        {burst && (
          <span aria-hidden="true" className="celebrate-burst pointer-events-none absolute inset-0 -z-10 grid place-items-center">
            {BURST.map((s, i) => (
              <span key={i} className={`absolute ${s.look}`} style={{ "--a": `${s.angle}deg`, "--d": `${s.reach}px` }} />
            ))}
          </span>
        )}
      </span>
      {children}
    </p>
  );
}
