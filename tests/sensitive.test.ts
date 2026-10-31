import { describe, expect, it, vi } from "vitest";
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
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join("."), ORG, "ein")).toThrow();
    const shortTag = sealed.split(".");
    shortTag[3] = shortTag[3].slice(0, 8);
    expect(() => decryptField(shortTag.join("."), ORG, "ein")).toThrow();
  });

  it("names its key, and refuses ciphertext from another key", () => {
    const sealed = encryptField("98-7654321", ORG, "ein");
    expect(sealed.split(".")).toHaveLength(5);
    vi.stubEnv("SHIPSHAPE_FIELD_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(() => decryptField(sealed, ORG, "ein")).toThrow(/different key/);
    vi.unstubAllEnvs();
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
  const samples = [
    "900-12-3456",
    "000123456",
    "900 12 3456",
    "00-1234567",
    "001234567",
    "900.12.3456",
    // Security G4-1: Unicode dashes, spaced dashes, other separators, full-width digits, digit by digit.
    "900–12–3456",
    "00–1234567",
    "900—12—3456",
    "900−12−3456",
    "900 - 12 - 3456",
    "00 - 1234567",
    "900/12/3456",
    "900_12_3456",
    "００－１２３４５６７",
    "９００１２３４５６",
    "9 0 0 1 2 3 4 5 6",
    "9-0-0-1-2-3-4-5-6",
  ];

  it("redacts every SSN, EIN and ITIN shape", () => {
    for (const s of samples) expect(scrub(`profile saved ${s} ok`)).toBe("profile saved [redacted-id] ok");
  });

  it("leaves dates, amounts, ids and phone numbers readable", () => {
    const keep = "2026-10-30 $1,250.00 seq 12 (415) 555-0100 order 12345678 uuid 3f2a9c1e call 415 555 0100 at 10:30";
    expect(scrub(keep)).toBe(keep);
  });

  it("doesn't cut 9 digits out of a longer number", () => {
    for (const s of ["4155550100", "415-555-0100", "1234 5678 9012 3456", "9 0 0 1 2 3 4 5 6 7"]) expect(scrub(`n ${s} n`)).toBe(`n ${s} n`);
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
