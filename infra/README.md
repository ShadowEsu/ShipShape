# ShipShape on AWS: CloudFormation for M6

These templates create what the AWS hosting plan (`aws-plan.md`) specifies, so M6 is five reviewable `aws cloudformation deploy` runs instead of console clicks. They are the source of truth: if a console setting and a template disagree, the template wins. `scripts/probe-aws.mjs` is the acceptance test once they are deployed.

| File | Creates |
| --- | --- |
| `storage.yaml` | The customer KMS key (`alias/shipshape-files`) and the private, versioned S3 bucket for files, plus its TLS-only bucket policy |
| `signin.yaml` | The Cognito user pool (Essentials tier), its managed-login domain and style, and the confidential app client |
| `app-role.yaml` | Vercel's IAM OIDC provider and the role `shipshape-prod-app`, with one inline policy |
| `database.yaml` | RDS for PostgreSQL 17 (`db.t4g.micro`, Single-AZ, 20 GB gp3), its parameter group, subnet group, security group and log group |
| `budgets.yaml` | The two budget alarms |

Everything is in us-east-1.

## Parameters

| Template | Parameter | Value |
| --- | --- | --- |
| storage | `BucketName` | A globally unique name, e.g. `shipshape-files-<account id>` |
| signin | `AppUrl` | `SHIPSHAPE_APP_URL`: `https://<app>`, with no trailing slash |
| signin | `DomainPrefix` | The managed-login prefix; `COGNITO_DOMAIN` becomes `https://<prefix>.auth.us-east-1.amazoncognito.com` |
| app-role | `VercelTeam` | The Vercel team slug (team issuer mode) |
| app-role | `Audience` | `https://vercel.com/<team>` |
| app-role | `ProductionSub` | `owner:<team>:project:shipshape:environment:production`. The pattern only accepts `environment:production`, with no wildcard |
| app-role | `BucketName`, `FileKeyArn`, `UserPoolArn` | The outputs of storage (`BucketName`, `KeyArn`) and signin (`UserPoolArn`) |
| database | `FileKeyArn` | storage's `KeyArn` |
| database | `VpcId`, `SubnetIds` | The default VPC and at least two of its public subnets, in different availability zones |
| database | `EngineVersion` | A PostgreSQL 17 minor version that RDS offers that day (see step 4) |
| database | `InstanceIdentifier` | Default `shipshape-prod` (`PROBE_DB_INSTANCE`) |
| database | `LogRetentionDays` | Default `30`: how long CloudWatch keeps the exported Postgres log |
| budgets | `AlertEmail` | the account owner's own address |

## Deploy order and commands

The account owner does these first. Agents can't (aws-plan, "What the owner does"):

1. Create the AWS account on the **Paid plan**. Turn on MFA for the root user and create no root access keys. Set up IAM Identity Center with MFA for himself.
2. Apply for Activate Founders with the company website and the account id. The site has to be live first, and the decision takes about 7-10 business days.
3. Approve these steps. An agent can then run them through a short-lived Identity Center session that the owner starts (`aws sso login --profile <profile>`), never with stored keys.

Then, with `AWS_PROFILE` set to that session and `AWS_REGION=us-east-1`, run these in order:

```sh
# 0. Block Public Access at the account level too (aws-plan S3 row). CloudFormation can't set it.
aws s3control put-public-access-block --account-id <account id> \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 1. Files.
aws cloudformation deploy --region us-east-1 --stack-name shipshape-storage --template-file infra/storage.yaml \
  --parameter-overrides BucketName=shipshape-files-<account id>
aws cloudformation describe-stacks --region us-east-1 --stack-name shipshape-storage --query 'Stacks[0].Outputs'

# 2. Sign-in.
aws cloudformation deploy --region us-east-1 --stack-name shipshape-signin --template-file infra/signin.yaml \
  --parameter-overrides AppUrl=https://<app> DomainPrefix=<prefix>
aws cloudformation describe-stacks --region us-east-1 --stack-name shipshape-signin --query 'Stacks[0].Outputs'

# 3. The app role. It has a fixed RoleName, so it needs CAPABILITY_NAMED_IAM.
aws cloudformation deploy --region us-east-1 --stack-name shipshape-app-role --template-file infra/app-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides VercelTeam=<team> Audience=https://vercel.com/<team> \
    ProductionSub=owner:<team>:project:shipshape:environment:production \
    BucketName=<storage BucketName> FileKeyArn=<storage KeyArn> UserPoolArn=<signin UserPoolArn>

# 4. The database.
aws rds describe-db-engine-versions --region us-east-1 --engine postgres --engine-version 17 --default-only \
  --query 'DBEngineVersions[0].EngineVersion' --output text
aws ec2 describe-vpcs --region us-east-1 --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text
aws ec2 describe-subnets --region us-east-1 --filters Name=vpc-id,Values=<vpc> --query 'Subnets[].[SubnetId,AvailabilityZone]' --output text
aws cloudformation deploy --region us-east-1 --stack-name shipshape-database --template-file infra/database.yaml \
  --parameter-overrides FileKeyArn=<storage KeyArn> VpcId=<vpc> SubnetIds=<subnet-a>,<subnet-b> EngineVersion=<17.x from above>

# 5. Budgets.
aws cloudformation deploy --region us-east-1 --stack-name shipshape-budgets --template-file infra/budgets.yaml \
  --parameter-overrides AlertEmail=<the owner's address>

# Then: stop a stack delete from reaching the retained resources by accident.
for s in shipshape-storage shipshape-signin shipshape-app-role shipshape-database; do
  aws cloudformation update-termination-protection --region us-east-1 --enable-termination-protection --stack-name "$s"; done
```

