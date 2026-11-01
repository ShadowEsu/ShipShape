// The decisions scripts/probe-aws.mjs makes about what AWS answers, kept here because the probe runs
// its checks the moment it is loaded: tests/probe-aws-rules.test.ts calls these directly. Node strips
// the types when the probe imports this file; it imports nothing at run time.
import type { GetUserPoolMfaConfigCommandOutput, UserPoolType } from "@aws-sdk/client-cognito-identity-provider";
import type { DBInstance, DBSnapshotAttribute, Parameter } from "@aws-sdk/client-rds";
import type { LifecycleRule } from "@aws-sdk/client-s3";

// The one guard for parsed policy JSON, shared with scripts/launch-checks.ts. Not zod: launch.sh runs
// that file before it has checked node_modules against the lockfile, so it may load no package.
export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
export const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : x === undefined ? [] : [x]);
/** The same strings, in any order. */
export const same = (a: unknown, b: readonly string[]) => JSON.stringify(list(a).map(String).sort()) === JSON.stringify([...b].sort());

/** A JWT's payload, decoded without checking the signature (STS checks that); null if it isn't a JWT. */
export function tokenClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return isRecord(claims) ? claims : null;
  } catch {
    return null;
  }
}

/**
 * Why a token isn't a preview deployment's token from the production sub's own project (empty: it
 * is). STS refuses any token whose sub isn't the production one, so a refusal proves something
 * about this project's previews only if the token really is one of them (W12-4).
 */
export function previewTokenProblems(token: string, want: { issuer: string; audience: string; productionSub: string }): string[] {
  const claims = tokenClaims(token);
  if (!claims) return ["it isn't a JWT with a JSON payload"];
  const production = ":environment:production";
  if (!want.productionSub.endsWith(production)) return [`PROBE_PRODUCTION_SUB doesn't end in ${production}`];
  const sub = `${want.productionSub.slice(0, -production.length)}:environment:preview`;
  const problems: string[] = [];
  if (claims.iss !== want.issuer) problems.push(`iss is ${String(claims.iss)}, not ${want.issuer}`);
  const aud = list(claims.aud);
  if (aud.length !== 1 || aud[0] !== want.audience) problems.push(`aud is ${JSON.stringify(claims.aud)}, not ${want.audience}`);
  if (claims.sub !== sub) problems.push(`sub is ${String(claims.sub)}, not ${sub}`);
  return problems;
}

/**
 * A lifecycle rule that is on and reaches every object: no filter, or only an empty prefix. A prefix,
 * tags, object sizes or And would leave some objects out of it.
 */
export function wholeBucket(r: LifecycleRule): boolean {
  if (r.Status !== "Enabled" || (r.Prefix !== undefined && r.Prefix !== "")) return false;
  return Object.entries(r.Filter ?? {}).every(([key, value]) => value === undefined || (key === "Prefix" && value === ""));
}

/**
 * What the bucket's lifecycle rules guarantee for the whole bucket (BOSS rule 1). NewerNoncurrentVersions
 * would keep that many old versions forever, so a rule that sets it doesn't count.
 */
export function lifecycleFacts(rules: LifecycleRule[]) {
  const whole = rules.filter(wholeBucket);
  return {
    versions: whole.some((r) => (r.NoncurrentVersionExpiration?.NoncurrentDays ?? Infinity) <= 7 && r.NoncurrentVersionExpiration?.NewerNoncurrentVersions === undefined),
    markers: whole.some((r) => r.Expiration?.ExpiredObjectDeleteMarker === true),
    multipart: whole.some((r) => (r.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? Infinity) <= 7),
  };
}

/**
 * Whom a bucket policy's Allow statements reach outside the account. Only this account's IAM ARNs are
 * inside. Everyone else is outside: "*", other accounts, services, federated users, canonical users
 * (S3's own ids, which an IAM ARN check can't place), and whoever a NotPrincipal leaves in.
 */
export function outsidePrincipals(statements: unknown[], account: string): string[] {
  const inside = `arn:aws:iam::${account}:`;
  const outside: string[] = [];
  for (const s of statements) {
    if (!isRecord(s) || s.Effect === "Deny") continue;
    if (s.NotPrincipal !== undefined) outside.push(`NotPrincipal ${JSON.stringify(s.NotPrincipal)}`);
    if (s.Principal === undefined) continue;
    if (!isRecord(s.Principal)) {
      outside.push(String(s.Principal));
      continue;
    }
    for (const [type, values] of Object.entries(s.Principal)) {
      for (const v of list(values)) if (!(type === "AWS" && String(v).startsWith(inside))) outside.push(`${type} ${String(v)}`);
    }
  }
  return outside;
}

/** Whom a manual snapshot is shared with: its restore attribute's accounts, or "all" for public. */
export const snapshotSharing = (attributes: DBSnapshotAttribute[]) =>
  attributes.filter((a) => a.AttributeName === "restore").flatMap((a) => a.AttributeValues ?? []);

/** The instance is encrypted with the file key itself (not aws/rds), deletion-protected, and keeps 7 days of backups. */
export const rdsInstanceOk = (db: DBInstance, keyArn: string) =>
  db.StorageEncrypted === true && db.KmsKeyId === keyArn && db.DeletionProtection === true && db.BackupRetentionPeriod === 7;

