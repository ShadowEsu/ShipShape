#!/usr/bin/env node
// At M6, against the real AWS setup (aws-plan.md; replaces C-4 for AWS): proves what the plan
// promises, with a canary file first, and fails closed: a check that can't run counts as failed.
//
//   AWS_PROFILE=<an Identity Center session> AWS_REGION=us-east-1 \
//   PROBE_BUCKET=<bucket> PROBE_KMS_KEY_ARN=arn:aws:kms:us-east-1:<account>:key/<id> \
//   PROBE_DB_INSTANCE=<rds instance id> PROBE_DATABASE_URL=<the app's DATABASE_URL> DATABASE_CA_CERT="$(cat rds-ca.pem)" \
//   PROBE_ROLE_NAME=shipshape-prod-app PROBE_PRODUCTION_SUB=owner:<team>:project:shipshape:environment:production \
//   PROBE_OIDC_PROVIDER_ARN=arn:aws:iam::<account>:oidc-provider/oidc.vercel.com/<team> PROBE_OIDC_AUD=https://vercel.com/<team> \
//   PROBE_PREVIEW_OIDC_TOKEN=<a preview deployment's VERCEL_OIDC_TOKEN> \
//   PROBE_COGNITO_POOL_ID=<pool id> PROBE_COGNITO_CLIENT_ID=<app client id> PROBE_APP_URL=https://<app> \
//   node scripts/probe-aws.mjs
//
// Before the real run, re-lock the AWS SDK packages with the app's (M6 step 7, `--before`; Security
// PR-4): the operator's credentials can do more than the app role.
//
// Files (S3): the canary can't be fetched anonymously, nor the bucket or its listing; Block Public
// Access is fully on, the policy isn't public, denies non-TLS (and nothing else), grants nothing outside the account,
// ACLs are off (BucketOwnerEnforced), versioning is on with old versions and delete markers expiring
// within 7 days, and SSE-KMS uses the key.
// Database (RDS): encrypted, deletion protection on, 7 days of backups, no manual snapshot older than
// 7 days; over verified TLS the app's role isn't the master user, a superuser or BYPASSRLS, owns no
// table in app, every app table has row level security, and no function in app is executable by
// PUBLIC (F2-1); a made-up login without TLS is refused for the missing encryption.
// Sign-in (Cognito): the pool and the app client are set up as Security's M6 list says.
// Credentials (IAM/STS): the app role trusts exactly this account's Vercel provider, its audience and
// the production sub (StringEquals only); its only policy is inline and allows each action it needs,
// every one and nothing more, unconditionally, on its one resource, with no permissions boundary; a
// preview's token is refused.
// The canary and all its versions are removed at the end. Exits 1 on any failure.
//
// PROBE_LOCAL_ENDPOINT points every AWS call at a local stand-in (moto) to try the probe itself;
// such a run is never evidence about AWS and exits 3.

import { randomBytes } from "node:crypto";
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
  DescribeUserPoolDomainCommand,
  GetUserPoolMfaConfigCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DescribeDBInstancesCommand, DescribeDBSnapshotsCommand, RDSClient } from "@aws-sdk/client-rds";