Afterwards:
- **Vercel env, Production only:**
  - `SHIPSHAPE_S3_BUCKET` and `AWS_ROLE_ARN` (the app-role `RoleArn`), plus `AWS_REGION=us-east-1`;
  - `COGNITO_DOMAIN`, `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` (the signin outputs);
  - `COGNITO_CLIENT_SECRET`, piped straight in so it never prints: `aws cognito-idp describe-user-pool-client --user-pool-id <id> --client-id <id> --query UserPoolClient.ClientSecret --output text | vercel env add COGNITO_CLIENT_SECRET production`.

  Previews get none of these (Security S3-1).
- **Database roles and migrations:** follow aws-plan's "Order at M6", step 8.
  - `npm run migrate` runs as the master. Its password is in the `MasterSecretArn` secret.
  - `shipshape_app` gets a machine-generated password of 32+ characters, kept only in Vercel Production (R-1).
- **Acceptance:** run `scripts/probe-aws.mjs` with the values from the outputs (its header lists every variable). It must exit 0.

## Not in these templates (operator or the account owner, at M6)

| Item | Why it isn't here | Source |
| --- | --- | --- |
| Account-level Block Public Access | Not a CloudFormation resource. Step 0 above sets it | aws-plan S3 row |
| CloudTrail, all regions, into a separate private bucket | aws-plan lists it under Audit. It isn't one of these five templates | aws-plan Audit row |
| GuardDuty RDS Protection | Account-wide, and it costs money after the trial. aws-plan says to check that cost at setup | R-4 (SHOULD) |
| SES production access | It's a support request. Production email stays off until BOSS and Security say go | aws-plan Email row |
| IAM Identity Center, root MFA, the Paid plan, Activate | account owner only | aws-plan "What the owner does" |
| The database's roles and `shipshape_app`'s password | They live in SQL (`plain-postgres.sql`, `npm run migrate`), not in AWS resources | R-1, R-2, BOSS rule 2 |

## Requirement → template

