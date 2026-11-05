import { MARK_PATHS } from "./brand-mark";

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
        {/* The app icon (Design's rules: the mark at 62% of an ink tile, radius 22.5%), as one svg so it rocks whole. */}
        <svg width="48" height="48" viewBox="0 0 64 64" className="text-ink">
          <rect width="64" height="64" rx="14.4" fill="currentColor" />
          <g transform="translate(12.16 12.16) scale(0.62)">
            {MARK_PATHS.map((d) => (
              <path key={d} d={d} fill="var(--paper)" />
            ))}
          </g>
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
