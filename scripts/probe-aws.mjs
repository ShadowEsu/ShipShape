#!/usr/bin/env node
// At M6, against the real AWS setup (aws-plan.md; replaces C-4 for AWS): proves what the plan
// promises, with a canary file first, and fails closed: a check that can't run counts as failed.
//
//   AWS_PROFILE=<an Identity Center session> AWS_REGION=us-east-1 \
//   PROBE_BUCKET=<bucket> PROBE_KMS_KEY_ARN=arn:aws:kms:us-east-1:<account>:key/<id> \
//   PROBE_DB_INSTANCE=<rds instance id> PROBE_DATABASE_URL=<the app's DATABASE_URL> DATABASE_CA_CERT="$(cat rds-ca.pem)" \
//   PROBE_ROLE_NAME=shipshape-prod-app PROBE_PRODUCTION_SUB=owner:<team>:project:shipshape:environment:production \
//   PROBE_PREVIEW_OIDC_TOKEN=<a preview deployment's VERCEL_OIDC_TOKEN> \
//   node scripts/probe-aws.mjs
//
// Files (S3): the canary can't be fetched anonymously, nor the bucket or its listing; Block Public
// Access is fully on, the policy isn't public and denies non-TLS, ACLs are off (BucketOwnerEnforced),
// versioning is on with old versions and delete markers expiring within 7 days, and SSE-KMS uses the key.
// Database (RDS): encrypted, deletion protection on, 7 days of backups, no manual snapshot older than
// 7 days; a connection without TLS is refused; over verified TLS the app's role isn't the master
// user, a superuser or BYPASSRLS, owns no table in app, every app table has row level security, and
// no function in app is executable by PUBLIC (F2-1).
// Credentials (IAM/STS): the app role trusts exactly the production sub (StringEquals only), has only
// its inline policy with the allowed actions and no wildcard resource, and a preview's token is refused.
// The canary and all its versions are removed at the end. Exits 1 on any failure.
//
// PROBE_LOCAL_ENDPOINT points every AWS call at a local stand-in (moto) to try the probe itself;
// such a run is never evidence about AWS and exits 3.

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
const NEEDED = ["AWS_REGION", "PROBE_BUCKET", "PROBE_KMS_KEY_ARN", "PROBE_DB_INSTANCE", "PROBE_DATABASE_URL", "DATABASE_CA_CERT", "PROBE_ROLE_NAME", "PROBE_PRODUCTION_SUB", "PROBE_PREVIEW_OIDC_TOKEN"];
const missing = NEEDED.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(", ")}.`);
  process.exit(2);
}
const region = env.AWS_REGION;
const bucket = env.PROBE_BUCKET;
const local = env.PROBE_LOCAL_ENDPOINT ?? "";
const aws = local ? { region, endpoint: local, credentials: { accessKeyId: "test", secretAccessKey: "test" } } : { region };
const s3 = new S3Client({ ...aws, ...(local ? { forcePathStyle: true } : {}) });
const rds = new RDSClient(aws);
const iam = new IAMClient(aws);

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
await attempt("the same database refuses a connection without TLS", async () => {
  // Only a server that just accepted verified TLS proves anything by refusing: a wrong address refuses too.
  if (!tlsWorked) return [false, "the TLS connection didn't work, so a refusal proves nothing"];
  const plain = postgres(env.PROBE_DATABASE_URL, { ssl: false, max: 1, connect_timeout: 10, prepare: false });
  try {
    await plain`select 1`;
    return [false, "connected without TLS"];
  } catch (e) {
    return [true, e?.message ?? ""];
  } finally {
    await plain.end({ timeout: 1 });
  }
});

// 3. Credentials.
let roleArn = "";
await attempt("the app role trusts exactly the production deployment (StringEquals on one sub)", async () => {
  const role = (await iam.send(new GetRoleCommand({ RoleName: env.PROBE_ROLE_NAME }))).Role;
  roleArn = role?.Arn ?? "";
  const trust = JSON.parse(decodeURIComponent(role?.AssumeRolePolicyDocument ?? "{}"));
  const statements = list(trust.Statement);
  const [s] = statements;
  const operators = Object.keys(s?.Condition ?? {});
  const equals = s?.Condition?.StringEquals ?? {};
  const subs = Object.entries(equals).filter(([k]) => k.endsWith(":sub"));
  const ok =
    statements.length === 1 &&
    s.Effect === "Allow" &&
    list(s.Action).length === 1 &&
    list(s.Action)[0] === "sts:AssumeRoleWithWebIdentity" &&
    /:oidc-provider\/oidc\.vercel\.com\//.test(s.Principal?.Federated ?? "") &&
    operators.length === 1 &&
    operators[0] === "StringEquals" &&
    subs.length === 1 &&
    subs[0][1] === env.PROBE_PRODUCTION_SUB &&
    Object.keys(equals).some((k) => k.endsWith(":aud"));
  return [ok, JSON.stringify(statements)];
});
await attempt("the app role can only use the bucket's objects, the key and AdminDeleteUser (no wildcards, no managed policies)", async () => {
  const attached = (await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: env.PROBE_ROLE_NAME }))).AttachedPolicies ?? [];
  const names = (await iam.send(new ListRolePoliciesCommand({ RoleName: env.PROBE_ROLE_NAME }))).PolicyNames ?? [];
  const allowed = new Set(["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "kms:GenerateDataKey", "kms:Decrypt", "cognito-idp:AdminDeleteUser"]);
  const problems = attached.map((p) => `managed policy ${p.PolicyName}`);
  for (const name of names) {
    const doc = JSON.parse(decodeURIComponent((await iam.send(new GetRolePolicyCommand({ RoleName: env.PROBE_ROLE_NAME, PolicyName: name }))).PolicyDocument ?? "{}"));
    for (const s of list(doc.Statement)) {
      if (s.Effect !== "Allow") problems.push(`${name}: ${s.Effect}`);
      if (s.NotAction || s.NotResource) problems.push(`${name}: NotAction/NotResource`);
      for (const a of list(s.Action)) if (!allowed.has(a)) problems.push(`${name}: action ${a}`);
      for (const r of list(s.Resource)) if (r === "*" || r === `arn:aws:s3:::${bucket}` || (/\*/.test(r) && r !== `arn:aws:s3:::${bucket}/*`)) problems.push(`${name}: resource ${r}`);
    }
  }
  return [names.length > 0 && problems.length === 0, problems.join("; ") || names.join(", ")];
});
await attempt("STS refuses a preview deployment's token for the app role", async () => {
  if (!roleArn) return [false, "no role ARN"];
  const body = new URLSearchParams({ Action: "AssumeRoleWithWebIdentity", Version: "2011-06-15", RoleArn: roleArn, RoleSessionName: `probe-${run}`, WebIdentityToken: env.PROBE_PREVIEW_OIDC_TOKEN });
  const res = await fetch(local ? `${local}/` : `https://sts.${region}.amazonaws.com/`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const text = await res.text();
  return [res.status === 403 && /AccessDenied/.test(text), `${res.status} ${text.slice(0, 200)}`];
});

// 4. Clean up: the canary and every version or delete marker under its prefix.
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
