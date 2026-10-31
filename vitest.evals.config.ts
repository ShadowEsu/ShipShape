import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

/** Real-model evals: `npm run eval:ai`. Never part of `npm test`; each run costs money and needs approval. */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["evals/**/*.eval.ts"], testTimeout: 180_000, fileParallelism: false },
});
