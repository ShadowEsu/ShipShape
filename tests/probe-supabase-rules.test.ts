import { describe, expect, it } from "vitest";
import { appSchemaNotServed, supabaseSqlTls } from "../scripts/probe-supabase-rules.ts";

// The decisions scripts/probe-supabase.mjs makes (W12-6, W12-7).
describe("the app schema isn't served (W12-7)", () => {
  it("accepts 406 PGRST106, whatever /rest/v1/ answered", () => {
    expect(appSchemaNotServed({ status: 406, json: { code: "PGRST106" } }, 200)).toBe(true);
  });

  it("accepts a 404 only when the whole Data API is off", () => {
    expect(appSchemaNotServed({ status: 404, json: null }, 404)).toBe(true);
    // A served schema whose table or function isn't in PostgREST's cache also answers 404.
    expect(appSchemaNotServed({ status: 404, json: { code: "PGRST205" } }, 200)).toBe(false);
    expect(appSchemaNotServed({ status: 404, json: { code: "PGRST202" } }, 200)).toBe(false);
  });

  it("refuses data, an RLS or permission error, or a 406 for another reason", () => {
    expect(appSchemaNotServed({ status: 200, json: [] }, 200)).toBe(false);
    expect(appSchemaNotServed({ status: 401, json: { code: "42501" } }, 200)).toBe(false);
    expect(appSchemaNotServed({ status: 406, json: { code: "PGRST116" } }, 200)).toBe(false);
  });
});

describe("the superuser SQL connection's TLS (W12-6)", () => {
  it("verifies the chain and hostname against DATABASE_CA_CERT", () => {
    expect(supabaseSqlTls("-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----")).toEqual({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
    });
  });

  it("gives nothing to connect with when it isn't set, so the probe exits 2", () => {
    expect(supabaseSqlTls(undefined)).toBeNull();
    expect(supabaseSqlTls("  ")).toBeNull();
  });
});
