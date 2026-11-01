import { LoadingFrame, RowsSkeleton } from "@/components/skeletons";

// The documents list while it loads: the search bar and five rows.
export default function Loading() {
  return (
    <LoadingFrame>
      <div className="h-10 rounded-lg bg-line" />
      <RowsSkeleton count={5} />
    </LoadingFrame>
  );
}
