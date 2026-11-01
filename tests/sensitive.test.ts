import { describe, expect, it, vi } from "vitest";
import { PROFILE_FIELDS } from "@/lib/profile-fields";
import { decryptField, encryptField, newToken, sha256Hex } from "@/lib/server/crypto";
import { installLogScrubber, scrub } from "@/lib/server/log";
import { EinInput, ProfileInput } from "@/lib/server/profile";

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

describe("business facts and the EIN as typed (R4)", () => {
  const blank = { ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, ""])), entity_type: "" };

  it("takes each business fact up to its length limit, and refuses one character more", () => {
    for (const f of PROFILE_FIELDS) {
      expect(ProfileInput.safeParse({ ...blank, [f.key]: "x".repeat(f.max) }).success).toBe(true);
      expect(ProfileInput.safeParse({ ...blank, [f.key]: "x".repeat(f.max + 1) }).success).toBe(false);
    }
  });

  // IRS-invalid sample values (EINs starting 00 are never issued).
  it("takes an EIN of exactly 9 digits, with or without the dash; 8 or 10 digits are refused", () => {
    expect(EinInput.parse("00-1234567")).toBe("001234567");
    expect(EinInput.parse(" 001234567 ")).toBe("001234567");
    expect(EinInput.safeParse("00-123456").success).toBe(false);
    expect(EinInput.safeParse("00-12345678").success).toBe(false);
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
    "900 -- 12 -- 3456",
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

  // Security G4-1b: a tax ID next to other digits, or split by invisible characters.
  const touching = [
    "W-9 900-12-3456",
    "Send the W-9 900-12-3456 today",
    "1. 900-12-3456",
    "Line 1 900-12-3456",
    "dated 10/31 900-12-3456",
    "Ref 12 900123456",
    "SSN: 900-12-3456 9",
    "900\u200b-12-3456",
    "900\u00ad12\u00ad3456",
  ];

  it("redacts a tax ID that touches other digits or hides invisible characters", () => {
    for (const s of touching) {
      const out = scrub(s);
      expect(out.replace(/\D/g, "")).not.toContain("900123456");
      expect(out).toContain("[redacted-id]");
    }
  });

  it("keeps IRS form names while removing the number next to them", () => {
    expect(scrub("Send the W-9 900-12-3456 today")).toBe("Send the W-9 [redacted-id] today");
    expect(scrub("W9 00-1234567, Form W-8BEN 900123456")).toBe("W9 [redacted-id], Form W-8BEN [redacted-id]");
  });

  it("leaves dates, amounts, ids and bracketed phone numbers readable", () => {
    const keep =
      "2026-10-30 $1,250.00 seq 12 (415) 555-0100 order 12345678 uuid 3f2a9c1e at 10:30. Need W-9 by 2026-11-15, license 12345678, Policy GL-2026-0042, limits $1,000,000 / $2,000,000";
    expect(scrub(keep)).toBe(keep);
  });

  it("redacts the whole of a longer number, never leaving 9 of its digits", () => {
    for (const s of ["4155550100", "415-555-0100", "1234 5678 9012 3456", "9 0 0 1 2 3 4 5 6 7"]) expect(scrub(`n ${s} n`)).toBe("n [redacted-id] n");
  });

  it("keeps a UUID whole even when its digits run 9 or more across the hyphens, and still scrubs what sits beside it (W10-14)", () => {
    const id = "12345678-1234-4abc-8def-123456789012";
    expect(scrub(`reminders: ${id} not sent (23505)`)).toBe(`reminders: ${id} not sent (23505)`);
    // Beside it: an SSN and a card number go; a passport path with that id goes as before.
    expect(scrub(`${id} ssn 900-12-3456 card 4111 1111 1111 1111 ${id}`)).toBe(`${id} ssn [redacted-id] card [redacted-id] ${id}`);
    expect(scrub(`open /p/${id}#tok`)).toBe("open /p/[redacted-token]#tok");
    // A UUID-shaped run with no hex letter at all is treated as a number, so a tax ID in that costume still goes.
    expect(scrub("12345678-1234-4123-8123-123456789012")).toBe("[redacted-id]");
  });

  it("control characters can't split a number past the scrub or forge the UUID sentinel; tab, newline and return stay (Security LOW-L1)", () => {
    // A NUL, a bell and a C1 control between the groups: the number still goes, whole.
    expect(scrub("SSN 900\u000012\u00003456")).toBe("SSN [redacted-id]");
    expect(scrub("EIN 12\u0007345\u00856789")).toBe("EIN [redacted-id]");
    // A forged sentinel beside a UUID doesn't come back as a second copy of it.
    const id = "12345678-1234-4abc-8def-123456789012";
    expect(scrub(`${id} \u00000\u0000`)).toBe(`${id} 0`);
    expect(scrub("a\tb\nc\r\nd")).toBe("a\tb\nc\r\nd");
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
