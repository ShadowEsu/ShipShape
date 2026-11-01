// Checks infra/launch.sh runs with node: shipshape_app's SCRAM verifier (W12-10), node_modules against
// package-lock.json (W12-9), the linked Vercel project against launch.env (W12-4), and the file key's
// policy and the account's Block Public Access as `aws ... --output json` prints them (W12-5).
// Node built-ins only: launch.sh runs it before it knows node_modules matches the lockfile.
// Secrets come in on stdin, never as arguments (ps shows arguments).
//
//   node scripts/launch-checks.ts node-modules <repo root>
//   node scripts/launch-checks.ts vercel-link <.vercel/project.json> <team> <project>   (the preview token on stdin)
//   node scripts/launch-checks.ts key-policy <account id>                               (get-key-policy's JSON on stdin)
//   node scripts/launch-checks.ts account-pab                                           (get-public-access-block's JSON on stdin)
//
// Each prints PASS or FAIL lines like the probe's and exits 1 on a FAIL.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isRecord, list, same, tokenClaims } from "./probe-aws-rules.ts";

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802, 7677): with it, ALTER ROLE
 * never carries the password itself, so no server log can hold it. Postgres also SASLprep-normalises
 * passwords; launch.sh's are ASCII letters and digits, which that leaves as they are.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * How node_modules differs from package-lock.json: a locked package missing (optional ones may be,
 * on another platform) or at another version, or a package the lockfile doesn't name.
 */
export function nodeModulesProblems(root: string): string[] {
  const lock = parseJson(existsSync(path.join(root, "package-lock.json")) ? readFileSync(path.join(root, "package-lock.json"), "utf8") : "");
  const packages = isRecord(lock) && isRecord(lock.packages) ? lock.packages : null;
  if (!packages) return ["package-lock.json has no packages list (npm 7 or later writes one)"];
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.startsWith("node_modules/") && !key.includes("/node_modules/")) continue;
    if (!isRecord(entry)) continue;
    const dir = path.join(root, key);
    if (!existsSync(dir)) {
      if (entry.optional !== true && entry.devOptional !== true) problems.push(`${key} is missing`);
      continue;
    }
    // A workspace link points at a folder of the repo, which has no version of its own to compare.
    if (entry.link === true) continue;
    const installed = parseJson(existsSync(path.join(dir, "package.json")) ? readFileSync(path.join(dir, "package.json"), "utf8") : "");
    const version = isRecord(installed) ? installed.version : undefined;
    if (version !== entry.version) problems.push(`${key} is ${String(version ?? "unreadable")}, the lockfile says ${String(entry.version)}`);
  }
  const walk = (modules: string) => {
    if (!existsSync(modules)) return;
    for (const d of readdirSync(modules, { withFileTypes: true })) {
      // .bin, .package-lock.json and tools' caches (.vite, .cache) aren't packages.
      if (d.name.startsWith(".") || !(d.isDirectory() || d.isSymbolicLink())) continue;
      const names = d.name.startsWith("@") ? readdirSync(path.join(modules, d.name)).map((n) => `${d.name}/${n}`) : [d.name];
      for (const name of names) {
        const dir = path.join(modules, name);
        const key = path.relative(root, dir).split(path.sep).join("/");
        if (!(key in packages)) problems.push(`${key} isn't in the lockfile`);
        else walk(path.join(dir, "node_modules"));
      }
    }
  };
  walk(path.join(root, "node_modules"));
  return problems;
}

/**
 * Why the folder's Vercel link isn't VERCEL_PROJECT in VERCEL_TEAM (empty: it is). project.json holds
 * ids and a project name; launch.env holds the team slug and the project name. The preview token
 * pulled through that link carries both: its sub names the team slug and project, and its owner_id
 * and project_id must be project.json's orgId and projectId.
 */
export function vercelLinkProblems(projectJson: string, token: string, team: string, project: string): string[] {
  const link = parseJson(projectJson);
  if (!isRecord(link)) return [".vercel/project.json is missing or isn't JSON"];
  const problems: string[] = [];
  if (typeof link.projectId !== "string" || typeof link.orgId !== "string") problems.push(".vercel/project.json has no projectId and orgId");
  if (link.projectName !== project) problems.push(`.vercel/project.json names project ${String(link.projectName)}, not ${project}`);
  const claims = tokenClaims(token);
  if (!claims) return [...problems, "the pulled preview token isn't a JWT"];
  const sub = `owner:${team}:project:${project}:environment:preview`;
  if (claims.sub !== sub) problems.push(`the linked project's preview token has sub ${String(claims.sub)}, not ${sub}`);
  if (claims.iss !== `https://oidc.vercel.com/${team}`) problems.push(`its iss is ${String(claims.iss)}, not https://oidc.vercel.com/${team}`);
  if (claims.owner_id !== link.orgId) problems.push(`its owner_id ${String(claims.owner_id)} isn't project.json's orgId ${String(link.orgId)}`);
  if (claims.project_id !== link.projectId) problems.push(`its project_id ${String(claims.project_id)} isn't project.json's projectId ${String(link.projectId)}`);
  return problems;
}

