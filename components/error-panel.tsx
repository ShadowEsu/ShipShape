"use client";

/**
 * What an error boundary shows: one line on what happened, the one button that may fix it, where to get help, and
 * Next's digest as a small reference to quote. Never the error text itself (it can hold data). A plain <a>, not
 * next/link: the global boundary renders without the root layout, and a full load is the safer way out of an error.
 */
export function ErrorPanel({ digest, reset, home = false }: { digest?: string; reset: () => void; home?: boolean }) {
  return (
    <div className="max-w-xl space-y-4">
      {/* Only the message is the alert, so a screen reader announces one sentence, not the buttons and help. */}
      <div role="alert">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">This page didn&apos;t load because of a problem on our side.</h1>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-accent" onClick={reset}>
          Try again
        </button>
        {/* Outside the app there's no header or menu on this page, so this is the way back. */}
        {home && (
          <a href="/" className="btn-ghost">
            Go to the home page
          </a>
        )}
      </div>
      <p className="text-sm text-ink-2">
        Still not working?{" "}
        <a href="/faq#support" className="underline">
          Write to us
        </a>
        {digest ? " and quote this reference." : "."}
      </p>
      {digest && <p className="font-mono text-xs text-ink-3">Reference for support: {digest}</p>}
    </div>
  );
}
