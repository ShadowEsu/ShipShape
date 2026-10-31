// One upload's buildToSign, in a thread of its own (Security R7-8). Started only by build-isolated.ts.
import { parentPort, workerData } from "node:worker_threads";
import { buildToSign, NotSignable } from "./to-sign";

async function run() {
  if (!parentPort) throw new Error("to-sign.worker runs only as a worker thread");
  const port = parentPort;
  const input: { bytes: Uint8Array; mime: Parameters<typeof buildToSign>[1] } = workerData;
  try {
    const built = await buildToSign(input.bytes, input.mime);
    port.postMessage({ built }, built.buffer instanceof ArrayBuffer ? [built.buffer] : []);
  } catch (e) {
    if (e instanceof NotSignable) port.postMessage({ refused: e.reason });
    else port.postMessage({ failed: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
}

void run();
