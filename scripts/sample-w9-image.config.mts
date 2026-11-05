import { defineConfig } from "vitest/config";
import base from "../vitest.config.mjs";

/** `npm run sample:w9-image` (scripts/sample-w9-image.run.ts): makes the sample W-9's preview images. Never part of `npm test`. */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["scripts/sample-w9-image.run.ts"] },
});
