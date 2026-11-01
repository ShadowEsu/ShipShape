import { LoadingFrame, RowsSkeleton } from "@/components/skeletons";

// The passport page while it loads: the intro, the New link form beside five rows of links.
export default function Loading() {
  return (
    <LoadingFrame>
      <div className="h-4 w-full max-w-2xl rounded bg-line" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="card h-80" />
        <RowsSkeleton count={5} />
      </div>
    </LoadingFrame>
  );
}
