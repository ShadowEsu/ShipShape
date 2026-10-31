// One upload's buildToSign, in a process of its own (Security R7-8, R9-1). Started only by
// build-isolated.ts, which Node runs as TypeScript as it is (no bundler), so imports carry `.ts`.
// Says "ready" once everything is loaded, then takes one { bytes, mime }, answers once and exits.
import { buildToSign, NotSignable } from "./to-sign.ts";

type Input = { bytes: Uint8Array; mime: Parameters<typeof buildToSign>[1] };

async function answer(input: Input) {
  let outcome: { built: Uint8Array } | { refused: NotSignable["reason"] } | { failed: string };
  try {
    outcome = { built: await buildToSign(input.bytes, input.mime) };
  } catch (e) {
    outcome = e instanceof NotSignable ? { refused: e.reason } : { failed: e instanceof Error ? (e.stack ?? e.message) : String(e) };
  }
  process.send?.(outcome, () => process.exit(0));
}

if (!process.send) throw new Error("to-sign.child runs only as a child process of build-isolated.ts");
process.once("message", (input: Input) => void answer(input));
process.send({ ready: true });