import { GetRoleCommand, GetRolePolicyCommand, IAMClient, ListAttachedRolePoliciesCommand, ListRolePoliciesCommand } from "@aws-sdk/client-iam";
import {
  DeleteObjectsCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketOwnershipControlsCommand,
  GetBucketPolicyCommand,
  GetBucketPolicyStatusCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

const env = process.env;
const NEEDED = [
  "AWS_REGION",
  "PROBE_BUCKET",
  "PROBE_KMS_KEY_ARN",
  "PROBE_DB_INSTANCE",
  "PROBE_DATABASE_URL",
  "DATABASE_CA_CERT",
  "PROBE_ROLE_NAME",
  "PROBE_PRODUCTION_SUB",
  "PROBE_OIDC_PROVIDER_ARN",
  "PROBE_OIDC_AUD",
  "PROBE_PREVIEW_OIDC_TOKEN",
  "PROBE_COGNITO_POOL_ID",
  "PROBE_COGNITO_CLIENT_ID",
  "PROBE_APP_URL",
];
const missing = NEEDED.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(", ")}.`);
  process.exit(2);
}
const region = env.AWS_REGION;
const bucket = env.PROBE_BUCKET;
const account = env.PROBE_KMS_KEY_ARN.split(":")[4] ?? "";
if (!/^\d{12}$/.test(account)) {
  console.error("PROBE_KMS_KEY_ARN must be a full key ARN (arn:aws:kms:<region>:<account>:key/<id>).");
  process.exit(2);
}
const local = env.PROBE_LOCAL_ENDPOINT ?? "";
const aws = local ? { region, endpoint: local, credentials: { accessKeyId: "test", secretAccessKey: "test" } } : { region };
const s3 = new S3Client({ ...aws, ...(local ? { forcePathStyle: true } : {}) });
const rds = new RDSClient(aws);
const iam = new IAMClient(aws);
const cognito = new CognitoIdentityProviderClient(aws);

// The SQL checks (the F2-1 query is the one tests/rls.test.ts runs).
const SQL = {
  role: "select current_user as name, r.rolsuper, r.rolbypassrls, (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as tls from pg_roles r where r.rolname = current_user",
  ownedTables: "select count(*)::int as n from pg_tables where schemaname = 'app' and tableowner = current_user",
  withoutRls: "select c.relname from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1",
  publicExecute: `select p.oid::regprocedure::text as fn from pg_proc p
    where p.pronamespace = 'app'::regnamespace
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
    order by 1`,
};

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });
/** Runs one check; if it can't run (an error, a missing setting), it fails. */
async function attempt(name, fn) {
  try {
    const [ok, detail] = await fn();
    check(name, ok, detail);
  } catch (e) {
    check(name, false, `couldn't check: ${e?.name ?? ""} ${e?.message ?? String(e)}`.trim());
  }
}
const days = (n) => n * 24 * 60 * 60 * 1000;
const list = (x) => (Array.isArray(x) ? x : x === undefined ? [] : [x]);
/** The same strings, in any order. */
const same = (a, b) => JSON.stringify([...list(a)].sort()) === JSON.stringify([...b].sort());

