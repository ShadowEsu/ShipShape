import { LoadingFrame } from "@/components/skeletons";

// Shown in <main> the moment a link is clicked, while the server renders the page (the sidebar stays).
// The fallback for routes without their own loading.tsx (documents, passport and a document have one).
export default function Loading() {
  return (
    <LoadingFrame>
      <div className="card h-40" />
      <div className="card h-28" />
    </LoadingFrame>
  );
}