| Requirement | Source | Where |
| --- | --- | --- |
| us-east-1 only | aws-plan Region | Every command uses `--region us-east-1`. The budgets are global, created from us-east-1 |
| Block Public Access, all four, on the bucket | aws-plan S3; probe "Block Public Access" | `storage.yaml` `FilesBucket.PublicAccessBlockConfiguration` |
| ACLs off (`BucketOwnerEnforced`) | aws-plan S3; probe "ACLs are off" | `FilesBucket.OwnershipControls` |
| Versioning on | aws-plan S3; probe "versioning is on" | `FilesBucket.VersioningConfiguration.Status: Enabled` |
| Noncurrent versions expire after 7 days | BOSS rule 1; probe "versioning…expire within 7 days" | `FilesBucket.LifecycleConfiguration.Rules[deleted-data-7-days].NoncurrentVersionExpiration.NoncurrentDays: 7`. The rule has no filter, so it covers the whole bucket |
| Expired delete markers removed | BOSS rule 1; same probe line | Same rule, `ExpiredObjectDeleteMarker: true` |
| Incomplete multipart uploads aborted after 1 day | aws-plan S3 | Same rule, `AbortIncompleteMultipartUpload.DaysAfterInitiation: 1` |
| SSE-KMS by default with the customer key | aws-plan S3; probe "default encryption is SSE-KMS with the key", "canary…encrypted with the bucket's KMS key" | `FilesBucket.BucketEncryption…SSEAlgorithm: aws:kms`, `KMSMasterKeyID: !GetAtt FileKey.Arn`. The ARN, because the probe compares it with `PROBE_KMS_KEY_ARN` |
| S3 Bucket Keys | aws-plan S3 and cost table | `BucketEncryption…BucketKeyEnabled: true` |
| Object Lock off | BOSS rule 1; probe "Object Lock is off" | `FilesBucket` has no `ObjectLockEnabled` or `ObjectLockConfiguration` |
| The policy denies non-TLS | aws-plan bucket policy; probe "denies every request that isn't TLS" | `FilesBucketPolicy` `DenyNonTLS`: `Principal: "*"`, `s3:*`, the bucket and `/*`, `Bool aws:SecureTransport "false"` |
| …and denies nothing else | probe "denies nothing else" (P-b0a) | `FilesBucketPolicy` has one statement |
| The policy isn't public and grants nothing outside the account | probe "isn't public", "grants nothing…outside" | `FilesBucketPolicy` has no Allow statement |
| Anonymous canary, bucket and listing GETs answer 403 | Security 0158 | Block Public Access, `BucketOwnerEnforced`, and no Allow in the policy |
| One customer key, rotated yearly | aws-plan cost table | `FileKey` (`EnableKeyRotation: true`). Its key policy only delegates to the account's IAM |
| RDS storage encrypted with the key | aws-plan RDS; probe "RDS: storage encrypted" | `database.yaml` `Database.StorageEncrypted: true`, `KmsKeyId: FileKeyArn` (the plan prices one key) |
| PostgreSQL 17, `db.t4g.micro`, Single-AZ, 20 GB gp3 | aws-plan RDS | `Database.Engine: postgres`, `EngineVersion` (pattern `17.x`), `DBInstanceClass`, `MultiAZ: false`, `AllocatedStorage: "20"`, `StorageType: gp3` |
| 7 days of automated backups (PITR) | aws-plan RDS, BOSS rule 1; probe "7 days of backups" | `Database.BackupRetentionPeriod: 7` |
| Deletion protection | aws-plan RDS; probe | `Database.DeletionProtection: true` |
| No manual snapshot past 7 days | BOSS rule 1; probe "no manual snapshot older than 7 days" | `Database` `DeletionPolicy: Retain`, so CloudFormation's default `Snapshot` never makes a final snapshot |
| `rds.force_ssl=1` | R-3; aws-plan RDS | `DatabaseParameters.Parameters.rds.force_ssl: "1"` |
| SCRAM only, `password_encryption=scram-sha-256` | R-3; aws-plan reachability row | `DatabaseParameters`: `password_encryption: scram-sha-256`, `rds.accepted_password_auth_method: scram` |
| `PubliclyAccessible=true` (Security ACCEPTED) | aws-plan reachability row | `Database.PubliclyAccessible: true` |
| Security group on 5432 only | aws-plan reachability row | `DatabaseSecurityGroup`: one ingress rule, tcp 5432 |
| The master password managed by RDS in Secrets Manager | R-2 | `Database.ManageMasterUserPassword: true`, `MasterUsername: postgres` (output `MasterSecretArn`) |
| `log_connections`, `log_disconnections` | R-4 | `DatabaseParameters`: both `"1"` |
| Failed-auth logs exported to CloudWatch | R-4 | `Database.EnableCloudwatchLogsExports: [postgresql]`. `DatabaseLog` sets its retention |
| Automatic minor version upgrades | R-4 | `Database.AutoMinorVersionUpgrade: true` |
| OIDC provider for `https://oidc.vercel.com/<team>` | aws-plan Credentials | `app-role.yaml` `VercelOidcProvider.Url`, `ClientIdList: [Audience]` |
| Role `shipshape-prod-app` | aws-plan IAM drafts | `AppRole.RoleName` |
| Trust: exactly the provider, `aud` and the production `sub`, with `StringEquals` only | S3-1; probe PR-3 | `AppRole.AssumeRolePolicyDocument`: one statement, `Federated: <provider ARN>`, `sts:AssumeRoleWithWebIdentity`, `StringEquals` on `oidc.vercel.com/<team>:aud` and `:sub`. It's a `!Sub` JSON string because the condition keys contain the team |
| A preview token is refused | S3-1; probe "STS refuses a preview" | The `sub` holds `environment:production` only, enforced by the `ProductionSub` pattern. Only real STS can prove it, at M6 |
| S3 Put/Get/DeleteObject on `<bucket>/*` | IAM drafts `Files`; probe PR-2 | `AppRole.Policies[app]`, Sid `Files` |
| `kms:GenerateDataKey` and `kms:Decrypt` on the one key | IAM drafts `FileKey`; probe PR-2 | Sid `FileKey`, `Resource: FileKeyArn` |
| `cognito-idp:AdminDeleteUser` on the one pool | IAM drafts `DeleteAccounts`; probe PR-2 | Sid `DeleteAccounts`, `Resource: UserPoolArn` |
| Nothing more: no conditions, no wildcards, no `ListBucket`, no managed policies, no permissions boundary | probe PR-2, P-b0a; aws-plan TO-1 | `AppRole` has one inline policy and no `ManagedPolicyArns` or `PermissionsBoundary` |
| No long-lived access keys | aws-plan Credentials | No `AWS::IAM::User` or `AccessKey` anywhere |
| Pool: email sign-in, email required and auto-verified | Security 0541 M6 list; probe Cognito pool | `signin.yaml` `UserPool.UsernameAttributes: [email]`, `Schema` email `Required: true`, `AutoVerifiedAttributes: [email]` |
| MFA required, TOTP only | same | `UserPool.MfaConfiguration: "ON"`, `EnabledMfas: [SOFTWARE_TOKEN_MFA]` |
| Deletion protection | same | `UserPool.DeletionProtection: ACTIVE` |
| Passwords of 12 or more characters | same | `UserPool.Policies.PasswordPolicy.MinimumLength: 12` |
| Managed login, not the classic hosted UI | aws-plan Sign-in (`prompt=login`) | `UserPoolDomain.ManagedLoginVersion: 2`, plus `AppClientLoginStyle` (managed login needs a style per client) |
| Essentials tier, self-registration on | aws-plan Sign-in | `UserPool.UserPoolTier: ESSENTIALS`, `AdminCreateUserConfig.AllowAdminCreateUserOnly: false` |
| Client: a secret, code flow only, scopes `openid email` | Security 0541; probe app client | `AppClient.GenerateSecret: true`, `AllowedOAuthFlows: [code]`, `AllowedOAuthFlowsUserPoolClient: true`, `AllowedOAuthScopes: [openid, email]` |
| Exactly one callback, `https://<app>/auth/callback` | same | `AppClient.CallbackURLs: [${AppUrl}/auth/callback]` |
| `email` not writable by the client | same | `AppClient.WriteAttributes: [name]` |
| No password flows | same | `AppClient.ExplicitAuthFlows: [ALLOW_REFRESH_TOKEN_AUTH]` |
| `PreventUserExistenceErrors`, ID tokens of 1 hour or less | same | `AppClient.PreventUserExistenceErrors: ENABLED`, `IdTokenValidity: 60` minutes |
| Alarm 1: credits included, $1, actual spend | aws-plan Budget alarms | `budgets.yaml` `RealMoneyBudget`: COST, MONTHLY, $1, `IncludeCredit: true`, ACTUAL > 1 USD |
| Alarm 2: credits excluded (charge type Usage), $25 actual and forecast | same | `CreditBurnBudget`: COST, MONTHLY, $25, every non-usage `Include*` false (credit, refund, tax, support, subscriptions, recurring, upfront), ACTUAL > 25 and FORECASTED > 25 |
| Both budgets free (no actions) | same | Neither budget has an action |

