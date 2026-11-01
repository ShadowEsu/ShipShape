export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Node-only modules; the edge runtime never loads them.
    // Refuse to serve without what this deployment needs: every secret and setting in production,
    // the contact address with real documents open (W12-2).
    const { assertLaunchConfig } = await import("./lib/server/launch-check");
    assertLaunchConfig(process.env);
    const { installLogScrubber } = await import("./lib/server/log");
    installLogScrubber();
  }
}