/**
 * Why the file key's policy isn't exactly the one statement infra/storage.yaml writes: the account
 * root, kms:*, on * (empty: it is). Anything else, a grant to "*", another account or a service
 * included, is a problem; so is output that isn't get-key-policy's JSON.
 */
export function keyPolicyProblems(output: string, account: string): string[] {
  if (!/^\d{12}$/.test(account)) return [`${account} isn't a 12-digit account id`];
  const answer = parseJson(output);
  if (!isRecord(answer) || typeof answer.Policy !== "string") return ["aws didn't print get-key-policy's JSON (Policy)"];
  const problems: string[] = [];
  const extra = Object.keys(answer).filter((k) => k !== "Policy" && k !== "PolicyName");
  if (extra.length) problems.push(`unexpected fields ${extra.join(", ")}`);
  if (answer.PolicyName !== undefined && answer.PolicyName !== "default") problems.push(`policy ${String(answer.PolicyName)}, not default`);
  const policy = parseJson(answer.Policy);
  if (!isRecord(policy)) return [...problems, "the policy isn't JSON"];
  if (!same(Object.keys(policy), ["Version", "Statement"])) problems.push(`policy fields ${Object.keys(policy).join(", ")}, not Version and Statement`);
  if (policy.Version !== "2012-10-17") problems.push(`Version ${String(policy.Version)}`);
  const statements = list(policy.Statement);
  if (statements.length !== 1) return [...problems, `${statements.length} statements, not 1: ${JSON.stringify(policy.Statement)}`];
  const [s] = statements;
  if (!isRecord(s)) return [...problems, "the statement isn't an object"];
  if (!same(Object.keys(s), ["Sid", "Effect", "Principal", "Action", "Resource"])) problems.push(`statement fields ${Object.keys(s).join(", ")}`);
  if (s.Sid !== "AccountIamDecides") problems.push(`Sid ${String(s.Sid)}`);
  if (s.Effect !== "Allow") problems.push(`Effect ${String(s.Effect)}`);
  const root = `arn:aws:iam::${account}:root`;
  if (!isRecord(s.Principal) || !same(Object.keys(s.Principal), ["AWS"]) || !same(s.Principal.AWS, [root])) problems.push(`Principal ${JSON.stringify(s.Principal)}, not ${root} alone`);
  if (!same(s.Action, ["kms:*"])) problems.push(`Action ${JSON.stringify(s.Action)}`);
  if (!same(s.Resource, ["*"])) problems.push(`Resource ${JSON.stringify(s.Resource)}`);
  return problems;
}

const PAB_SETTINGS = ["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"];
/** Why the account's Block Public Access isn't all four settings on and nothing else (empty: it is). */
export function accountPabProblems(output: string): string[] {
  const answer = parseJson(output);
  if (!isRecord(answer) || !isRecord(answer.PublicAccessBlockConfiguration)) return ["aws didn't print get-public-access-block's JSON (PublicAccessBlockConfiguration)"];
  const config = answer.PublicAccessBlockConfiguration;
  const problems = Object.keys(answer)
    .filter((k) => k !== "PublicAccessBlockConfiguration")
    .map((k) => `unexpected field ${k}`);
  for (const k of PAB_SETTINGS) if (config[k] !== true) problems.push(`${k} is ${config[k] === undefined ? "missing" : JSON.stringify(config[k])}`);
  for (const k of Object.keys(config)) if (!PAB_SETTINGS.includes(k)) problems.push(`unexpected setting ${k}`);
  return problems;
}

function report(name: string, problems: string[]): number {
  if (!problems.length) {
    console.log(`PASS ${name}`);
    return 0;
  }
  const shown = problems.slice(0, 20).join("; ");
  console.log(`FAIL ${name}: ${shown}${problems.length > 20 ? `; and ${problems.length - 20} more` : ""}`);
  return 1;
}

function main(args: string[]): number {
  const [command, ...rest] = args;
  const stdin = () => readFileSync(0, "utf8");
  if (command === "node-modules" && rest.length === 1) return report("node_modules matches package-lock.json", nodeModulesProblems(rest[0]));
  if (command === "vercel-link" && rest.length === 3) {
    const [file, team, project] = rest;
    const projectJson = existsSync(file) ? readFileSync(file, "utf8") : "";
    return report(`the linked Vercel project is ${project} in ${team}`, vercelLinkProblems(projectJson, stdin().trim(), team, project));
  }
  if (command === "key-policy" && rest.length === 1) return report("the file key's policy is the one storage.yaml writes: the account root, kms:*, on *", keyPolicyProblems(stdin(), rest[0]));
  if (command === "account-pab" && rest.length === 0) return report("account Block Public Access: all four settings on", accountPabProblems(stdin()));
  console.error("Usage: see the top of scripts/launch-checks.ts.");
  return 2;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
