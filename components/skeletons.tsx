/**
 * Loading skeletons for app routes (each route's loading.tsx), shaped like the page they stand in for
 * so it doesn't jump when the page arrives. Screen readers hear "Loading…" once; the shapes are hidden.
 */
export function LoadingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="space-y-6">
      <p role="status" className="sr-only">
        Loading…
      </p>
      <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
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
