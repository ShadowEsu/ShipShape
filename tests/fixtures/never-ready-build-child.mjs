// A build process that never says it's ready, as on a server too busy to start it (W11-13). Listening
// on its IPC channel keeps it alive until the parent kills it.
process.on("message", () => {});
