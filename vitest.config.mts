import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // Next.js enforces `server-only` at build time; under vitest everything is server code.
      "server-only": path.join(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // The worker threads tests start (lib/pdf/build-isolated.ts) run the app's TypeScript in Node itself.
    execArgv: ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", path.join(import.meta.dirname, "tests/support/node-ts.mjs")],
    env: {
      SHIPSHAPE_FIELD_KEY: Buffer.alloc(32, 7).toString("base64"),
      SHIPSHAPE_SESSION_SECRET: "test-session-secret-not-used-anywhere-else",
      SHIPSHAPE_HASH_KEY: "test-hash-key-not-used-anywhere-else-0000",
    },
  },
});
