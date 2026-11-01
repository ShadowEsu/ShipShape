import { Notice } from "@/components/app-ui";
import { FocusOnLoad } from "@/components/focus-on-load";
import type { LinkEnd } from "@/lib/server/links";
import { dayOf } from "@/lib/today";

/**
 * Why a page can't show its link: `closed` (the token is right but the link no longer opens), `incomplete`
 * (opened without its token), `stale` (its 30-minute token cookie ran out while the page sat open, so the
 * last thing the visitor did didn't happen: `undone` is that sentence).
 */
export type LinkWhy = "closed" | "incomplete" | "stale";

/** The headline and the line under it for a link that can't show its page. */
function explain(noun: string, why: LinkWhy, end: LinkEnd | null | undefined, zone: string, undone: string, expiredAsk: string): [string, string] {
  if (why === "incomplete") {
    return [`Open the full ${noun} you were sent`, "This page opens only from the complete link in your message. Open that link again, or ask whoever sent it for a new one."];
  }
  if (why === "stale") {
    return ["This page was open too long", `${undone} Open the link from your message again, or ask whoever sent it for a new one.`];
  }
  if (end?.state === "expired") return [`This ${noun} has expired`, `It stopped working on ${dayOf(end.endedAt, zone)}. ${expiredAsk}`];
  if (end?.state === "revoked") return [`This ${noun} was turned off`, "Whoever sent it turned it off. Ask them for a new one."];
  // No end for the right token: what the link pointed to is gone (every document archived, the vendor archived, the workspace deleted).
  return [`This ${noun} has stopped working`, `This ${noun} has expired, been turned off, or what it shared was removed. Ask whoever sent it for a new one.`];
}

/**
 * What a visitor sees when a shared link (passport, signing or upload) can't show its page: what it
 * means in one line, and one thing to do about it. The page can't say who sent the link (an unknown
 * or closed link reveals nothing), so the button drafts the message asking them for a new one. With
 * `end` (known only to a holder of the link's own token) it says whether it ran out, and when (the day
 * where the viewer is), or was turned off. `expiredAsk` lets a page name a second next step (the signer's copy).
 */
export function LinkUnavailable({
  noun,
  why,
  end,
  zone,
  undone = "It needs the link again.",
  expiredAsk = "Ask whoever sent it for a new one.",
}: {
  noun: string;
  why: LinkWhy;
  end?: LinkEnd | null;
  zone: string;
  undone?: string;
  expiredAsk?: string;
}) {
  const ask = `mailto:?subject=${encodeURIComponent("A new ShipShape link")}&body=${encodeURIComponent(
    `The ${noun} you sent me through ShipShape has stopped working. Could you send me a new one?`,
  )}`;
  const [title, line] = explain(noun, why, end, zone, undone, expiredAsk);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold">{title}</h1>
        <p className="text-ink-2">{line}</p>
      </div>
      <a href={ask} className="btn self-start">
        Ask for a new link
      </a>
    </div>
  );
}

/** A visitor whose network opened shared pages too often in 10 minutes (the page-view limit). */
export function LinkBusy({ href }: { href: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold">Too many tries from this network</h1>
        <p className="text-ink-2">Wait 10 minutes, then reload this page.</p>
      </div>
      <a href={href} className="btn self-start">
        Reload this page
      </a>
    </div>
  );
}

/** A download refused by the file route's own limit (60 or 30 per network in 10 minutes): the page says so, where the link was, and reads it out. */
export function DownloadBusy() {
  return (
    <FocusOnLoad role="alert">
      <Notice tone="bad">Too many downloads from this network. Wait 10 minutes, then try again.</Notice>
    </FocusOnLoad>
  );
}
