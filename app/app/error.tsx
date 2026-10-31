"use client";

import { ErrorPanel } from "@/components/error-panel";

/** Inside the app the sidebar stays; only the page area shows the error. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel digest={error.digest} reset={reset} />;
}