### Choices beyond the plan's text (for review)

- **Retain on delete:** the key, bucket, pool, database and log group have `DeletionPolicy: Retain`. Deleting a stack never deletes documents, accounts or rows. For the database it also means no final snapshot.
- **The app client's extra settings:**
  - `ReadAttributes: [email, email_verified]`: the ID token carries the claims the callback checks;
  - `RefreshTokenValidity` is 1 day: the app never uses refresh tokens, since its own cookie takes over;
  - `EnableTokenRevocation`;
  - `UserAttributeUpdateSettings`: an email change needs verification before it applies.
- **`EngineVersion` is a parameter:** cfn-lint's data marks the bare major version `17` deprecated for new instances (W3691), so the minor version is chosen at deploy time.
- **The exported Postgres log is kept for 30 days by default.** The plan doesn't name a period. Without the log group, CloudWatch would keep it forever.
- **Open (check at M6):** Cognito may need a required attribute to be writable for self-sign-up through managed login. Security listed both "self-registration on" and "email not writable". Security's decision (2026-10-31, request 20261031-2242): if `CreateUserPoolClient` refuses `WriteAttributes: [name]`, `email` may be added, provided the scopes stay `openid email` (no `aws.cognito.signin.user.admin`), `ALLOW_REFRESH_TOKEN_AUTH` stays the only flow, `UserAttributeUpdateSettings` keeps email verified before it applies, the app keeps keying on `sub`, and an M6 probe shows `UpdateUserAttributes(email)` with an app token gets `NotAuthorized`. Nothing wider.

