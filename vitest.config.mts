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
    env: {
      SHIPSHAPE_FIELD_KEY: Buffer.alloc(32, 7).toString("base64"),
      SHIPSHAPE_SESSION_SECRET: "test-session-secret-not-used-anywhere-else",
    },
  },
});
