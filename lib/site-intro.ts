/**
 * The site's intro (Quiet SPEC §5): a white screen with the mark, once per browser session, on the home page. It needs
 * no React: a nonce'd inline script right after the overlay (components/site-intro.tsx) decides before the page under it
 * paints, so a visitor who has seen it this session never gets a flash of it, and without the script nothing shows.
 */

/** This browser session's sessionStorage key, named on the Privacy page. */
export const INTRO_KEY = "ss-intro";
/** The overlay is gone by then: the mark arrives over 0-300ms, holds to 600ms, and the screen fades out by 1000ms. */
export const INTRO_MS = 1000;

/**
 * Whether the intro plays, and if so, marks it seen for the session. Never with reduced motion, never twice in a
 * session, and never where session storage is off or refuses (it would otherwise play on every visit).
 *
 * It is serialised into the inline script as it stands, so it uses nothing from outside its own parameters.
 */
export function playIntro(storage: Pick<Storage, "getItem" | "setItem"> | null, reducedMotion: boolean, key: string): boolean {
  if (reducedMotion || !storage) return false;
  try {
    if (storage.getItem(key) !== null) return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

/**
 * The inline script: when playIntro says so, it turns the overlay on, and ends it at INTRO_MS or at the first click, key,
 * wheel, touch or scroll. The CSS (app/site-quiet.css) holds the timing; the overlay is hidden by default.
 */
export function introScript(overlayId: string): string {
  return [
    "(function(play){",
    `var el=document.getElementById(${JSON.stringify(overlayId)});if(!el)return;`,
    "var s=null;try{s=window.sessionStorage}catch(e){}",
    `if(!play(s,window.matchMedia("(prefers-reduced-motion: reduce)").matches,${JSON.stringify(INTRO_KEY)}))return;`,
    'el.classList.add("is-on");',
    'var ev=["pointerdown","keydown","wheel","touchstart","scroll"],t;',
    'function end(){clearTimeout(t);el.classList.remove("is-on");ev.forEach(function(n){window.removeEventListener(n,end,true)})}',
    "ev.forEach(function(n){window.addEventListener(n,end,{capture:true,passive:true})});",
    `t=setTimeout(end,${INTRO_MS});`,
    `})(${playIntro.toString()})`,
  ].join("");
}
