// A build process that loads, takes its file, then crashes (REG-58: a SIGSEGV in the real one).
process.send({ ready: true });
process.on("message", () => process.kill(process.pid, "SIGSEGV"));
