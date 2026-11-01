import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// infra/launch.sh, run for real against fixture settings in a temp dir. PATH holds only the system
// tools (no aws, no uvx), so nothing reaches AWS; the apply tests put fakes in front.
const repoRoot = path.join(import.meta.dirname, "..");
const script = path.join(repoRoot, "infra", "launch.sh");
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
function launch(settings: Record<string, string>, opts: { apply?: boolean; bin?: string; script?: string; env?: Record<string, string> } = {}) {
  const dir = path.join(root, `run-${runs++}`);
  mkdirSync(dir);
  const envFile = path.join(dir, "launch.env");
  writeFileSync(envFile, `# fixture\n${Object.entries(settings).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  const result = spawnSync("bash", opts.apply ? [opts.script ?? script] : [opts.script ?? script, "--dry-run"], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: [opts.bin, "/usr/bin", "/bin"].filter(Boolean).join(":"),
      HOME: dir,
      TMPDIR: dir,
      LAUNCH_ENV_FILE: envFile,
      LAUNCH_LOG_DIR: dir,
      ...(opts.apply ? { LAUNCH_APPLY: "1", PROBE_PREVIEW_OIDC_TOKEN: "preview-token-for-the-test" } : {}),
      ...opts.env,
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
    // Read back strictly (W12-5): the account's Block Public Access for the session's own account, and the key's policy.
    expect(out).toContain("aws s3control get-public-access-block --region us-east-1 --account-id <from aws sts get-caller-identity> --output json");
    expect(out).toContain("aws kms get-key-policy --region us-east-1 --key-id <from shipshape-storage output KeyArn> --policy-name default --output json");

    // Every value is either filled in or says where it comes from at apply time; secrets come from AWS.
    const placeholders = out.match(/<[^<>\n]*>/g) ?? [];
    expect(placeholders.length).toBeGreaterThan(0);
    for (const p of placeholders) expect(p).toMatch(/^<from [^<>]+>$/);
    expect(out).toContain("MIGRATE_DATABASE_URL=postgres://postgres:<from Secrets Manager>@");
    expect(out).not.toMatch(/\$[A-Za-z_{]/);

    expect(out).toContain("Skipped template validation");
    expect(out).toContain("Plan complete: nothing was changed.");
    expect(log).toBe(out);
    // The CA and then the new password are stored before anything that could still stop the run
    // (Security MUST-L2, W12-3).
    const stored = out.indexOf("DATABASE_CA_CERT (the checked bundle) and then DATABASE_URL (with the new password) are stored at once");
    const probe = out.indexOf("node scripts/probe-aws.mjs");
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(probe);
    // Unlinked, the printed commands add the CA before the URL, both as sensitive values.
    const caAdd = out.indexOf("$ vercel env add DATABASE_CA_CERT production --sensitive < ~/.shipshape-launch/rds-ca.pem");
    expect(caAdd).toBeGreaterThan(0);
    expect(caAdd).toBeLessThan(out.indexOf("$ vercel env add DATABASE_URL production --sensitive < ~/.shipshape-launch/DATABASE_URL"));
    // Step 8 names the app's own secrets and never makes one (W12-2).
    expect(out).toContain("The app's own secrets: this script never makes or prints them. Add each yourself, Production only:");
    for (const line of [
      "SHIPSHAPE_SESSION_SECRET (at least 32 characters)",
      "SHIPSHAPE_HASH_KEY (at least 32 characters)",
      "SHIPSHAPE_FIELD_KEY (32 random bytes, base64)",
      "CRON_SECRET (at least 32 characters)",
      "CONTACT_EMAIL (when real documents are on)",
    ])
      expect(out).toContain(`\n    ${line}\n`);
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

  // A copy of what launch.sh needs from the repo, so an apply run can go all the way: its own lockfile
  // and node_modules (committed on a date the test picks), scripts/launch-checks.ts, and optionally a
  // Vercel link. The real RDS bundle needs the network, so the copy pins a fixture bundle's sha256.
  const fixtureCa = "-----BEGIN CERTIFICATE-----\nfixture RDS bundle\n-----END CERTIFICATE-----\n";
  const goodLink = { projectId: "prj_abc", orgId: "team_xyz", projectName: "shipshape" };
  const jwt = (claims: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
  const goodToken = {
    iss: "https://oidc.vercel.com/example-team",
    sub: "owner:example-team:project:shipshape:environment:preview",
    aud: "https://vercel.com/example-team",
    owner_id: "team_xyz",
    project_id: "prj_abc",
    environment: "preview",
  };
  // infra/storage.yaml's key policy and step 0's settings, as aws prints them with --output json.
  const templateKeyPolicy = {
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Sid: "AccountIamDecides", Effect: "Allow", Principal: { AWS: "arn:aws:iam::111122223333:root" }, Action: "kms:*", Resource: "*" }],
    }),
    PolicyName: "default",
  };
  const allOn = { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
  const outputs = [
    ["BucketName", "shipshape-files-111122223333"],
    ["KeyArn", "arn:aws:kms:us-east-1:111122223333:key/k"],
    ["UserPoolId", "us-east-1_pool"],
    ["UserPoolArn", "arn:aws:cognito-idp:us-east-1:111122223333:userpool/us-east-1_pool"],
    ["ClientId", "client123"],
    ["Domain", "https://shipshape-signin.auth.us-east-1.amazoncognito.com"],
    ["RoleArn", "arn:aws:iam::111122223333:role/shipshape-prod-app"],
    ["RoleName", "shipshape-prod-app"],
    ["OidcProviderArn", "arn:aws:iam::111122223333:oidc-provider/oidc.vercel.com/example-team"],
    ["Endpoint", "db.example.us-east-1.rds.amazonaws.com"],
    ["InstanceIdentifier", "shipshape-prod"],
    ["MasterSecretArn", "arn:aws:secretsmanager:us-east-1:111122223333:secret:rds-x"],
  ];

  let fixtures = 0;
  function fixture(
    opts: {
      lockAgeDays?: number;
      link?: object | null;
      token?: object;
      postgresVersion?: string;
      keyPolicy?: object;
      pab?: object;
      aws?: string[];
      loginFails?: boolean;
      // committed (the default); modified after its commit; or never committed (another file is).
      lockState?: "committed" | "modified" | "untracked";
    } = {},
  ) {
    const repo = path.join(root, `repo-${fixtures++}`);
    const bin = path.join(repo, "fake-bin");
    const calls = path.join(bin, "calls");
    for (const d of ["infra", "scripts", "node_modules/postgres", "node_modules/@aws-sdk/client-rds", "fake-bin"]) mkdirSync(path.join(repo, d), { recursive: true });
    const original = readFileSync(script, "utf8");
    const pinned = original.replace(/RDS_CA_SHA256="[0-9a-f]{64}"/, `RDS_CA_SHA256="${createHash("sha256").update(fixtureCa).digest("hex")}"`);
    expect(pinned).not.toBe(original);
    writeFileSync(path.join(repo, "infra", "launch.sh"), pinned);
    for (const f of ["launch-checks.ts", "probe-aws-rules.ts"]) writeFileSync(path.join(repo, "scripts", f), readFileSync(path.join(repoRoot, "scripts", f)));
    writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
    const packages = { "": { name: "fixture" }, "node_modules/postgres": { version: "4.0.0" }, "node_modules/@aws-sdk/client-rds": { version: "3.1.0" } };
    writeFileSync(path.join(repo, "package-lock.json"), JSON.stringify({ name: "fixture", lockfileVersion: 3, packages }));
    writeFileSync(path.join(repo, "node_modules/postgres/package.json"), JSON.stringify({ version: opts.postgresVersion ?? "4.0.0" }));
    writeFileSync(path.join(repo, "node_modules/@aws-sdk/client-rds/package.json"), JSON.stringify({ version: "3.1.0" }));
    if (opts.link !== null) {
      mkdirSync(path.join(repo, ".vercel"));
      writeFileSync(path.join(repo, ".vercel", "project.json"), JSON.stringify(opts.link ?? goodLink));
    }
    const when = `@${Math.floor(Date.now() / 1000) - (opts.lockAgeDays ?? 30) * 86400} +0000`;
    const tracked = opts.lockState === "untracked" ? "package.json" : "package-lock.json";
    for (const args of [["init", "-q"], ["add", tracked], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "lock"]]) {
      const result = spawnSync("git", args, {
        cwd: repo,
        env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", HOME: repo, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
      expect(result.status).toBe(0);
    }
    if (opts.lockState === "modified") writeFileSync(path.join(repo, "package-lock.json"), JSON.stringify({ name: "fixture", lockfileVersion: 3, packages, edited: true }));

    writeFileSync(path.join(bin, "outputs.txt"), outputs.map(([k, v]) => `${k}\t${v}`).join("\n") + "\n");
    writeFileSync(path.join(bin, "key-policy.json"), JSON.stringify(opts.keyPolicy ?? templateKeyPolicy));
    writeFileSync(path.join(bin, "pab.json"), JSON.stringify(opts.pab ?? allOn));
    writeFileSync(path.join(bin, "ca.pem"), fixtureCa);
    const fake = (name: string, body: string) => {
      writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(path.join(bin, name), 0o755);
    };
    // Every fake writes what it was asked into one file, so the test sees the order across tools.
    fake(
      "aws",
      `echo "aws $*" >> '${calls}'
case "$*" in
${(opts.aws ?? []).join("\n")}
  *get-caller-identity*) printf '111122223333\\tarn:aws:sts::111122223333:assumed-role/AWSReservedSSO_AdministratorAccess_0123456789abcdef/someone\\n' ;;
  *StackStatus*) echo "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id x does not exist" >&2; exit 254 ;;
  *OutputKey,OutputValue*) cat '${bin}/outputs.txt' ;;
  *describe-user-pool-client*) echo client-secret-for-the-test ;;
  *MasterSecretArn*) echo arn:aws:secretsmanager:us-east-1:111122223333:secret:rds-x ;;
  *UserPoolId*) echo us-east-1_pool ;;
  *ClientId*) echo client123 ;;
  *get-secret-value*) printf '%s' '{"username":"postgres","password":"master-pw-for-the-test"}' ;;
  *describe-db-engine-versions*) echo 17.6 ;;
  *describe-vpcs*) echo vpc-1 ;;
  *describe-subnets*) printf 'us-east-1a\\tsubnet-a\\nus-east-1b\\tsubnet-b\\n' ;;
  *get-key-policy*) cat '${bin}/key-policy.json' ;;
  *get-public-access-block*) cat '${bin}/pab.json' ;;
