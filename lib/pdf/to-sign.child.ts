// One upload's buildToSign, or one signing's appendPages, in a process of its own (Security R7-8, R9-1;
// W11-10). Started only by build-isolated.ts, which Node runs as TypeScript as it is (no bundler), so
// imports carry `.ts`. Says "ready" once everything is loaded, then takes one job, answers once and exits.
import { appendPages } from "./append.ts";
import type { ChildJob } from "./build-isolated.ts";
import { buildToSign, NotSignable } from "./to-sign.ts";

async function answer(job: ChildJob) {
  let outcome: { built: Uint8Array } | { refused: NotSignable["reason"] } | { failed: string };
  try {
    outcome = { built: "base" in job ? await appendPages(job.base, job.extra) : await buildToSign(job.bytes, job.mime) };
  } catch (e) {
    outcome = e instanceof NotSignable ? { refused: e.reason } : { failed: e instanceof Error ? (e.stack ?? e.message) : String(e) };
  }
  process.send?.(outcome, () => process.exit(0));
}

if (!process.send) throw new Error("to-sign.child runs only as a child process of build-isolated.ts");
process.once("message", (job: ChildJob) => void answer(job));
process.send({ ready: true });
