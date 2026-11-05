import { describe, expect, it } from "vitest";
import { INTRO_KEY, INTRO_MS, introScript, playIntro } from "@/lib/site-intro";

/** The site's intro (Quiet SPEC §5): once per browser session, never with reduced motion. */

const session = () => {
  const kept = new Map<string, string>();
  return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
};

describe("whether the intro plays", () => {
  it("plays on a session's first visit only", () => {
    const storage = session();
    expect(playIntro(storage, false, INTRO_KEY)).toBe(true);
    expect(playIntro(storage, false, INTRO_KEY)).toBe(false);
    expect(playIntro(session(), false, INTRO_KEY)).toBe(true);
  });

  it("never plays with reduced motion, and doesn't use up the session's one play", () => {
    const storage = session();
    expect(playIntro(storage, true, INTRO_KEY)).toBe(false);
    expect(storage.getItem(INTRO_KEY)).toBeNull();
  });

  it("never plays where session storage is off or refuses, since it couldn't stop at once", () => {
    expect(playIntro(null, false, INTRO_KEY)).toBe(false);
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(playIntro(refusing, false, INTRO_KEY)).toBe(false);
  });
});

describe("the inline script", () => {
  // The script as the page carries it, run against a stand-in browser: the decision survives being written out as text.
  function load(reducedMotion: boolean, storage = session()) {
    const classes = new Set<string>();
    const listeners = new Map<string, () => void>();
    const timers: { fn: () => void; ms: number }[] = [];
    const overlay = { classList: { add: (c: string) => void classes.add(c), remove: (c: string) => void classes.delete(c) } };
    const window = {
      sessionStorage: storage,
      matchMedia: (q: string) => ({ matches: reducedMotion && q === "(prefers-reduced-motion: reduce)" }),
      addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
      removeEventListener: (type: string) => void listeners.delete(type),
    };
    const document = { getElementById: (id: string) => (id === "site-intro" ? overlay : null) };
    const setTimeout = (fn: () => void, ms: number) => timers.push({ fn, ms });
    new Function("window", "document", "setTimeout", "clearTimeout", introScript("site-intro"))(window, document, setTimeout, () => {});
    return { on: () => classes.has("is-on"), listeners, timers, storage };
  }

  it("turns the overlay on once a session, and off at 1000ms or at the first click, key, wheel, touch or scroll", () => {
    const first = load(false);
    expect(first.on()).toBe(true);
    expect([...first.listeners.keys()].sort()).toEqual(["keydown", "pointerdown", "scroll", "touchstart", "wheel"]);
    expect(first.timers.map((t) => t.ms)).toEqual([INTRO_MS]);
    first.listeners.get("scroll")?.();
    expect(first.on()).toBe(false);
    expect(first.listeners.size).toBe(0);

    const again = load(false, first.storage);
    expect(again.on()).toBe(false);
    expect(again.timers).toEqual([]);

    const timed = load(false);
    timed.timers[0]?.fn();
    expect(timed.on()).toBe(false);
  });

  it("leaves the overlay off with reduced motion", () => {
    const still = load(true);
    expect(still.on()).toBe(false);
    expect(still.listeners.size).toBe(0);
  });
});
