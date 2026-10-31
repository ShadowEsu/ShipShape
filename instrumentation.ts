export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Node-only module; the edge runtime never loads it.
    const { installLogScrubber } = await import("./lib/server/log");
    installLogScrubber();
  }
}
