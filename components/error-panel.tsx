"use client";

/** What an error boundary shows: no error text (it can hold data), only Next's digest as a reference. */
export function ErrorPanel({ digest, reset }: { digest?: string; reset: () => void }) {
  return (
    <div role="alert" className="max-w-xl space-y-4">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Something went wrong on our side.</h1>
      <p className="text-ink-2">Try again. If it keeps happening, wait a minute and reload the page.</p>
      {digest && <p className="font-mono text-xs text-ink-3">Reference: {digest}</p>}
      <button type="button" className="btn-accent" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
