/**
 * Loading skeletons for app routes (each route's loading.tsx), shaped like the page they stand in for
 * so it doesn't jump when the page arrives. Screen readers hear "Loading…" once; the shapes are hidden.
 * The redesigned app sweeps the shapes with a highlight after 200ms, and past 600ms shows the mark over them
 * (app/motion.css, skeleton and brand-loader); the earlier look keeps its blink.
 */
export function LoadingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="relative space-y-6">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div aria-hidden="true" className="brand-loader pointer-events-none absolute inset-0 z-10 place-items-center">
        <svg width="48" height="48" viewBox="0 0 32 32" className="text-ink">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <path d="M7 19h18l-3 5H10z" fill="var(--paper)" />
          <path d="M16 7v10M16 7l6 8h-6" stroke="var(--paper)" strokeWidth="2" fill="none" strokeLinejoin="round" />
        </svg>
      </div>
      <div aria-hidden="true" className="skeleton space-y-6 motion-safe:animate-pulse">
        <div className="space-y-2">
          <div className="h-3 w-20 rounded bg-line" />
          <div className="h-9 w-64 max-w-full rounded-lg bg-line" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** A list card of `count` rows, like the documents and passport lists. */
export function RowsSkeleton({ count }: { count: number }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-3 w-24 shrink-0 rounded bg-canvas" />
          <div className="h-4 flex-1 rounded bg-canvas" />
          <div className="h-5 w-20 shrink-0 rounded-full bg-canvas" />
        </li>
      ))}
    </ul>
  );
}
