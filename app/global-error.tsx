"use client";

import "./globals.css";
import { ErrorPanel } from "@/components/error-panel";

/** Replaces the root layout when it fails, so it brings its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main id="main" className="mx-auto max-w-2xl px-5 pt-16 pb-24">
          <ErrorPanel digest={error.digest} reset={reset} />
        </main>
      </body>
    </html>
  );
}