esac`,
    );
    fake(
      "vercel",
      `echo "vercel $*" >> '${calls}'
case "$1 $2" in
  "env pull") printf 'VERCEL_OIDC_TOKEN="%s"\\n' '${jwt(opts.token ?? goodToken)}' > "$5" ;;
  "env add") if [ "$3" = DATABASE_CA_CERT ]; then cat > '${bin}/ca-sent.pem'; else cat > /dev/null; fi ;;
esac`,
    );
    fake("curl", `echo "curl $*" >> '${calls}'\ncp '${bin}/ca.pem' "$4"`);
    // node runs for real, except what needs a database or AWS: the migrations, the probe and the two inline scripts.
    fake(
      "node",
      `case "$1" in
  scripts/migrate.ts) echo "node migrate" >> '${calls}'; echo "Roles OK"; exit 0 ;;
  scripts/probe-aws.mjs) echo "node probe" >> '${calls}'; echo "PASS (fake probe)"; exit 0 ;;
  --input-type=module)
    s="$(cat)"
    case "$s" in
      *"set_config('shipshape.app_verifier', \\\${scramVerifier(process.env.APP_DB_PASSWORD"*) echo "node set-password with a SCRAM verifier" >> '${calls}' ;;
      *set_config*) echo "node set-password" >> '${calls}' ;;
      *current_user*) echo "node login-check" >> '${calls}'; ${opts.loginFails ? `echo "FAIL: shipshape_app can't log in with its new password: password authentication failed" >&2; exit 1` : ":"} ;;
    esac
    exit 0 ;;
