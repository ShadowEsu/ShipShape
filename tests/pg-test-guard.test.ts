import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostProblem, serverProblem } from "./support/pg-test-guard";

// Real postgres.js clients (creating one doesn't connect), so the hosts are the ones it would use.
const problem = (url: string, allowHost?: string) => {
  const sql = postgres(url);
  return hostProblem(sql, allowHost);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SHIPSHAPE_PG_TEST_URL only reaches a throwaway server (Security T-afc1)", () => {
  it("runs against this machine", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.8.9.10", "[::1]"]) {
      expect(problem(`postgres://su:pw@${host}:5432/postgres`), host).toBeNull();
    }
  });

  it("refuses any other host, including ones that only look local", () => {
    for (const host of ["shipshape.abc123.us-east-1.rds.amazonaws.com", "localhost.example.com", "127.0.0.1.nip.io", "10.0.0.5"]) {
      expect(problem(`postgres://su:pw@${host}:5432/postgres`), host).toContain(host);
    }
  });

  it("refuses a remote host hidden where postgres.js would still use it", () => {
    expect(problem("postgres://su:pw@localhost:5432/postgres?host=prod.example.com")).toContain("prod.example.com");
    expect(problem("postgres://su:pw@localhost:5432,prod.example.com:5432/postgres")).toContain("prod.example.com");
    vi.stubEnv("PGHOST", "prod.example.com");
    expect(problem("postgres://su:pw@/postgres")).toContain("prod.example.com");
  });

  it("allows exactly the one remote host named in SHIPSHAPE_PG_TEST_ALLOW_HOST", () => {
    expect(problem("postgres://su:pw@pg-ci.internal:5432/postgres", "pg-ci.internal")).toBeNull();
    expect(problem("postgres://su:pw@pg-prod.internal:5432/postgres", "pg-ci.internal")).toContain("pg-prod.internal");
  });

  it("refuses an Amazon RDS server even when it's reached through this machine (a tunnel)", () => {
    expect(serverProblem(["postgres", "rdsadmin", "shipshape", "template1"])).toMatch(/rdsadmin/);
    expect(serverProblem(["postgres", "shipshape", "template0", "template1"])).toBeNull();
  });
});
