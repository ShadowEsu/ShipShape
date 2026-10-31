import { assertLaunchConfig } from "./lib/server/flags";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Refuse to start without what production needs (contact address with real documents open).
    assertLaunchConfig(process.env);
    // Node-only module; the edge runtime never loads it.
    const { installLogScrubber } = await import("./lib/server/log");
    installLogScrubber();
  }
}
