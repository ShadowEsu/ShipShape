import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import { accountPabProblems, keyPolicyProblems, nodeModulesProblems, scramVerifier, vercelLinkProblems } from "../scripts/launch-checks.ts";

// The checks infra/launch.sh runs with node (scripts/launch-checks.ts).
const root = mkdtempSync(path.join(os.tmpdir(), "launch-checks-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const account = "111122223333";

describe("scramVerifier (W12-10)", () => {
  // RFC 7677 section 3: user "user", password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ==, 4096 iterations.
  // A verifier holds StoredKey and ServerKey; from them and the exchange's AuthMessage come the
  // client's proof (with ClientKey) and the server's signature the RFC publishes.
  it("matches RFC 7677's published exchange", () => {
    const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
    const verifier = scramVerifier("pencil", salt);
    const m = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verifier);
    expect(m?.[1]).toBe("W22ZaJ0SNY7soEsUEjb6gQ==");
    const storedKey = Buffer.from(m?.[2] ?? "", "base64");
    const serverKey = Buffer.from(m?.[3] ?? "", "base64");
    const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    // The RFC's client-final proof is ClientKey XOR ClientSignature; SHA-256(ClientKey) must be StoredKey.
    const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
    const proof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
    const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSignature[i]));
    expect(createHash("sha256").update(clientKey).digest().equals(storedKey)).toBe(true);
    expect(createHmac("sha256", serverKey).update(authMessage).digest("base64")).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
  });

  it("uses 16 random salt bytes, new each time", () => {
    const [a, b] = [scramVerifier("same password"), scramVerifier("same password")];
    expect(a).not.toBe(b);
    expect(Buffer.from(/:([^$]+)\$/.exec(a)?.[1] ?? "", "base64")).toHaveLength(16);
  });

  // Postgres stores a string it recognises as a SCRAM verifier unchanged; anything else it would hash.
  it("is stored by Postgres as it is, so the server never sees the password", async () => {
    const pg = await PGlite.create();
    try {
      const verifier = scramVerifier("Abc123def456ghi789jkl012mno345pqr678stu9");
      await pg.exec("create role shipshape_app");
      await pg.query("select set_config('shipshape.app_verifier', $1, false)", [verifier]);
      await pg.exec("do $$ begin execute format('alter role shipshape_app with login password %L', current_setting('shipshape.app_verifier')); end $$");
      const { rows } = await pg.query<{ rolpassword: string }>("select rolpassword from pg_authid where rolname = 'shipshape_app'");
      expect(rows).toEqual([{ rolpassword: verifier }]);
    } finally {
      await pg.close();
    }
  });
});

describe("nodeModulesProblems (W12-9)", () => {
  let n = 0;
  function repo(installed: Record<string, string>, extra: Record<string, unknown> = {}) {
    const dir = path.join(root, `repo-${n++}`);
    const packages: Record<string, unknown> = {
      "": { name: "fixture" },
      "node_modules/postgres": { version: "4.0.0" },
      "node_modules/@aws-sdk/client-rds": { version: "3.1.0" },
      "node_modules/@aws-sdk/client-rds/node_modules/tslib": { version: "2.0.0" },
      "node_modules/@esbuild/linux-x64": { version: "0.25.0", optional: true },
      ...extra,
    };
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
    for (const [key, version] of Object.entries(installed)) {
      mkdirSync(path.join(dir, key), { recursive: true });
      writeFileSync(path.join(dir, key, "package.json"), JSON.stringify({ version }));
    }
    mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
    return dir;
  }
  const exact = {
    "node_modules/postgres": "4.0.0",
    "node_modules/@aws-sdk/client-rds": "3.1.0",
    "node_modules/@aws-sdk/client-rds/node_modules/tslib": "2.0.0",
  };

  it("passes node_modules installed from the lockfile (an optional package for another platform may be absent)", () => {
    expect(nodeModulesProblems(repo(exact))).toEqual([]);
  });

  it("names a package at another version, a missing one, and one the lockfile doesn't list, nested ones included", () => {
    const dir = repo({
      "node_modules/postgres": "4.0.1",
      "node_modules/@aws-sdk/client-rds": "3.1.0",
      "node_modules/@aws-sdk/client-rds/node_modules/evil": "1.0.0",
      "node_modules/@vitest/coverage-v8": "5.0.0",
    });
    expect(nodeModulesProblems(dir).sort()).toEqual([
      "node_modules/@aws-sdk/client-rds/node_modules/evil isn't in the lockfile",
      "node_modules/@aws-sdk/client-rds/node_modules/tslib is missing",
      "node_modules/@vitest/coverage-v8 isn't in the lockfile",
      "node_modules/postgres is 4.0.1, the lockfile says 4.0.0",
    ]);
  });

  it("refuses a lockfile without a packages list", () => {
    const dir = repo(exact);
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 1, dependencies: {} }));
    expect(nodeModulesProblems(dir)).toEqual(["package-lock.json has no packages list (npm 7 or later writes one)"]);
  });
});

