import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { buildToSign } from "./to-sign";
import { NotSignable } from "./to-sign";

/** Per upload: what its process may use before the upload is refused as unreadable. */
export interface IsolationLimits {
  /** V8's old generation, where pdf-lib's objects live (Security: real 3-8 MB PDFs build within 128 MB). */
  heapMb: number;
  /** The build itself, counted from when the process says it's ready. */
  timeoutMs: number;
  /** Starting the process and loading its code: past this it's BuildCrashed (a busy server), not the file's fault (W11-13). */
  startMs: number;
}
export const ISOLATION_LIMITS: IsolationLimits = { heapMb: 256, timeoutMs: 20_000, startMs: 20_000 };
/** Builds at once per server instance, and how long a build waits for its turn (Security R9-2). */
export const MAX_BUILDS = 2;
export const SLOT_WAIT_MS = 20_000;

/** Every build slot stayed busy for SLOT_WAIT_MS: the server is busy, the file may be fine. */
export class BuildBusy extends Error {
  constructor() {
    super("every build slot stayed busy");
  }
}

/**
 * The build process stopped some other way than at its limits (a crash such as SIGSEGV, killed from
 * outside, or gone without answering), or didn't start in time (a busy server): ShipShape's fault,
 * not the file's, so the sender may try again.
 * Nothing was built: the PDF only ever arrives whole, in one message.
 */
export class BuildCrashed extends Error {}

/** At most `size` holders at once; the rest wait in order, each for at most `waitMs`. */
export class BuildSlots {
  #free: number;
  readonly #waiting: (() => void)[] = [];
  constructor(size: number) {
    this.#free = size;
  }

  /** Resolves with this holder's release once a slot is free; rejects with BuildBusy after `waitMs`. */
  take(waitMs: number): Promise<() => void> {
    const { promise, resolve, reject } = Promise.withResolvers<() => void>();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free++;
    };
    if (this.#free > 0) {
      this.#free--;
      resolve(release);
      return promise;
    }
    const grant = () => {
      clearTimeout(timer);
      resolve(release);
    };
    const timer = setTimeout(() => {
      this.#waiting.splice(this.#waiting.indexOf(grant), 1);
      reject(new BuildBusy());
    }, waitMs);
    this.#waiting.push(grant);
    return promise;
  }
}
const slots = new BuildSlots(MAX_BUILDS);

// Shipped as TypeScript (next.config.ts outputFileTracingIncludes) and run by Node itself.
const CHILD = path.join(process.cwd(), "lib", "pdf", "to-sign.child.ts");

const Message = z.union([
  z.object({ ready: z.literal(true) }),
  z.object({ built: z.instanceof(Uint8Array) }),
  z.object({ refused: z.enum(["viewer_dependent", "unreadable"]) }),
  z.object({ failed: z.string() }),
]);

/**
 * buildToSign in a child process of its own, one per upload, at most MAX_BUILDS at once (Security
 * R7-8, R9-1, R9-2). pdf-lib keeps every name and reference it has seen in process-wide tables that
 * are never cleared; here they go with the process. An upload that takes the process past `limits`
 * (V8 aborts the process at its heap limit, or the timeout kills it) is refused as unreadable, and
 * the server itself never runs out. Of the environment the child gets only NODE_ENV, so no secret. A child that
 * fails before it has loaded (missing files, a bug) rejects with that error, so a broken deployment
 * isn't mistaken for a bad file; one that isn't ready within `startMs`, or stops any other way after
 * loading, is BuildCrashed, and waiting too long for a slot is BuildBusy.
 */
export async function buildToSignIsolated(bytes: Uint8Array, mime: Parameters<typeof buildToSign>[1], limits: IsolationLimits = ISOLATION_LIMITS): Promise<Uint8Array> {
  const release = await slots.take(SLOT_WAIT_MS);
  try {
    return await buildInChild(bytes, mime, limits, CHILD);
  } finally {
    release();
  }
}

/** Exported for tests, which pass a child that crashes; everything else goes through buildToSignIsolated. */
export function buildInChild(bytes: Uint8Array, mime: Parameters<typeof buildToSign>[1], limits: IsolationLimits, script: string): Promise<Uint8Array> {
  const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
  // fork() would do, but Turbopack's build resolves fork()'s path as a module and fails
  // (vercel/next.js#97952); spawn with an "ipc" channel is the same thing.
  const child = spawn(process.execPath, [`--max-old-space-size=${limits.heapMb}`, script], {
    env: { NODE_ENV: process.env.NODE_ENV },
    serialization: "advanced",
    // What it has to say comes over IPC; V8's out-of-memory dump and pdf-lib's warnings stay out of the logs.
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let ready = false;
  let done = false;
  const finish = (settle: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    child.kill("SIGKILL");
    settle();
  };
  // Until the process is ready, the time is the server's, not the file's (W11-13).
  let timer = setTimeout(() => finish(() => reject(new BuildCrashed(`build process didn't start within ${limits.startMs} ms`))), limits.startMs);
  child.on("message", (raw: unknown) => {
    const message = Message.safeParse(raw);
    if (!message.success) return finish(() => reject(new Error(`build process sent an unexpected message: ${message.error.message}`)));
    const m = message.data;
    if ("ready" in m) {
      if (ready) return;
      ready = true;
      clearTimeout(timer);
      timer = setTimeout(() => finish(() => reject(new NotSignable("unreadable", new Error(`not built within ${limits.timeoutMs} ms`)))), limits.timeoutMs);
      child.send({ bytes, mime });
    } else finish(() => ("built" in m ? resolve(m.built) : "refused" in m ? reject(new NotSignable(m.refused)) : reject(new Error(`buildToSign failed in its process: ${m.failed}`))));
  });
  child.on("error", (e) => finish(() => reject(e)));
  child.on("exit", (code, signal) =>
    finish(() => {
      const how = new Error(`build process stopped (exit code ${code}, signal ${signal})`);
      if (!ready) reject(how);
      // V8 aborts the process when it reaches its heap limit: the file needs more than an upload may use.
      else if (signal === "SIGABRT") reject(new NotSignable("unreadable", how));
      else reject(new BuildCrashed(how.message, { cause: how }));
    }),
  );
  return promise;
}
