"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-2xl px-5 pt-16 pb-24">
      <ErrorPanel digest={error.digest} reset={reset} home />
    </main>
  );
}
