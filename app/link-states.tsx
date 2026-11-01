/**
 * What a visitor sees when a shared link (passport, signing or upload) can't show its page: what it
 * means in one line, and one thing to do about it. The page can't say who sent the link (an unknown
 * or closed link reveals nothing), so the button drafts the message asking them for a new one.
 */
export function LinkUnavailable({ noun, why }: { noun: string; why: "closed" | "incomplete" }) {
  const ask = `mailto:?subject=${encodeURIComponent("A new ShipShape link")}&body=${encodeURIComponent(
    `The ${noun} you sent me through ShipShape has stopped working. Could you send me a new one?`,
  )}`;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-semibold">{why === "closed" ? `This ${noun} has stopped working` : `Open the full ${noun} you were sent`}</h1>
        <p className="text-ink-2">
          {why === "closed"
            ? "It has expired or been turned off. Ask whoever sent it for a new one."
            : "This page opens only from the complete link in your message. Open that link again, or ask whoever sent it for a new one."}
        </p>
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
