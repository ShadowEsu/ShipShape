import { describe, expect, it } from "vitest";
import { bytesStream } from "@/lib/server/http";

/** Downloads and exports go out as a stream of 1 MiB pieces, since Vercel caps buffered responses at 4.5 MB. */

describe("bytesStream", () => {
  it("hands over 2.5 MiB as three pieces (1 MiB, 1 MiB, the rest) that add up to the input", async () => {
    const input = new Uint8Array(2.5 * 1024 * 1024);
    for (let i = 0; i < input.length; i++) input[i] = (i * 31) % 251;

    const reader = bytesStream(input).getReader();
    const chunks: Uint8Array[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);

    expect(chunks.map((c) => c.length)).toEqual([1024 * 1024, 1024 * 1024, 512 * 1024]);
    expect(Buffer.concat(chunks).equals(Buffer.from(input))).toBe(true);
  });
});