## Proven against moto (local stand-in, not evidence about AWS)

Scratch: `~/shipshape-work.noindex/infra-check/` (outside the repo).
- `run-probe.sh` is adapted from `probe-aws/run-probe.sh`.
- `deploy.py` runs `create_stack` per template on moto 5.2.5.
- moto is served over TLS with a self-signed certificate that Node trusts through `NODE_EXTRA_CA_CERTS`.

When moto's CloudFormation skips something, `deploy.py` applies it with a direct boto3 call. The values are read from the same template, with the stack's parameters and physical ids substituted. Each such step is logged as `GAP` (in `probe-moto.deploy.log`).

Result (`probe-moto.log`): 15 PASS, 11 FAIL, `exit 3` (the probe's exit code for any local stand-in run).
- **Every Files configuration check passes:**
  - Block Public Access;
  - the policy isn't public, denies non-TLS, denies nothing else, and grants nothing outside the account;
  - `BucketOwnerEnforced`;
  - versioning with the 7-day expiries;
  - SSE-KMS with the key;
  - Object Lock off;
  - canary cleanup.
- **The Credentials checks pass:** the role's trust (PR-3) and its permissions (PR-2).
- **Also passing:** the RDS describe checks and the Cognito app-client check.

Expected failures on moto:
- **The canary and the three anonymous GETs.** moto evaluates the bucket's `DenyNonTLS` statement without any `aws:SecureTransport` value. Its `verify_condition([])` returns true, so it refuses every PutObject, even over TLS: moto.log `"PUT /shipshape-files-459b67/probe-mvwyhkfu/canary.pdf?x-id=PutObject HTTP/1.1" 403 -`. The anonymous GETs then report "no canary".
  - Diagnostic run without the bucket policy (`probe-moto-nopolicy.log`): `PASS a canary file is stored, encrypted with the bucket's KMS key` and `PASS anonymous GET of the canary answers 403`.
  - The bucket and listing GETs answer `200` there: moto doesn't model anonymous access.
- **STS refuses a preview token:** moto's STS issues credentials for any token (`200: STS issued credentials to a preview`). Only real STS can check this.
- **The four SQL checks and the plain-TCP refusal:** no database is behind moto (`ECONNREFUSED 127.0.0.1:1`).
- **The Cognito pool:** every fact matches except `managedLogin`, which moto doesn't report.

What moto's CloudFormation did with each template (exact lines):
- `storage.yaml`:
  - `CREATE_COMPLETE`, but `No Moto CloudFormation support for AWS::S3::BucketPolicy`. The bucket got only its name and encryption, with `BucketKeyEnabled` false. Public Access Block, ownership, versioning and lifecycle were dropped (`NoSuchPublicAccessBlockConfiguration`, `OwnershipControlsNotFoundError`, `NoSuchLifecycleConfiguration`).
  - The key policy was stored as a dict, so every KMS call on the key failed: `TypeError: the JSON object must be str, bytes or bytearray, not dict`.
  - All of these were applied from the template.
- `signin.yaml`: refused. `No Moto CloudFormation support for AWS::Cognito::UserPool`, then `AttributeError: 'NoneType' object has no attribute 'has_cfn_attr'` (HTTP 500 on CreateStack). The pool, domain and client were created from the template. The managed-login style was not created, because no probe check reads it.
- `app-role.yaml`:
  - `CREATE_COMPLETE`, but `No Moto CloudFormation support for AWS::IAM::OIDCProvider`, so the provider was created with `create_open_id_connect_provider` from the template.
  - moto left `"Federated": "${VercelOidcProvider}"` unresolved in the trust policy, and stored the inline policy as a Python repr instead of JSON. Both were re-put from the template.
- `database.yaml`: refused. `Template error: resource DBInstance does not support attribute type Endpoint in Fn::GetAtt`. The instance and its parameter group were created from the template. The subnet group and security group were not, because the probe reads neither.

## cfn-lint

`uvx cfn-lint infra/*.yaml` (cfn-lint 1.59.0): exit 0, no errors and no warnings. With `--include-checks I` (informational) it also exits 0 with no output.

An earlier draft triggered W3691 (`Engine version '17' for engine 'postgres' is deprecated and cannot be used to create new RDS DB instances`). The `EngineVersion` parameter fixed it.
