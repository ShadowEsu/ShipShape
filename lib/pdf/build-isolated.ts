import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { buildToSign } from "./to-sign";
import { NotSignable } from "./to-sign";

/** Per upload: what its thread may use before the upload is refused as unreadable. */
export interface IsolationLimits {
  /** V8's old generation, where pdf-lib's objects live (Security measured accepted files under 300 MB per process). */
  heapMb: number;
  timeoutMs: number;
}
export const ISOLATION_LIMITS: IsolationLimits = { heapMb: 512, timeoutMs: 20_000 };

const Outcome = z.union([
  z.object({ built: z.instanceof(Uint8Array) }),
  z.object({ refused: z.enum(["viewer_dependent", "unreadable"]) }),
  z.object({ failed: z.string() }),
]);

/**
 * buildToSign in a worker thread of its own, one per upload (Security R7-8). pdf-lib keeps every
 * name and reference it has seen in process-wide tables that are never cleared, so in the server's
 * own thread each upload full of fresh names would hold on to its memory for the life of the
 * instance; here the tables go with the thread. An upload that needs more memory or time than
 * `limits` is refused as unreadable instead of taking the server down. A worker that fails any
 * other way (it couldn't start, a bug) rejects with that error, so it isn't mistaken for a bad file.
 */
export function buildToSignIsolated(bytes: Uint8Array, mime: Parameters<typeof buildToSign>[1], limits: IsolationLimits = ISOLATION_LIMITS): Promise<Uint8Array> {
  const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
  const worker = new Worker(new URL("./to-sign.worker.ts", import.meta.url), {
    workerData: { bytes, mime },
    resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
  });
  let done = false;
  const finish = (settle: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    void worker.terminate();
    settle();
  };
  const timer = setTimeout(() => finish(() => reject(new NotSignable("unreadable", new Error(`not built within ${limits.timeoutMs} ms`)))), limits.timeoutMs);
  worker.on("message", (message: unknown) =>
    finish(() => {
      const outcome = Outcome.parse(message);
      if ("built" in outcome) resolve(outcome.built);
      else if ("refused" in outcome) reject(new NotSignable(outcome.refused));
      else reject(new Error(`buildToSign failed in its worker: ${outcome.failed}`));
    }),
  );
  worker.on("error", (e) => finish(() => reject("code" in e && e.code === "ERR_WORKER_OUT_OF_MEMORY" ? new NotSignable("unreadable", e) : e)));
  worker.on("exit", (code) => finish(() => reject(new NotSignable("unreadable", new Error(`worker stopped (exit code ${code})`)))));
  return promise;
}