/**
 * The parameter group keeps values out of the exported log: log_statement isn't "all" (every
 * statement with its literals), and errors are terse (no CONTEXT line holding a failed statement; W12-10).
 * The list must be the whole group: a parameter missing from it can't be vouched for.
 */
export function parameterProblems(params: Parameter[]): string[] {
  const problems: string[] = [];
  const logStatement = params.find((p) => p.ParameterName === "log_statement");
  if (!logStatement) problems.push("log_statement isn't in the list");
  else if (logStatement.ParameterValue === "all") problems.push("log_statement is all");
  const verbosity = params.find((p) => p.ParameterName === "log_error_verbosity")?.ParameterValue;
  if (verbosity !== "terse") problems.push(`log_error_verbosity is ${verbosity ?? "the default"}, not terse`);
  return problems;
}

/** Security's M6 list for the pool; facts is what the probe prints. */
export function poolCheck(pool: UserPoolType, mfa: GetUserPoolMfaConfigCommandOutput, managedLogin: number | undefined) {
  const facts = {
    usernames: pool.UsernameAttributes,
    emailRequired: (pool.SchemaAttributes ?? []).find((a) => a.Name === "email")?.Required,
    autoVerified: pool.AutoVerifiedAttributes,
    // An email change applies only once the new address is verified: the app keys sign-in on it.
    emailVerifiedBeforeUpdate: list(pool.UserAttributeUpdateSettings?.AttributesRequireVerificationBeforeUpdate).includes("email"),
    mfa: mfa.MfaConfiguration,
    totp: mfa.SoftwareTokenMfaConfiguration?.Enabled,
    sms: mfa.SmsMfaConfiguration !== undefined,
    emailMfa: mfa.EmailMfaConfiguration !== undefined,
    deletionProtection: pool.DeletionProtection,
    minimumPasswordLength: pool.Policies?.PasswordPolicy?.MinimumLength,
    managedLogin,
  };
  const ok =
    same(facts.usernames, ["email"]) &&
    facts.emailRequired === true &&
    list(facts.autoVerified).includes("email") &&
    facts.emailVerifiedBeforeUpdate &&
    facts.mfa === "ON" &&
    facts.totp === true &&
    !facts.sms &&
    !facts.emailMfa &&
    facts.deletionProtection === "ACTIVE" &&
    (facts.minimumPasswordLength ?? 0) >= 12 &&
    facts.managedLogin === 2;
  return { ok, facts };
}

// The only two conditions the app role's policy may carry, each exactly as infra/app-role.yaml writes it.
// s3:ListBucket only under a workspace id's prefix (the daily sweep, and telling a missing file from a
// refused one; W11-7, W12-1); the key only through S3's SSE-KMS (W12-11).
export const SWEEP_CONDITION = { StringLike: { "s3:prefix": "????????-????-????-????-????????????/*" } };
export const fileKeyCondition = (region: string) => ({ StringEquals: { "kms:ViaService": `s3.${region}.amazonaws.com` } });

/**
 * One inline policy's statements against the role's grants (resourceOf: each action and its one
 * resource). Every statement allows; s3:ListBucket stands alone under SWEEP_CONDITION; the two kms
 * actions stand together under the file key condition; nothing else carries a condition.
 */
export function rolePolicyProblems(name: string, statements: unknown[], resourceOf: Map<string, string>, region: string) {
  const problems: string[] = [];
  const granted: string[] = [];
  const kmsCondition = JSON.stringify(fileKeyCondition(region));
  for (const s of statements) {
    if (!isRecord(s)) {
      problems.push(`${name}: a statement that isn't an object`);
      continue;
    }
    if (s.Effect !== "Allow") problems.push(`${name}: ${String(s.Effect)}`);
    if (s.NotAction || s.NotResource || s.NotPrincipal) problems.push(`${name}: NotAction/NotResource/NotPrincipal`);
    const actions = list(s.Action).map(String);
    const condition = JSON.stringify(s.Condition ?? {});
    if (actions.includes("s3:ListBucket")) {
      if (!(same(actions, ["s3:ListBucket"]) && condition === JSON.stringify(SWEEP_CONDITION))) problems.push(`${name}: s3:ListBucket other than alone, under the workspace-prefix condition`);
    } else if (actions.some((a) => a.startsWith("kms:"))) {
      if (!(same(actions, ["kms:GenerateDataKey", "kms:Decrypt"]) && condition === kmsCondition)) problems.push(`${name}: the key's actions other than both together, under kms:ViaService s3.${region}.amazonaws.com`);
    } else if (condition !== "{}") {
      problems.push(`${name}: condition ${condition}`);
    }
    const resources = list(s.Resource).map(String);
    if (!resources.length) problems.push(`${name}: no resource`);
    for (const a of actions) {
      granted.push(a);
      const only = resourceOf.get(a);
      if (!only) problems.push(`${name}: action ${a}`);
      else for (const r of resources) if (r !== only) problems.push(`${name}: ${a} on ${r}`);
    }
  }
  return { problems, granted };
}
