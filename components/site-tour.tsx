"use client";

import { useEffect, useRef, useState } from "react";

export type TourScene = {
  title: string;
  body: string;
  /** The app page the scene shows, written in the window's bar. */
  page: string;
  alt: string;
  /** The whole app window at 1440 (2x), and the one pane that matters on a phone (2x, shown about 1:1). */
  desk: { src: string; width: number; height: number };
  phone: { src: string; width: number; height: number };
};

/**
 * The home page's tour (site direction A, row 520): three scenes of the sample app, one after another. The server HTML
 * stacks them, each with its step as a label: that is what reduced motion and a page without JavaScript keep. With
 * motion allowed, the section pins a stage for three screens of scroll (300svh; the stage is 100svh, so iOS Safari's
 * collapsing address bar never moves it) and the scenes cross-fade as it passes; the step pills follow.
 */
export function SiteTour({ scenes }: { scenes: TourScene[] }) {
  const section = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [on, setOn] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPinned(!reduce.matches);
    sync();
    reduce.addEventListener("change", sync);
    return () => reduce.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = section.current;
      const held = stage.current;
      if (!box || !held) return;
      // How far the section has moved past the top, over the distance the stage stays pinned.
      const span = box.offsetHeight - held.offsetHeight;
      const passed = span > 0 ? Math.min(0.999, Math.max(0, -box.getBoundingClientRect().top / span)) : 0;
      setOn(Math.floor(passed * scenes.length));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [pinned, scenes.length]);

  return (
    <div ref={section} className="sq-tour" data-pinned={pinned ? "" : undefined}>
      <div ref={stage} className="sq-tour-stage">
        <div className="sq-tour-scenes">
          {scenes.map((scene, i) => (
            <figure key={scene.title} className="sq-tour-scene" data-on={i === on ? "" : undefined}>
              <figcaption className="sq-tour-caption">
                <span className="sq-tour-n">{i + 1}</span>
                <span>
                  <span className="sq-tour-title">{scene.title}</span> <span className="sq-tour-body">{scene.body}</span>
                </span>
              </figcaption>
              <div className="sq-win">
                <div className="sq-win-bar" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <span>{scene.page}</span>
                </div>
                <picture>
                  <source media="(max-width: 899px)" srcSet={scene.phone.src} width={scene.phone.width} height={scene.phone.height} />
                  <img
                    className="sq-win-shot"
                    src={scene.desk.src}
                    width={scene.desk.width}
                    height={scene.desk.height}
                    loading="lazy"
                    decoding="async"
                    alt={scene.alt}
                  />
                </picture>
              </div>
            </figure>
          ))}
        </div>
        {/* While pinned, the captions give way to these pills and the step's line; screen readers keep the captions. */}
        <div className="sq-tour-steps" aria-hidden="true">
          <ol>
            {scenes.map((scene, i) => (
              <li key={scene.title} data-on={i === on ? "" : undefined}>
                <b>{i + 1}</b>
                {scene.title}
              </li>
            ))}
          </ol>
          <p className="sq-tour-line">{scenes[on]?.body}</p>
        </div>
      </div>
    </div>
  );
}