esac
exec '${process.execPath}' "$@"`,
    );
    return { script: path.join(repo, "infra", "launch.sh"), bin, calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []), repo };
  }
  const at = (lines: string[], prefix: string) => lines.findIndex((l) => l.startsWith(prefix));

  it("runs every step with the CA stored before DATABASE_URL, a SCRAM verifier, a login check, and the key and account read back (W12-3, W12-5, W12-10, W12-18)", () => {
    const f = fixture();
    const { status, out, dir } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(out).toContain("Done: the AWS side of M6 is up, and the probe passed.");
    expect(status).toBe(0);
    const calls = f.calls();
    const order = [
      "node set-password with a SCRAM verifier",
      "vercel env add DATABASE_CA_CERT production --sensitive",
      "vercel env add DATABASE_URL production --sensitive",
      "node login-check",
      "node probe",
    ].map((p) => at(calls, p));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The roles check runs after the login check; the CA goes in once, and it is the checked bundle.
    expect(calls.lastIndexOf("node migrate")).toBeGreaterThan(at(calls, "node login-check"));
    expect(calls.filter((c) => c.startsWith("vercel env add DATABASE_CA_CERT"))).toHaveLength(1);
    expect(readFileSync(path.join(f.bin, "ca-sent.pem"), "utf8")).toBe(fixtureCa.trimEnd());
    expect(calls).toContain("vercel env add COGNITO_CLIENT_SECRET production --sensitive");
    expect(existsSync(path.join(dir, ".shipshape-launch", "DATABASE_URL"))).toBe(false);
    // Read back: the account Block Public Access for the signed-in account, and the key's policy.
    expect(calls).toContain("aws s3control get-public-access-block --region us-east-1 --account-id 111122223333 --output json");
    expect(calls).toContain("aws kms get-key-policy --region us-east-1 --key-id arn:aws:kms:us-east-1:111122223333:key/k --policy-name default --output json");
    expect(out).toContain("\nPASS account Block Public Access: all four settings on\n");
    expect(out).toContain("\nPASS the file key's policy is the one storage.yaml writes: the account root, kms:*, on *\n");
    expect(out).toContain("\nPASS node_modules matches package-lock.json\n");
    expect(out).toContain("\nPASS the linked Vercel project is shipshape in example-team\n");
    expect(out).toContain("package-lock.json was last committed at least 7 days ago.");
    // What passing /api/health looks like, and the audit items these templates leave to the operator.
    expect(out).toContain('It passes with 200 and "ok": true, "db": "up", "config": "ok". A 503 with "config": "missing" means a');
    expect(out).toContain("CloudTrail in all regions, into a separate");
    expect(out).toContain("GuardDuty RDS Protection");
    expect(out).toContain("Secret check: the log holds none of these:");
  });

  it("stops when the new password doesn't log in as shipshape_app, after storing it (Security W12-10, MUST-L2)", () => {
    const f = fixture({ loginFails: true });
    const { status, out } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(status).toBe(1);
    expect(out).toContain("Stopped: shipshape_app's new password doesn't log in (the FAIL line above says why).");
    expect(out).toContain("Fix: Rerun with LAUNCH_ROTATE_APP_PASSWORD=1");
    const calls = f.calls();
    expect(at(calls, "vercel env add DATABASE_URL production --sensitive")).toBeLessThan(at(calls, "node login-check"));
    expect(calls).not.toContain("node probe");
  });

  it("fails the run when describe-stacks fails for a reason other than \"does not exist\", before deploying (W12-16)", () => {
    const f = fixture({
      aws: [`  *StackStatus*) echo "An error occurred (ExpiredTokenException) when calling the DescribeStacks operation: The security token included in the request is expired" >&2; exit 255 ;;`],
    });
    const { status, out } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(status).toBe(1);
    expect(out).toContain("Stopped: Couldn't read shipshape-storage's state: An error occurred (ExpiredTokenException)");
    expect(f.calls().some((c) => c.includes("cloudformation deploy"))).toBe(false);
  });

  it.each([
    ["a second statement to everyone", { keyPolicy: { Policy: JSON.stringify({ Version: "2012-10-17", Statement: [...JSON.parse(templateKeyPolicy.Policy).Statement, { Sid: "Open", Effect: "Allow", Principal: { AWS: "*" }, Action: "kms:Decrypt", Resource: "*" }] }) } }, "FAIL the file key's policy is the one storage.yaml writes", "Stopped: The file key's policy isn't the one statement infra/storage.yaml writes"],
    ["a CLI error for the key policy", { aws: [`  *get-key-policy*) echo "An error occurred (AccessDeniedException)" >&2; exit 254 ;;`] }, "FAIL the file key's policy is the one storage.yaml writes: aws couldn't read it: An error occurred (AccessDeniedException)", "Stopped: The file key's policy couldn't be read."],
    ["one Block Public Access setting off", { pab: { PublicAccessBlockConfiguration: { ...allOn.PublicAccessBlockConfiguration, RestrictPublicBuckets: false } } }, "FAIL account Block Public Access: all four settings on: RestrictPublicBuckets is false", "Stopped: The account's Block Public Access isn't all four settings on"],
    ["a CLI error for Block Public Access", { aws: [`  *get-public-access-block*) echo "An error occurred (NoSuchPublicAccessBlockConfiguration)" >&2; exit 254 ;;`] }, "FAIL account Block Public Access: all four settings on: aws couldn't read it", "Stopped: The account's Block Public Access couldn't be read back."],
  ])("fails the run on %s, before any password is set (W12-5)", (_what, opts, failLine, stopped) => {
    const f = fixture(opts);
    const { status, out } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(status).toBe(1);
    expect(out).toContain(failLine);
    expect(out).toContain(stopped);
    expect(f.calls().some((c) => c.startsWith("node set-password"))).toBe(false);
  });

  it("refuses a lockfile committed under 7 days ago before changing anything, and goes ahead with the override, which the log records (W12-9)", () => {
    const young = fixture({ lockAgeDays: 2 });
    const refused = launch(complete, { apply: true, bin: young.bin, script: young.script });
    expect(refused.status).toBe(1);
    expect(refused.out).toContain("Stopped: package-lock.json was last committed 2 days ago, under the 7 days aws-plan PR-4 asks for.");
    expect(refused.out).toContain("rerun with LAUNCH_ALLOW_YOUNG_LOCKFILE=1 (the log records it)");
    expect(young.calls().some((c) => c.includes("put-public-access-block"))).toBe(false);

    const allowed = launch(complete, { apply: true, bin: young.bin, script: young.script, env: { LAUNCH_ALLOW_YOUNG_LOCKFILE: "1" } });
    expect(allowed.status).toBe(0);
    expect(allowed.log).toContain("  LAUNCH_ALLOW_YOUNG_LOCKFILE=1: package-lock.json was last committed 2 days ago, under the 7 days aws-plan PR-4 asks for. Going ahead as you asked.");
  });

  it.each<[string, "modified" | "untracked", string]>([
    ["has an uncommitted change", "modified", "Stopped: package-lock.json has changes that aren't committed (or this isn't a git checkout)."],
    ["was never committed", "untracked", "Stopped: package-lock.json isn't in any commit here."],
  ])("refuses a lockfile that %s, however old the repo, before changing anything (W12-9)", (_what, lockState, stopped) => {
    const f = fixture({ lockState });
    const { status, out } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(status).toBe(1);
    expect(out).toContain(stopped);
    expect(f.calls().some((c) => c.includes("put-public-access-block") || c.includes("cloudformation deploy") || c.startsWith("vercel env add"))).toBe(false);
  });

  it("refuses node_modules that don't match the lockfile before changing anything (W12-9)", () => {
    const f = fixture({ postgresVersion: "4.0.1" });
    const { status, out } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(status).toBe(1);
    expect(out).toContain("FAIL node_modules matches package-lock.json: node_modules/postgres is 4.0.1, the lockfile says 4.0.0");
    expect(out).toContain("Stopped: node_modules doesn't match package-lock.json");
    expect(f.calls().some((c) => c.includes("put-public-access-block"))).toBe(false);
  });

  it.each([
    ["another project", { link: { ...goodLink, projectName: "other" } }, ".vercel/project.json names project other, not shipshape"],
    [
      "a same-named project in another team",
      { token: { ...goodToken, iss: "https://oidc.vercel.com/other-team", sub: "owner:other-team:project:shipshape:environment:preview" } },
      "the linked project's preview token has sub owner:other-team:project:shipshape:environment:preview",
    ],
  ])("refuses a folder linked to %s before writing anything to Vercel or AWS (W12-4)", (_what, opts, problem) => {
    const f = fixture(opts);
    const { status, out } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(status).toBe(1);
    expect(out).toContain(`FAIL the linked Vercel project is shipshape in example-team: ${problem}`);
    expect(out).toContain("Stopped: This folder's Vercel link isn't shipshape in example-team");
    expect(f.calls().some((c) => c.startsWith("vercel env add") || c.includes("put-public-access-block"))).toBe(false);
  });

  // The guard is a security control: a planted master password, plain or URL-encoded (the form the
  // connection string carries), must stop the run with exit 1 (Security SHOULD-L3, L5).
  it.each([
    ["plain", "PLANTED#sec%PW/12x", "the master password"],
    ["URL-encoded", "PLANTED%23sec%25PW%2F12x", "the master password (URL-encoded)"],
  ])("fails the run when the log holds the %s master password", (_form, planted, named) => {
    const f = fixture({
      link: null,
      aws: [
        `  *get-secret-value*) printf '%s' '{"username":"postgres","password":"PLANTED#sec%PW/12x"}' ;;`,
        // A tool that echoes what it was given: the leak the guard exists to catch.
        `  *put-public-access-block*) printf '%s\\n' 'leak: ${planted}' ;;`,
      ],
    });
    const { status, out } = launch(complete, { apply: true, bin: f.bin, script: f.script });
    expect(status).toBe(1);
    expect(out).toContain(`Stopped: the log contains ${named}.`);
  });
});
