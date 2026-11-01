import { LoadingFrame } from "@/components/skeletons";

// A document while it loads: the main column beside the 320px side column, as on the page.
export default function Loading() {
  return (
    <LoadingFrame>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <div className="card h-48" />
          <div className="card h-32" />
        </div>
        <div className="space-y-6">
          <div className="card h-40" />
          <div className="card h-28" />
        </div>
      </div>
    </LoadingFrame>
  );
}
