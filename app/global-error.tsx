"use client";

import "./globals.css";
import { ErrorPanel } from "@/components/error-panel";

/** Replaces the root layout when it fails, so it brings its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong · ShipShape</title>
      </head>
      <body>
        <main id="main" className="mx-auto max-w-2xl px-5 pt-16 pb-24">
          <ErrorPanel digest={error.digest} reset={reset} home />
        </main>
      </body>
    </html>
  );
}
