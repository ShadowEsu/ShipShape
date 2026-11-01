"use client";

/**
 * What an error boundary shows: one line on what happened, the one button that may fix it, and
 * Next's digest as a small reference. Never the error text itself (it can hold data).
 */
export function ErrorPanel({ digest, reset }: { digest?: string; reset: () => void }) {
  return (
    <div role="alert" className="max-w-xl space-y-4">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">This page didn&apos;t load because of a problem on our side.</h1>
      <button type="button" className="btn-accent" onClick={reset}>
        Try again
      </button>
      {digest && <p className="font-mono text-xs text-ink-3">Reference for support: {digest}</p>}
    </div>
  );
}