// 1. Files. The canary first: every later file check is about a real object.
const run = Date.now().toString(36);
const canary = `probe-${run}/canary.pdf`;
let canaryStored = false;
await attempt("a canary file is stored, encrypted with the bucket's KMS key", async () => {
  const put = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: canary, Body: "%PDF-1.7\n%canary\n%%EOF\n", ContentType: "application/pdf" }));
  canaryStored = true;
  return [put.ServerSideEncryption === "aws:kms" && put.SSEKMSKeyId === env.PROBE_KMS_KEY_ARN, `${put.ServerSideEncryption} ${put.SSEKMSKeyId}`];
});
const publicBase = local ? `${local}/${bucket}` : `https://${bucket}.s3.${region}.amazonaws.com`;
for (const [what, url] of [
  ["the canary", `${publicBase}/${canary}`],
  ["the bucket", `${publicBase}/`],
  ["the bucket's listing", `${publicBase}/?list-type=2`],
]) {
  await attempt(`anonymous GET of ${what} answers 403`, async () => {
    if (!canaryStored) return [false, "no canary, so a 403 would prove nothing"];
    const res = await fetch(url);
    return [res.status === 403, String(res.status)];
  });
}
await attempt("Block Public Access: all four settings on", async () => {
  const c = (await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket }))).PublicAccessBlockConfiguration ?? {};
  return [c.BlockPublicAcls === true && c.IgnorePublicAcls === true && c.BlockPublicPolicy === true && c.RestrictPublicBuckets === true, JSON.stringify(c)];
});
await attempt("the bucket policy isn't public", async () => {
  const status = (await s3.send(new GetBucketPolicyStatusCommand({ Bucket: bucket }))).PolicyStatus;
  return [status?.IsPublic === false, JSON.stringify(status)];
});
await attempt("the bucket policy denies every request that isn't TLS", async () => {
  const policy = JSON.parse((await s3.send(new GetBucketPolicyCommand({ Bucket: bucket }))).Policy ?? "{}");
  const arns = [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`];
  const denies = list(policy.Statement).some(
    (s) =>
      s.Effect === "Deny" &&
      (s.Principal === "*" || s.Principal?.AWS === "*") &&
      list(s.Action).includes("s3:*") &&
      arns.every((arn) => list(s.Resource).includes(arn)) &&
      String(s.Condition?.Bool?.["aws:SecureTransport"]) === "false",
  );
  return [denies, JSON.stringify(policy.Statement)];
});
await attempt("the bucket policy denies nothing else: its only Deny is the one for requests without TLS (a Deny on deletes would strand files; P-b0a)", async () => {
  const policy = JSON.parse((await s3.send(new GetBucketPolicyCommand({ Bucket: bucket }))).Policy ?? "{}");
  const tlsOnly = (s) => same(Object.keys(s.Condition ?? {}), ["Bool"]) && same(Object.keys(s.Condition.Bool), ["aws:SecureTransport"]) && String(s.Condition.Bool["aws:SecureTransport"]) === "false";
  const other = list(policy.Statement).filter((s) => s.Effect === "Deny" && !tlsOnly(s));
  return [other.length === 0, JSON.stringify(other)];
});
await attempt("the bucket policy grants nothing to anyone outside this account", async () => {
  const policy = JSON.parse((await s3.send(new GetBucketPolicyCommand({ Bucket: bucket }))).Policy ?? "{}");
  const outside = list(policy.Statement)
    .filter((s) => s.Effect !== "Deny")
    .flatMap((s) => (s.Principal === "*" ? ["*"] : [...list(s.Principal?.AWS), ...list(s.Principal?.Service), ...list(s.Principal?.Federated)]))
    .filter((p) => !String(p).startsWith(`arn:aws:iam::${account}:`));
  return [outside.length === 0, outside.join(", ")];
});
await attempt("ACLs are off (BucketOwnerEnforced)", async () => {
  const rules = (await s3.send(new GetBucketOwnershipControlsCommand({ Bucket: bucket }))).OwnershipControls?.Rules ?? [];
  return [rules.length === 1 && rules[0].ObjectOwnership === "BucketOwnerEnforced", JSON.stringify(rules)];
});
await attempt("versioning is on, and old versions and delete markers expire within 7 days (BOSS rule 1)", async () => {
  const versioning = (await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status;
  const rules = (await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))).Rules ?? [];
  const wholeBucket = (r) => r.Status === "Enabled" && !r.Filter?.And && !r.Filter?.Tag && !r.Filter?.Prefix && !r.Prefix;
  const versions = rules.some((r) => wholeBucket(r) && (r.NoncurrentVersionExpiration?.NoncurrentDays ?? Infinity) <= 7);
  const markers = rules.some((r) => wholeBucket(r) && r.Expiration?.ExpiredObjectDeleteMarker === true);
  return [versioning === "Enabled" && versions && markers, `${versioning}; ${JSON.stringify(rules)}`];
});
await attempt("default encryption is SSE-KMS with the key", async () => {
  const rules = (await s3.send(new GetBucketEncryptionCommand({ Bucket: bucket }))).ServerSideEncryptionConfiguration?.Rules ?? [];
  const by = rules[0]?.ApplyServerSideEncryptionByDefault;
  return [rules.length === 1 && by?.SSEAlgorithm === "aws:kms" && by.KMSMasterKeyID === env.PROBE_KMS_KEY_ARN, JSON.stringify(rules)];
});

// 2. Database.
let master = "";
await attempt("RDS: storage encrypted, deletion protection on, 7 days of backups", async () => {
  const [db] = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: env.PROBE_DB_INSTANCE }))).DBInstances ?? [];
  if (!db) return [false, "instance not found"];
  master = db.MasterUsername ?? "";
  console.log(`INFO PubliclyAccessible: ${db.PubliclyAccessible} (Security's open choice)`);
  return [db.StorageEncrypted === true && db.DeletionProtection === true && db.BackupRetentionPeriod === 7, `encrypted ${db.StorageEncrypted}, deletion protection ${db.DeletionProtection}, backups ${db.BackupRetentionPeriod} days`];
});
await attempt("RDS: no manual snapshot older than 7 days (BOSS rule 1)", async () => {
  const snapshots = (await rds.send(new DescribeDBSnapshotsCommand({ DBInstanceIdentifier: env.PROBE_DB_INSTANCE, SnapshotType: "manual" }))).DBSnapshots ?? [];
  const old = snapshots.filter((s) => !s.SnapshotCreateTime || Date.now() - new Date(s.SnapshotCreateTime).getTime() > days(7));
  return [old.length === 0, old.map((s) => s.DBSnapshotIdentifier).join(", ")];
});
const sql = postgres(env.PROBE_DATABASE_URL, { ssl: { rejectUnauthorized: true, ca: env.DATABASE_CA_CERT }, max: 1, connect_timeout: 10, prepare: false });
let tlsWorked = false;
try {
  await attempt("the app's database role: verified TLS, not the master user, not superuser, not BYPASSRLS (BOSS rule 2)", async () => {
    const [r] = await sql.unsafe(SQL.role);
    tlsWorked = r.tls === true;
    return [r.tls === true && r.rolsuper === false && r.rolbypassrls === false && master !== "" && r.name !== master, JSON.stringify({ ...r, master })];
  });
  await attempt("the app's database role owns no table in app (BOSS rule 2)", async () => {
    const [r] = await sql.unsafe(SQL.ownedTables);
    return [r.n === 0, String(r.n)];
  });
  await attempt("every app table has row level security", async () => {
    const rows = await sql.unsafe(SQL.withoutRls);
    return [rows.length === 0, rows.map((r) => r.relname).join(", ")];
  });
  await attempt("no function in app is executable by PUBLIC (F2-1)", async () => {
    const rows = await sql.unsafe(SQL.publicExecute);
    return [rows.length === 0, rows.map((r) => r.fn).join(", ")];
  });
} finally {
  await sql.end({ timeout: 1 });
}
await attempt("the same database refuses a made-up login without TLS, for the missing encryption (PR-1)", async () => {
  // Only a server that just accepted verified TLS proves anything by refusing: a wrong address refuses too.
  if (!tlsWorked) return [false, "the TLS connection didn't work, so a refusal proves nothing"];
  // Never the app's own login: if the server did take plain connections, it would cross the network unencrypted.
  const target = new URL(env.PROBE_DATABASE_URL);
  const plain = postgres({
    host: target.hostname,
    port: Number(target.port || 5432),
    database: decodeURIComponent(target.pathname.slice(1)),
    username: `probe_${randomBytes(6).toString("hex")}`,
    password: randomBytes(24).toString("base64url"),
    ssl: false,
    max: 1,
    connect_timeout: 10,
    prepare: false,
  });
  try {
    await plain`select 1`;
    return [false, "connected without TLS"];
  } catch (e) {
    // RDS with rds.force_ssl=1: 28000 "no pg_hba.conf entry for host …, no encryption". Anything else
    // (a timeout; 28P01, it asked for a password) doesn't show that plain connections are refused.
    return [e?.code === "28000" && /no encryption/i.test(e?.message ?? ""), `${e?.code ?? ""} ${e?.message ?? String(e)}`];
  } finally {
    await plain.end({ timeout: 1 });
  }
});

// 3. Sign-in (Cognito): Security's M6 list for the pool and the app client.
let poolArn = "";
await attempt("the Cognito pool: email sign-in, required and verified; MFA on with TOTP only; deletion protection; passwords of 12+; managed login", async () => {
  const pool = (await cognito.send(new DescribeUserPoolCommand({ UserPoolId: env.PROBE_COGNITO_POOL_ID }))).UserPool;
  if (!pool) return [false, "pool not found"];
  poolArn = pool.Arn ?? "";
  const mfa = await cognito.send(new GetUserPoolMfaConfigCommand({ UserPoolId: env.PROBE_COGNITO_POOL_ID }));
  const domain = pool.CustomDomain ?? pool.Domain;
  const managedLogin = domain ? (await cognito.send(new DescribeUserPoolDomainCommand({ Domain: domain }))).DomainDescription?.ManagedLoginVersion : undefined;
  const facts = {
    usernames: pool.UsernameAttributes,
    emailRequired: (pool.SchemaAttributes ?? []).find((a) => a.Name === "email")?.Required,
    autoVerified: pool.AutoVerifiedAttributes,
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
    facts.mfa === "ON" &&
    facts.totp === true &&
    !facts.sms &&
    !facts.emailMfa &&
    facts.deletionProtection === "ACTIVE" &&
    (facts.minimumPasswordLength ?? 0) >= 12 &&
    facts.managedLogin === 2;
  return [ok, JSON.stringify(facts)];
});
await attempt("the app client: a secret, code flow only, scopes openid email, one callback, email not writable, no password flows, PreventUserExistenceErrors, ID tokens of 1 hour or less", async () => {
  const c = (await cognito.send(new DescribeUserPoolClientCommand({ UserPoolId: env.PROBE_COGNITO_POOL_ID, ClientId: env.PROBE_COGNITO_CLIENT_ID }))).UserPoolClient;
  if (!c) return [false, "client not found"];
  const unitSeconds = new Map([["seconds", 1], ["minutes", 60], ["hours", 3600], ["days", 86400]]);
  // Unset, ID tokens last 60 minutes; set, the unit defaults to hours.
  const idTokenSeconds = c.IdTokenValidity === undefined ? 3600 : c.IdTokenValidity * (unitSeconds.get(c.TokenValidityUnits?.IdToken ?? "hours") ?? Infinity);
  // Only facts about the client go in the output: never ClientSecret itself.
  const facts = {
    secret: Boolean(c.ClientSecret),
    flows: c.AllowedOAuthFlows,
    flowsOn: c.AllowedOAuthFlowsUserPoolClient,
    scopes: c.AllowedOAuthScopes,
    callbacks: c.CallbackURLs,
    emailWritable: c.WriteAttributes === undefined || c.WriteAttributes.includes("email"),
    passwordFlows: list(c.ExplicitAuthFlows).filter((f) => f === "ALLOW_USER_PASSWORD_AUTH" || f === "ALLOW_ADMIN_USER_PASSWORD_AUTH"),
    preventUserExistenceErrors: c.PreventUserExistenceErrors,
    idTokenSeconds,
  };
  const ok =
    facts.secret &&
    same(facts.flows, ["code"]) &&
    facts.flowsOn === true &&
    same(facts.scopes, ["email", "openid"]) &&
    same(facts.callbacks, [`${env.PROBE_APP_URL.replace(/\/+$/, "")}/auth/callback`]) &&
    !facts.emailWritable &&
    facts.passwordFlows.length === 0 &&
    facts.preventUserExistenceErrors === "ENABLED" &&
    facts.idTokenSeconds <= 3600;
  return [ok, JSON.stringify(facts)];
});

// 4. Credentials.
let roleArn = "";
let roleBoundary = "";
await attempt("the app role trusts exactly this account's Vercel provider, its audience and the production sub (StringEquals only; PR-3)", async () => {
  const role = (await iam.send(new GetRoleCommand({ RoleName: env.PROBE_ROLE_NAME }))).Role;
  roleArn = role?.Arn ?? "";
  roleBoundary = role?.PermissionsBoundary?.PermissionsBoundaryArn ?? "";
  const provider = env.PROBE_OIDC_PROVIDER_ARN;
  const issuer = provider.split(":oidc-provider/")[1] ?? "";
  const trust = JSON.parse(decodeURIComponent(role?.AssumeRolePolicyDocument ?? "{}"));
  const statements = list(trust.Statement);
  const [s] = statements;
  const operators = Object.keys(s?.Condition ?? {});
  const equals = s?.Condition?.StringEquals ?? {};
  const ok =
    provider.startsWith(`arn:aws:iam::${account}:oidc-provider/oidc.vercel.com/`) &&
    statements.length === 1 &&
    s.Effect === "Allow" &&
    same(list(s.Action), ["sts:AssumeRoleWithWebIdentity"]) &&
    same(Object.keys(s.Principal ?? {}), ["Federated"]) &&
    s.Principal.Federated === provider &&
    same(operators, ["StringEquals"]) &&
    same(Object.keys(equals), [`${issuer}:aud`, `${issuer}:sub`]) &&
    equals[`${issuer}:aud`] === env.PROBE_OIDC_AUD &&
    equals[`${issuer}:sub`] === env.PROBE_PRODUCTION_SUB;
  return [ok, JSON.stringify(statements)];
});
// Exactly these: one more is a wider grant; one fewer breaks the app where it matters least visibly (a missing
// s3:DeleteObject or kms:Decrypt strands a deleted account's files, Security N-091a). And nothing that could
// quietly take one away again: no permissions boundary, no condition on a grant (P-b0a).
await attempt("the app role allows each action it needs, every one, unconditionally, on its one resource only: the bucket's objects, the key, the pool (no wildcards, no managed policies, no permissions boundary; PR-2)", async () => {
  if (!poolArn) return [false, "no pool ARN to compare AdminDeleteUser with"];
  const objects = `arn:aws:s3:::${bucket}/*`;
  const resourceOf = new Map([
    ["s3:PutObject", objects],
    ["s3:GetObject", objects],
    ["s3:DeleteObject", objects],
    ["kms:GenerateDataKey", env.PROBE_KMS_KEY_ARN],
    ["kms:Decrypt", env.PROBE_KMS_KEY_ARN],
    ["cognito-idp:AdminDeleteUser", poolArn],
  ]);
  const attached = (await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: env.PROBE_ROLE_NAME }))).AttachedPolicies ?? [];
  const names = (await iam.send(new ListRolePoliciesCommand({ RoleName: env.PROBE_ROLE_NAME }))).PolicyNames ?? [];
  const problems = attached.map((p) => `managed policy ${p.PolicyName}`);
  if (roleBoundary) problems.push(`permissions boundary ${roleBoundary}`);
  const granted = new Set();
  for (const name of names) {
    const doc = JSON.parse(decodeURIComponent((await iam.send(new GetRolePolicyCommand({ RoleName: env.PROBE_ROLE_NAME, PolicyName: name }))).PolicyDocument ?? "{}"));
    for (const s of list(doc.Statement)) {
      if (s.Effect !== "Allow") problems.push(`${name}: ${s.Effect}`);
      if (s.NotAction || s.NotResource || s.NotPrincipal) problems.push(`${name}: NotAction/NotResource/NotPrincipal`);
      if (Object.keys(s.Condition ?? {}).length) problems.push(`${name}: condition ${Object.keys(s.Condition).join(", ")}`);
      const resources = list(s.Resource);
      if (!resources.length) problems.push(`${name}: no resource`);
      for (const a of list(s.Action)) {
        granted.add(a);
        const only = resourceOf.get(a);
        if (!only) problems.push(`${name}: action ${a}`);
        else for (const r of resources) if (r !== only) problems.push(`${name}: ${a} on ${r}`);
      }
    }
  }
  for (const a of resourceOf.keys()) if (!granted.has(a)) problems.push(`missing ${a}`);
  return [names.length > 0 && problems.length === 0, problems.join("; ") || names.join(", ")];
});
await attempt("STS refuses a preview deployment's token for the app role", async () => {
  if (!roleArn) return [false, "no role ARN"];
  const body = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: roleArn, RoleSessionName: `probe-${run}`, WebIdentityToken: env.PROBE_PREVIEW_OIDC_TOKEN });
  const res = await fetch(local ? `${local}/` : `https://sts.${region}.amazonaws.com/`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const text = await res.text();
  // If STS wrongly issues credentials, the answer holds them: say so, never print it.
  const detail = res.ok ? `${res.status}: STS issued credentials to a preview (not printed)` : `${res.status} ${text.slice(0, 200)}`;
  return [res.status === 403 && /AccessDenied/.test(text), detail];
});

// 5. Clean up: the canary and every version or delete marker under its prefix.
await attempt("the canary and its versions are removed again", async () => {
  const prefix = `probe-${run}/`;
  const listed = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }));
  const objects = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
  if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
  const after = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix }));
  const left = (after.Versions?.length ?? 0) + (after.DeleteMarkers?.length ?? 0);
  return [left === 0 && (!canaryStored || objects.length > 0), `${objects.length} removed, ${left} left`];
});

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `: ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
if (local) {
  console.log(`LOCAL STAND-IN (${local}): this run says nothing about AWS.`);
  process.exit(3);
}
process.exit(failed ? 1 : 0);
