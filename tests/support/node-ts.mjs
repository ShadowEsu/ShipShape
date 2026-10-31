// Loaded into vitest's workers (vitest.config.mts execArgv), and so into the worker threads tests
// start: lets Node run the app's TypeScript itself, as Turbopack's bundle does in the app. Node strips
// the types; this adds the extension the app's relative imports leave out.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (e) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw e;
    }
  },
});
