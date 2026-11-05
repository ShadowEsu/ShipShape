"use client";

import { useEffect, useRef } from "react";

/**
 * Marks the element `target` (a selector) with `data-scrolled` while this point of the page is scrolled out of view:
 * put it right before a sticky bar, and the bar knows when content runs under it (Quiet §3: the app's top bar and the
 * site header turn to glass only then). One IntersectionObserver, no scroll listener; it takes no room (1px, pulled
 * back by -1px). Without IntersectionObserver the bar simply stays solid.
 */
export function ScrollFlag({ target }: { target: string }) {
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = document.querySelector(target);
    const at = mark.current;
    if (!bar || !at || !("IntersectionObserver" in window)) return;
    const seen = new IntersectionObserver((entries) => {
      const last = entries.at(-1);
      if (last) bar.toggleAttribute("data-scrolled", !last.isIntersecting);
    });
    seen.observe(at);
    return () => {
      seen.disconnect();
      bar.removeAttribute("data-scrolled");
    };
  }, [target]);
  return <div ref={mark} aria-hidden="true" className="scroll-flag" />;
}
