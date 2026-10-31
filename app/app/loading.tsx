// Shown in <main> the moment a link is clicked, while the server renders the page (the sidebar stays).
export default function Loading() {
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
        <div className="card h-40" />
        <div className="card h-28" />
      </div>
    </div>
  );
}