describe("vercelLinkProblems (W12-4)", () => {
  const jwt = (claims: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
  const link = JSON.stringify({ projectId: "prj_abc", orgId: "team_xyz", projectName: "shipshape" });
  const token = {
    iss: "https://oidc.vercel.com/example-team",
    sub: "owner:example-team:project:shipshape:environment:preview",
    owner_id: "team_xyz",
    project_id: "prj_abc",
    environment: "preview",
  };

  it("passes a link to launch.env's project whose preview token matches its ids", () => {
    expect(vercelLinkProblems(link, jwt(token), "example-team", "shipshape")).toEqual([]);
  });

  it("refuses a link to another project by name", () => {
    expect(vercelLinkProblems(JSON.stringify({ projectId: "prj_abc", orgId: "team_xyz", projectName: "other" }), jwt(token), "example-team", "shipshape")).toEqual([
      ".vercel/project.json names project other, not shipshape",
    ]);
  });

  it("refuses a same-named project in another team (the token's sub and iss name that team)", () => {
    const other = { ...token, iss: "https://oidc.vercel.com/other-team", sub: "owner:other-team:project:shipshape:environment:preview" };
    expect(vercelLinkProblems(link, jwt(other), "example-team", "shipshape")).toHaveLength(2);
  });

  it("refuses a token whose ids aren't the linked project's", () => {
    expect(vercelLinkProblems(link, jwt({ ...token, project_id: "prj_other" }), "example-team", "shipshape")).toEqual([
      "its project_id prj_other isn't project.json's projectId prj_abc",
    ]);
  });

  it("refuses a missing link file or a token that isn't a JWT", () => {
    expect(vercelLinkProblems("", jwt(token), "example-team", "shipshape")).toEqual([".vercel/project.json is missing or isn't JSON"]);
    expect(vercelLinkProblems(link, "not-a-jwt", "example-team", "shipshape")).toEqual(["the pulled preview token isn't a JWT"]);
  });
});

describe("keyPolicyProblems (W12-5)", () => {
  // infra/storage.yaml's key policy, as `aws kms get-key-policy --output json` prints it.
  const statement = { Sid: "AccountIamDecides", Effect: "Allow", Principal: { AWS: `arn:aws:iam::${account}:root` }, Action: "kms:*", Resource: "*" };
  const answer = (statements: unknown[], extra: object = {}) =>
    JSON.stringify({ Policy: JSON.stringify({ Version: "2012-10-17", Statement: statements, ...extra }), PolicyName: "default" });

  it("passes the template's one statement", () => {
    expect(keyPolicyProblems(answer([statement]), account)).toEqual([]);
  });

  it.each([
    ["a second statement to everyone", [statement, { ...statement, Sid: "Open", Principal: { AWS: "*" } }]],
    ["the root of another account", [{ ...statement, Principal: { AWS: "arn:aws:iam::444455556666:root" } }]],
    ["a service", [{ ...statement, Principal: { AWS: `arn:aws:iam::${account}:root`, Service: "logs.amazonaws.com" } }]],
    ["everyone", [{ ...statement, Principal: "*" }]],
    ["a role instead of the root", [{ ...statement, Principal: { AWS: `arn:aws:iam::${account}:role/x` } }]],
    ["a condition", [{ ...statement, Condition: { Bool: { "aws:SecureTransport": "true" } } }]],
    ["a narrower action", [{ ...statement, Action: "kms:Decrypt" }]],
  ])("fails %s", (_what, statements) => {
    expect(keyPolicyProblems(answer(statements), account).length).toBeGreaterThan(0);
  });

  it("fails output that isn't get-key-policy's JSON, so an aws error is never a pass", () => {
    expect(keyPolicyProblems("An error occurred (AccessDeniedException)", account)).toEqual(["aws didn't print get-key-policy's JSON (Policy)"]);
    expect(keyPolicyProblems(JSON.stringify({ PolicyName: "default" }), account)).toEqual(["aws didn't print get-key-policy's JSON (Policy)"]);
  });
});

describe("accountPabProblems (W12-5)", () => {
  const all = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };

  it("passes all four settings on", () => {
    expect(accountPabProblems(JSON.stringify({ PublicAccessBlockConfiguration: all }))).toEqual([]);
  });

  it("fails a setting off, a missing one, an extra field, or no JSON", () => {
    expect(accountPabProblems(JSON.stringify({ PublicAccessBlockConfiguration: { ...all, RestrictPublicBuckets: false } }))).toEqual(["RestrictPublicBuckets is false"]);
    expect(accountPabProblems(JSON.stringify({ PublicAccessBlockConfiguration: { ...all, BlockPublicPolicy: undefined } }))).toEqual(["BlockPublicPolicy is missing"]);
    expect(accountPabProblems(JSON.stringify({ PublicAccessBlockConfiguration: all, Extra: 1 }))).toEqual(["unexpected field Extra"]);
    expect(accountPabProblems("")).toHaveLength(1);
  });
});
