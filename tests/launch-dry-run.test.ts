import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// infra/launch.sh, run for real against fixture settings in a temp dir. PATH holds only the system
// tools (no aws, no uvx), so nothing reaches AWS; the apply test puts a stub aws in front.
const script = path.join(import.meta.dirname, "..", "infra", "launch.sh");
const root = mkdtempSync(path.join(os.tmpdir(), "launch-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const complete: Record<string, string> = {
  AWS_PROFILE: "shipshape-admin",
  ACCOUNT_ID: "111122223333",
  AWS_REGION: "us-east-1",
  APP_URL: "https://app.example.com",
  VERCEL_TEAM: "example-team",
  VERCEL_PROJECT: "shipshape",
  COGNITO_DOMAIN_PREFIX: "shipshape-signin",
  ALERT_EMAIL: "owner@example.com",
};

let runs = 0;
function launch(settings: Record<string, string>, opts: { apply?: boolean; bin?: string } = {}) {
  const dir = path.join(root, `run-${runs++}`);
  mkdirSync(dir);
  const envFile = path.join(dir, "launch.env");
  writeFileSync(envFile, `# fixture\n${Object.entries(settings).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  const result = spawnSync("bash", opts.apply ? [script] : [script, "--dry-run"], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: [opts.bin, "/usr/bin", "/bin"].filter(Boolean).join(":"),
      HOME: dir,
      TMPDIR: dir,
      LAUNCH_ENV_FILE: envFile,
      LAUNCH_LOG_DIR: dir,
      ...(opts.apply ? { LAUNCH_APPLY: "1", PROBE_PREVIEW_OIDC_TOKEN: "preview-token-for-the-test" } : {}),
    },
  });
  const logName = readdirSync(dir).find((f) => /^launch-\d{8}T\d{6}Z\.log$/.test(f));
  return { dir, status: result.status, out: result.stdout + result.stderr, log: logName ? readFileSync(path.join(dir, logName), "utf8") : "" };
}

describe("infra/launch.sh --dry-run", () => {
  it("prints the 5 stacks in the README's order with every parameter resolved, and exits 0", () => {
    const { status, out, log } = launch(complete);
    expect(status).toBe(0);

    const deploys = out.split("\n").filter((l) => l.includes("aws cloudformation deploy"));
    expect(deploys.map((l) => /--stack-name (\S+)/.exec(l)?.[1])).toEqual([
      "shipshape-storage",
      "shipshape-signin",
      "shipshape-app-role",
      "shipshape-database",
      "shipshape-budgets",
    ]);
    for (const l of deploys) expect(l).toContain("--region us-east-1");
    for (const l of deploys) expect(l).toContain("--no-fail-on-empty-changeset");
    expect(deploys[0]).toContain("--template-file infra/storage.yaml --no-fail-on-empty-changeset --parameter-overrides BucketName=shipshape-files-111122223333");
    expect(deploys[1]).toContain("--parameter-overrides AppUrl=https://app.example.com DomainPrefix=shipshape-signin");
    expect(deploys[2]).toContain(
      "--capabilities CAPABILITY_NAMED_IAM --parameter-overrides VercelTeam=example-team Audience=https://vercel.com/example-team " +
        "ProductionSub=owner:example-team:project:shipshape:environment:production " +
        "BucketName=<from shipshape-storage output BucketName> FileKeyArn=<from shipshape-storage output KeyArn> " +
        "UserPoolArn=<from shipshape-signin output UserPoolArn>",
    );
    expect(deploys[3]).toContain("FileKeyArn=<from shipshape-storage output KeyArn> VpcId=<from aws ec2 describe-vpcs>");
    expect(deploys[4]).toContain("--parameter-overrides AlertEmail=owner@example.com");
    expect(out).toContain("aws s3control put-public-access-block --region us-east-1 --account-id 111122223333 ");

    // Every value is either filled in or says where it comes from at apply time; secrets come from AWS.
    const placeholders = out.match(/<[^<>\n]*>/g) ?? [];
    expect(placeholders.length).toBeGreaterThan(0);
    for (const p of placeholders) expect(p).toMatch(/^<from [^<>]+>$/);
    expect(out).toContain("MIGRATE_DATABASE_URL=postgres://postgres:<from Secrets Manager>@");
    expect(out).not.toMatch(/\$[A-Za-z_{]/);

    expect(out).toContain("Skipped template validation");
    expect(out).toContain("Plan complete: nothing was changed.");
    expect(log).toBe(out);
    // The new password is stored before anything that could still stop the run (Security MUST-L2).
    const stored = out.indexOf("DATABASE_URL (with the new password) is stored at once");
    const probe = out.indexOf("node scripts/probe-aws.mjs");
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(probe);
  });

  it.each([
    ["ALERT_EMAIL", { ALERT_EMAIL: undefined }, "launch.env: ALERT_EMAIL is missing. Add ALERT_EMAIL="],
    ["VERCEL_TEAM", { VERCEL_TEAM: "" }, "launch.env: VERCEL_TEAM is missing. Add VERCEL_TEAM="],
    ["ACCOUNT_ID", { ACCOUNT_ID: "11112222333" }, "launch.env: ACCOUNT_ID=11112222333 isn't valid. It should be your 12-digit AWS account id."],
    ["APP_URL", { APP_URL: "http://app.example.com" }, "launch.env: APP_URL=http://app.example.com isn't valid."],
    ["AWS_REGION", { AWS_REGION: "eu-west-1" }, "launch.env: AWS_REGION=eu-west-1 isn't supported. Set AWS_REGION=us-east-1"],
  ])("exits 2 naming %s when it is missing or invalid, before any plan", (_key, change, message) => {
    const settings = Object.fromEntries(
      Object.entries({ ...complete, ...change }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const { status, out } = launch(settings);
    expect(status).toBe(2);
    expect(out).toContain(message);
    expect(out).not.toContain("aws cloudformation deploy");
  });
});

describe("LAUNCH_APPLY=1 infra/launch.sh", () => {
  it("refuses root credentials before changing anything", () => {
    const bin = path.join(root, "stub-bin");
    mkdirSync(bin, { recursive: true });
    const calls = path.join(root, "stub-calls");
    writeFileSync(
      path.join(bin, "aws"),
      `#!/bin/sh\necho "$*" >> '${calls}'\ncase "$*" in *get-caller-identity*) printf '111122223333\\tarn:aws:iam::111122223333:root\\n' ;; esac\n`,
    );
    chmodSync(path.join(bin, "aws"), 0o755);
    const { status, out } = launch(complete, { apply: true, bin });
    expect(status).toBe(1);
    expect(out).toContain("Stopped: These are the root user's credentials, and the launch never runs as root.");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["sts get-caller-identity --query [Account,Arn] --output text"]);
  });

  // A fake aws on PATH that answers only what the test needs; everything else succeeds silently.
  function fakeAws(name: string, body: string) {
    const bin = path.join(root, `stub-${name}`);
    mkdirSync(bin, { recursive: true });
    const calls = path.join(bin, "calls");
    writeFileSync(path.join(bin, "aws"), `#!/bin/sh\necho "$*" >> '${calls}'\ncase "$*" in\n${body}\nesac\n`);
    chmodSync(path.join(bin, "aws"), 0o755);
    return { bin, calls };
  }

  it("refuses credentials that aren't an Identity Center session (an IAM user's keys) before changing anything (Security MUST-L1)", () => {
    const { bin, calls } = fakeAws("iam-user", `*get-caller-identity*) printf '111122223333\\tarn:aws:iam::111122223333:user/someone\\n' ;;`);
    const { status, out } = launch(complete, { apply: true, bin });
    expect(status).toBe(1);
    expect(out).toContain("Stopped: These credentials aren't an Identity Center session for account 111122223333");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["sts get-caller-identity --query [Account,Arn] --output text"]);
  });

  // The guard is a security control: a planted master password, plain or URL-encoded (the form the
  // connection string carries), must stop the run with exit 1 (Security SHOULD-L3, L5).
  it.each([
    ["plain", "PLANTED#sec%PW/12x", "the master password"],
    ["URL-encoded", "PLANTED%23sec%25PW%2F12x", "the master password (URL-encoded)"],
  ])("fails the run when the log holds the %s master password", (_form, planted, named) => {
    const { bin } = fakeAws(
      `guard-${_form}`,
      [
        `*get-caller-identity*) printf '111122223333\\tarn:aws:sts::111122223333:assumed-role/AWSReservedSSO_AdministratorAccess_0123456789abcdef/someone\\n' ;;`,
        `*get-secret-value*) printf '%s' '{"username":"postgres","password":"PLANTED#sec%PW/12x"}' ;;`,
        `*MasterSecretArn*) printf '%s\\n' 'arn:aws:secretsmanager:us-east-1:111122223333:secret:rds-x' ;;`,
        `*UserPoolId*|*ClientId*) printf 'None\\n' ;;`,
        // A tool that echoes what it was given: the leak the guard exists to catch.
        `*put-public-access-block*) printf '%s\\n' 'leak: ${planted}' ;;`,
      ].join("\n"),
    );
    const { status, out } = launch(complete, { apply: true, bin: `${bin}:${path.dirname(process.execPath)}` });
    expect(status).toBe(1);
    expect(out).toContain(`Stopped: the log contains ${named}.`);
  });
});
