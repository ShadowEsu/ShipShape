import { describe, expect, it } from "vitest";
import { decryptField, encryptField, newToken, sha256Hex } from "@/lib/server/crypto";
import { installLogScrubber, scrub } from "@/lib/server/log";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("tax identifier encryption (R4)", () => {
  it("round-trips and never stores the value in clear", () => {
    const sealed = encryptField("98-7654321", ORG, "ein");
    expect(sealed).not.toContain("7654321");
    expect(decryptField(sealed, ORG, "ein")).toBe("98-7654321");
    expect(encryptField("98-7654321", ORG, "ein")).not.toBe(sealed); // fresh IV each time
  });

  it("won't open in another workspace or field, or after tampering", () => {
    const sealed = encryptField("98-7654321", ORG, "ein");
    expect(() => decryptField(sealed, OTHER, "ein")).toThrow();
    expect(() => decryptField(sealed, ORG, "ssn")).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join("."), ORG, "ein")).toThrow();
  });
});

describe("link tokens (R5)", () => {
  it("are 256-bit random and only their hash is meant for storage", () => {
    const { token, hash } = newToken();
    expect(Buffer.from(token, "base64url").length).toBe(32);
    expect(hash).toBe(sha256Hex(token));
    expect(newToken().token).not.toBe(token);
  });
});

describe("log scrubber (R4)", () => {
  // IRS-invalid sample values: SSNs starting 9xx/000 and EINs starting 00 are never issued.
  const samples = ["900-12-3456", "000123456", "900 12 3456", "00-1234567", "001234567", "900.12.3456"];

  it("redacts every SSN, EIN and ITIN shape", () => {
    for (const s of samples) expect(scrub(`profile saved ${s} ok`)).toBe("profile saved [redacted-id] ok");
  });

  it("leaves dates, amounts, ids and phone numbers readable", () => {
    const keep = "2026-10-30 $1,250.00 seq 12 (415) 555-0100 order 12345678 uuid 3f2a9c1e";
    expect(scrub(keep)).toBe(keep);
  });

  it("redacts share and signing tokens in paths", () => {
    expect(scrub("GET /p/AbCdEfGhIjKlMnOpQrStUvWxYz012345?x=1")).toBe("GET /p/[redacted-token]?x=1");
  });

  it("scrubs everything written through console, including objects and errors", () => {
    const lines: string[] = [];
    const fake = { log: (s: string) => lines.push(s), info: (s: string) => lines.push(s), warn: (s: string) => lines.push(s),
      error: (s: string) => lines.push(s), debug: (s: string) => lines.push(s), trace: (s: string) => lines.push(s) } as unknown as Console;
    installLogScrubber(fake);
    fake.error(new Error("bad ein 00-1234567"));
    fake.log({ profile: { ein: "001234567", ssn: "900-12-3456" } });
    fake.warn("ssn %s", "900123456");
    expect(lines.length).toBe(3);
    for (const line of lines) expect(line).not.toMatch(/[0-9]{3}-?[0-9]{2}-?[0-9]{4}|[0-9]{2}-?[0-9]{7}/);
  });
});
