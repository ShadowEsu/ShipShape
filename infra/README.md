# ShipShape on AWS: CloudFormation for M6

These templates create what the AWS hosting plan (`aws-plan.md`) specifies, so M6 is five reviewable `aws cloudformation deploy` runs instead of console clicks. They are the source of truth: if a console setting and a template disagree, the template wins. `scripts/probe-aws.mjs` is the acceptance test once they are deployed.

## One command

`infra/launch.sh` runs every step in "Deploy order and commands" below, from a fresh account to a probed deploy, in about 30 minutes. It prints each command before it runs it, and every line also goes to `infra/launch-<UTC time>.log` (git-ignored).

**Once, before the first run (only the account owner can do these):**
1. Create the AWS account on the **Paid plan**.
2. Turn on MFA for the root user. Create no root access keys.
3. Set up IAM Identity Center with MFA for yourself, and assign yourself this account with the `AdministratorAccess` permission set (the launch creates a role, a key, a database and a sign-in pool).

**Then, from the repo:**
1. Sign in: `aws configure sso` once (it names a profile), then `aws sso login --profile <profile>`.
2. `cp infra/launch.env.example infra/launch.env` and fill in its 8 values (2 come filled in). The example says what each one is.
3. `npm ci --ignore-scripts`, if you haven't yet: the migrations and the probe use the repo's packages. The apply refuses to run unless `package-lock.json` was last committed at least 7 days ago (aws-plan PR-4; `LAUNCH_ALLOW_YOUNG_LOCKFILE=1` overrides that, and the log records it) and `node_modules` holds exactly the lockfile's packages.
4. Dry run: `infra/launch.sh`. It checks `launch.env`, validates the templates (with `aws` when you're signed in, otherwise `uvx cfn-lint`, otherwise it says it skipped them) and prints the plan. Exit 0 means the plan is complete; exit 2 names the setting to fix.
5. Apply: `LAUNCH_APPLY=1 infra/launch.sh`.

The probe's "STS refuses a preview" check needs a preview deployment's OIDC token. With the Vercel CLI installed and the repo linked (`vercel link`), the script fetches it with `vercel env pull --environment=preview`. Otherwise, export `PROBE_PREVIEW_OIDC_TOKEN` before step 5. When the repo is linked, the script writes production secrets into the linked project, so preflight first checks the link: `.vercel/project.json` must name `VERCEL_PROJECT`, and the preview token pulled through it must have `sub` `owner:<VERCEL_TEAM>:project:<VERCEL_PROJECT>:environment:preview`, `iss` `https://oidc.vercel.com/<VERCEL_TEAM>`, and `owner_id`/`project_id` equal to the file's `orgId`/`projectId` (the file holds ids, `launch.env` holds the team slug; the token carries both). `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` in the shell are ignored, so the CLI uses that file.

| Step | What | Time |
| --- | --- | --- |
| Preflight | `aws`, Node 24, `curl`, `openssl` and `git` are there; the session is an Identity Center role (`AWSReservedSSO_…`) in `ACCOUNT_ID`, never root, an IAM user or stored keys; `package-lock.json` is 7 days old and `node_modules` matches it; a linked Vercel project is `VERCEL_PROJECT` in `VERCEL_TEAM` | under 1 minute |
| 0 | Block Public Access for the whole account, then read back (`--output json`, the signed-in account): all four on, nothing else | under 1 minute |
| 1 | `shipshape-storage`: the key and the bucket; the key's policy read back: exactly the template's one statement | about 1 minute |
| 2 | `shipshape-signin`: the user pool and the app client | about 2 minutes |
| 3 | `shipshape-app-role`: Vercel's OIDC provider and the role | about 1 minute |
| 4 | `shipshape-database`: RDS | about 15 minutes |
| 5 | `shipshape-budgets`: the 2 alarms | about 1 minute |
| | Termination protection on stacks 1-4 | under 1 minute |
| 6 | Migrations as the master user; `shipshape_app`'s password, set as a SCRAM verifier computed in the script; `DATABASE_CA_CERT` and then `DATABASE_URL` stored in Vercel or `~/.shipshape-launch` at once; one login as `shipshape_app` to prove the password; the roles check | about 1 minute |
| 7 | `scripts/probe-aws.mjs`, every variable filled in from the outputs | about 2 minutes |
| 8 | The Vercel Production variables, the app's own secrets named (never made or printed), the client secret piped into Vercel | about 2 minutes |
| | **Total** | **about 30 minutes** |

If a step stops, the `Stopped:` line says what happened and the `Fix:` line says what to do. Do that and run the same command again: finished stacks say "Up to date" and applied migrations are skipped. Step 6 gives `shipshape_app` a login password and stores it the moment it is set (before the login check, the roles check and the probe), so a later stop never strands it. Once that password exists (`shipshape_app` can already log in), the script stops at step 6 unless you add `LAUNCH_ROTATE_APP_PASSWORD=1`, because a new password means production can't open database connections until it is redeployed with the new `DATABASE_URL`. So a stop after step 6 (the login check, the roles check, the probe) is rerun with `LAUNCH_ROTATE_APP_PASSWORD=1`; on a first launch production isn't on that password yet, so there is nothing to redeploy. The `Fix:` line says so. Any other failure to read a stack's state (an expired session, throttling) stops the run too: only CloudFormation's "does not exist" counts as no stack.

No secret is printed:
- The master password goes from Secrets Manager into a variable, never to the screen or the log.
- `shipshape_app`'s password reaches node in its environment, never its arguments. The server gets only its SCRAM-SHA-256 verifier (16 random salt bytes, 4096 iterations), so neither the statement nor an error's context in the Postgres log can hold the password; `log_error_verbosity: terse` drops error context from that log as well.
- `DATABASE_CA_CERT`, `DATABASE_URL` (with `shipshape_app`'s password) and `COGNITO_CLIENT_SECRET` are piped into `vercel env add … --sensitive` when the Vercel CLI is installed and the repo is linked; the CA goes first, so production never has the RDS address without the bundle that verifies it. Otherwise the script prints the exact commands. `DATABASE_URL` then waits in `~/.shipshape-launch/DATABASE_URL`, which only you can read; the printed command deletes it. If you don't use it, delete the file yourself.
- The RDS CA bundle goes into Vercel only after its sha256 matched the one pinned in the script (piped in, or from the checked copy at `~/.shipshape-launch/rds-ca.pem`).
- At the end the script searches its log for the master password (plain and URL-encoded), the client secret, `shipshape_app`'s password and the preview token (given or pulled), and fails if it finds one.

**Afterwards:**
1. Add the variables step 8 prints in Vercel, Production only, and the app's own secrets it names: `SHIPSHAPE_SESSION_SECRET`, `SHIPSHAPE_HASH_KEY` and `CRON_SECRET` (each at least 32 characters), `SHIPSHAPE_FIELD_KEY` (32 random bytes, base64), and `CONTACT_EMAIL` when real documents are on. Then redeploy production and open `/api/health` (aws-plan "Order at M6", step 8). It passes with 200 and `"ok": true, "db": "up", "config": "ok"`; a 503 with `"config": "missing"` means a production setting is still missing.
2. Set up CloudTrail (all regions, into a separate private bucket) and GuardDuty RDS Protection yourself: these templates don't create them (see "Not in these templates").
3. Send Security the log file. They read:
   - the probe's output (step 7): every check `PASS`, exit 0;
   - the roles check (step 6): `password_encryption=scram-sha-256 rds.force_ssl=1`, `shipshape_app is a member of: anon, authenticated, service_role` and `Roles OK`;
   - the read-backs: `PASS account Block Public Access`, `PASS the file key's policy is the one storage.yaml writes`, and the preflight's `PASS node_modules matches package-lock.json` (and the `LAUNCH_ALLOW_YOUNG_LOCKFILE=1` line, if you used it).

To undo it, see "Rollback" below.

**Every later production deploy: migrations first, then the code** (Security MUST-ST1, 2026-11-02). When a release adds a migration, run `npm run migrate` against production (as the master, as in step 6) and see it applied before the new code takes traffic. The code may read what the migration adds: from `0044` on, the signing page reads `esign_open`'s `signed_name`. Code from before `0044` still runs on the migrated database (it selects its own columns), but code from `0044` on fails on an older one, and every `/s/` link breaks in both looks. From `0045` on, the redesigned document and passport link pages, `/app/saved` and the sample workspace's setup read `app.saved_items`: on a database without it they fail too. From `0046` on, the redesigned document page, `/app/people`, search (⌘K), the export and the sample workspace's setup read `app.contacts`, and fail the same way without it. From `0048` on, the daily reminder run writes `app.outbox.document_id` and Delete for good calls `app.delete_document`: on a database without them, no reminder is written and deleting fails. From `0049` on, only the email sender reads what it adds, and only with `SHIPSHAPE_EMAIL=1` ("Email"); with email off the code runs on a database without it. A future migration that the running code can't survive needs its own order, agreed with Security before the release.

| File | Creates |
| --- | --- |
| `storage.yaml` | The customer KMS key (`alias/shipshape-files`) and the private, versioned S3 bucket for files, plus its TLS-only bucket policy |
| `signin.yaml` | The Cognito user pool (Essentials tier), its managed-login domain and style, and the confidential app client |
| `app-role.yaml` | Vercel's IAM OIDC provider and the role `shipshape-prod-app`, with one inline policy |
| `database.yaml` | RDS for PostgreSQL 17 (`db.t4g.micro`, Single-AZ, 20 GB gp3), its parameter group, subnet group, security group and log group |
| `budgets.yaml` | The two budget alarms |
| `mail.yaml` | Reminder email, off until Security's GO and not run by `launch.sh`: the sender's SES domain identity (Easy DKIM), the configuration set `shipshape-mail`, and the SNS topic for bounces and complaints, subscribed to the app. See "Email" |

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
| app-role | `SenderAddress`, `SenderIdentityArn` | Default empty: no SES permission. Only when turning email on ("Email"): the sender address and mail's `IdentityArn` |
| signin | `CodesFrom`, `CodesIdentityArn` | Default empty: Cognito's own sender. Only once SES is out of the sandbox ("Email", step 8) |
| mail | `SenderAddress`, `AppUrl` | Preston's sender address (its domain becomes the identity) and `SHIPSHAPE_APP_URL` |

## Deploy order and commands

The account owner does these first. Agents can't (aws-plan, "What the owner does"):

1. Create the AWS account on the **Paid plan**. Turn on MFA for the root user and create no root access keys. Set up IAM Identity Center with MFA for himself.
2. Apply for Activate Founders with the company website and the account id. The site has to be live first, and the decision takes about 7-10 business days.
3. Approve these steps. An agent can then run them through a short-lived Identity Center session that the owner starts (`aws sso login --profile <profile>`), never with stored keys.

Then, with `AWS_PROFILE` set to that session and `AWS_REGION=us-east-1`, run these in order (`infra/launch.sh` runs them for you, with the same parameters):

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
  - `COGNITO_CLIENT_SECRET`, piped straight in so it never prints: `aws cognito-idp describe-user-pool-client --user-pool-id <id> --client-id <id> --query UserPoolClient.ClientSecret --output text | vercel env add COGNITO_CLIENT_SECRET production --sensitive`;
  - the app's own secrets, which you make yourself: `SHIPSHAPE_SESSION_SECRET`, `SHIPSHAPE_HASH_KEY` and `CRON_SECRET` (each at least 32 characters), `SHIPSHAPE_FIELD_KEY` (32 random bytes, base64), and `CONTACT_EMAIL` when real documents are on. `/api/health` answers 503 with `"config": "missing"` until every production setting is there, and 200 with `"ok": true, "db": "up", "config": "ok"` once it is.

  Previews get none of these (Security S3-1).
- **Database roles and migrations:** follow aws-plan's "Order at M6", step 8.
  - `npm run migrate` runs as the master. Its password is in the `MasterSecretArn` secret.
  - `shipshape_app` gets a machine-generated password of 32+ characters, kept only in Vercel Production (R-1).
- **Acceptance:** run `scripts/probe-aws.mjs` with the values from the outputs (its header lists every variable). It must exit 0.

## The app's look: the way back

The redesigned app is the default. If it breaks somewhere in production, set `SHIPSHAPE_UI` to exactly `v1` (lowercase, nothing else) in Vercel's Production environment and redeploy in the day's slot: every page renders the earlier look, with the same data, actions and routes. Any other value, or no value, is the redesigned app. To return to it, delete the variable and redeploy.

## Email (off until Security's GO)

Nothing here is live. Reminder email (B12) stays off until all three are there: the AWS account (the launch above), Preston's sender address, and Security's GO on the PR that turns it on (Security 2026-11-04 0715, answer 5). Off is the default: `SHIPSHAPE_EMAIL` unset, the app sends no email, the app role has no SES permission, Cognito uses its own sender (`no-reply@verificationemail.com`, which the privacy policy names), and Deadlines says email is off.

On, the daily run emails each reminder it wrote (`lib/server/mail.ts`):
- once, plain text only, through the configuration set `shipshape-mail` (no open or click tracking; SES itself suppresses addresses that bounce or complain);
- only reminders, never signing codes, and only to the account address of an owner or admin of the workspace who signed up through Cognito, never a vendor's or signer's address;
- at most 10 per account and 200 in all per 24 hours, and none over 3 days old;
- never to an address on the app's suppression list (`app.email_suppressions`, filled from SES's bounce and complaint notifications, which `POST /api/mail/events` takes only from `shipshape-mail-events` with a valid SNS signature). A failed send is retried by the next two daily runs.

To turn it on, in this order (us-east-1, the launch's Identity Center session):

```sh
# 1. The identity, configuration set and topic.
aws cloudformation deploy --region us-east-1 --stack-name shipshape-mail --template-file infra/mail.yaml \
  --parameter-overrides SenderAddress=<Preston's sender address> AppUrl=https://<app>
aws cloudformation describe-stacks --region us-east-1 --stack-name shipshape-mail --query 'Stacks[0].Outputs'

# 2. Add the three DkimRecord CNAMEs to the domain's DNS, then wait for SUCCESS.
aws sesv2 get-email-identity --region us-east-1 --email-identity <the sender's domain> --query 'DkimAttributes.Status'

# 3. Leave the sandbox: SES console, Account dashboard, "Request production access" (transactional; bounces and
#    complaints handled by the configuration set and the app's suppression list). Wait for true:
aws sesv2 get-account --region us-east-1 --query ProductionAccessEnabled

# 4. Let the app role send, as the sender only. Unnamed parameters keep their values.
aws cloudformation deploy --region us-east-1 --stack-name shipshape-app-role --template-file infra/app-role.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides SenderAddress=<the sender address> SenderIdentityArn=<mail IdentityArn>
```

5. **First, the words (Security MUST-SES1, #35):** the release that sets `SHIPSHAPE_EMAIL=1` also changes the privacy policy's "Who else handles your data" email line and the related copy (Pricing, Terms, FAQ, Deadlines: "ShipShape doesn't send email yet") to say that reminder emails go through Amazon SES, what they hold (the document's title and date), to whom (owners and admins of the workspace, at their sign-in address) and how to stop them (archive the document or clear its dates; the email says so too, `REMINDER_FOOTER`), and it bumps `TERMS_VERSION`. Security reads that diff before the variable is set. Then run `npm run migrate` against production (0049 adds the outbox's sending columns and the suppression list), and set in Vercel, Production only: `SHIPSHAPE_EMAIL=1`, `SHIPSHAPE_EMAIL_FROM=<the sender address>` and `SHIPSHAPE_SES_EVENTS_TOPIC_ARN=<mail EventsTopicArn>` (`AWS_REGION` is already there). Redeploy. `/api/health` answers 503 with `"config": "missing"` if any of them is missing or invalid.
6. Confirm the topic's subscription: it was pending since step 1 (the endpoint answered 404 while email was off). In the SNS console, open `shipshape-mail-events`, select the subscription and choose "Request confirmation"; the app confirms it itself. `aws sns list-subscriptions-by-topic --region us-east-1 --topic-arn <EventsTopicArn>` then shows a subscription ARN, not `PendingConfirmation`.
7. Run `scripts/probe-aws.mjs` again with `PROBE_SES_SENDER` and `PROBE_SES_IDENTITY_ARN` set too: the role must allow `ses:SendEmail` exactly as `app-role.yaml` writes it.
8. Sign-up codes from the sender too (a separate decision, only after step 3: in the sandbox Cognito couldn't email anyone): redeploy `shipshape-signin` with `CodesFrom="ShipShape <the sender address>" CodesIdentityArn=<mail IdentityArn>`, and in the same release change the privacy policy's sender to the address (Security answer 6). The session needs `iam:CreateServiceLinkedRole`: Cognito makes its service-linked role for SES.

To turn it off: delete `SHIPSHAPE_EMAIL` and redeploy (sending stops at once); then redeploy `shipshape-app-role` and `shipshape-signin` with the four email parameters empty (`SenderAddress= SenderIdentityArn=`, `CodesFrom= CodesIdentityArn=`), and delete the `shipshape-mail` stack (the identity, configuration set, topic and subscription go with it; nothing is retained). SES costs $0.10 per 1,000 emails; the topic's HTTPS deliveries cost pennies.

## Running production

### Watching it

`.github/workflows/uptime.yml` asks production's `/api/health` every 15 minutes, twice a minute apart before it calls a failure. It passes on 200 with `"ok": true`, `"db": "up"`, `"config": "ok"` and `"dailyRun": "current"`. A failed run is the alert: GitHub emails whoever last changed the workflow's schedule. It is off until the repository variable `SHIPSHAPE_PROD_URL` holds production's `https://` address (Settings → Secrets and variables → Actions → Variables; no secret is needed), and GitHub runs schedules only from the default branch, so it starts once `rebuild` is the default branch (or merged into it). Run it by hand from the Actions tab (`workflow_dispatch`) after setting the variable.

`"dailyRun": "overdue"` means the daily run (`/api/cron/reminders`, 15:00 UTC, `vercel.json`) has fallen behind the privacy policy's "within two days": a recorded account deletion, or a sample account the purge would take, is over 48 hours old (`dailyRunOverdue` in `lib/server/account.ts`). On a working run neither gets there: samples go after 22 hours, so even with Vercel starting the run anywhere in its hour they're gone by 46 h 59 min. It doesn't change `ok` or the status code. The run answers 500 when any of its jobs failed and logs `cron: <job> failed (<error name>)` without the error's message; Vercel lists each run under the project's Cron Jobs. A failed run leaves its work for the next day, and one failed day can already put a sample past two days, so read the log the first day it fails.

### The AI action (after Security's G4)

Off in production until Security's G4 GO and BOSS's budget say otherwise. To turn it on, add in Vercel, Production only: `SHIPSHAPE_AI` = `1` (exactly) and `ANTHROPIC_API_KEY` (sensitive, server-only, never `NEXT_PUBLIC_`), then redeploy in the day's slot. `aiEnabled()` (`lib/server/ai.ts`) needs both; `ANTHROPIC_API_KEY_FILE` works only outside production. Spending is capped in the database whatever the key allows (`AI_CAPS`: $8 a calendar month, a fifth of it a day, the sample workspaces a fifth of the month). To turn it off, delete `SHIPSHAPE_AI` and redeploy: the action says it's off, and nothing else changes.

### Restoring the database to a point in time

RDS keeps 7 days of point-in-time backups (`BackupRetentionPeriod: 7`). A restore makes a new instance; production keeps running on the old one until the swap, and anything written after the restore time exists only on the old one (export what you need from it first). **Anything deleted after the restore time comes back on the copy**, so every such deletion is done again on the copy before it takes traffic (step 4; Security MUST-R1). **A copy whose deletions can't all be done again is never swapped in.** us-east-1, as the account owner; the subnet group, security group and parameter group names are in the `shipshape-database` stack's resources.

```sh
aws rds describe-db-instances --region us-east-1 --db-instance-identifier shipshape-prod \
  --query 'DBInstances[0].[EarliestRestorableTime,LatestRestorableTime]'

# 1. A copy as it was at the chosen time (UTC). Encryption and its key come from the source.
aws rds restore-db-instance-to-point-in-time --region us-east-1 \
  --source-db-instance-identifier shipshape-prod --target-db-instance-identifier shipshape-restore \
  --restore-time 2026-01-01T00:00:00Z \
  --db-instance-class db.t4g.micro --no-multi-az --storage-type gp3 --publicly-accessible \
  --db-subnet-group-name <DatabaseSubnets> --vpc-security-group-ids <DatabaseSecurityGroup> \
  --db-parameter-group-name <DatabaseParameters> \
  --deletion-protection --copy-tags-to-snapshot --enable-cloudwatch-logs-exports postgresql
aws rds wait db-instance-available --region us-east-1 --db-instance-identifier shipshape-restore

# 2. Its own master password in Secrets Manager (the restore can't set that for Postgres).
aws rds modify-db-instance --region us-east-1 --db-instance-identifier shipshape-restore --manage-master-user-password --apply-immediately
```

3. Check the copy before production uses it: as the master, `npm run migrate` against it (a migration applied after the restore time is applied again), then in `psql` as the master, inside `begin; set local role shipshape_owner; … rollback;`, count a few rows you expect and run `select app.audit_verify('<org id>')` for an affected workspace. `shipshape_app`'s password lives inside the database, so production's `DATABASE_URL` works on the copy unchanged.
4. Do every deletion again on the copy (Security MUST-R1). The copy holds rows the old instance no longer has, and those are exactly what was deleted after the restore time: accounts (by their owner or the daily run, sample accounts included), documents deleted for good (from `0048` on), files vendors sent that a workspace deleted, people deleted from People, and waitlist addresses removed on request. Their stored files are already gone from the bucket, so this removes rows only; a path the copy queues for removal is cleared by the next daily run (removal is idempotent).
   1. List them. Work in a folder only you can read under your home (`mkdir -m 700 ~/shipshape-restore && cd ~/shipshape-restore`), never `/tmp`: the files hold account ids and waitlist addresses. On each instance, as the master in `psql` inside `begin; set local role shipshape_owner; … rollback;` (old = `shipshape-prod`, copy = `shipshape-restore`), write the same six sorted files, `-old` from the old instance and `-copy` from the copy:
      ```sql
      \copy (select id from auth.users order by 1) to 'users-old.txt'
      \copy (select id from app.organizations order by 1) to 'orgs-old.txt'
      \copy (select id || ' ' || org_id from app.documents order by 1) to 'docs-old.txt'
      \copy (select id || ' ' || org_id from app.vendor_files order by 1) to 'vendorfiles-old.txt'
      \copy (select id || ' ' || org_id from app.contacts order by 1) to 'contacts-old.txt'
      \copy (select email from app.waitlist order by 1) to 'waitlist-old.txt'
      ```
      Then, for each of the six, `comm -23 <name>-copy.txt <name>-old.txt > <name>-gone.txt`. A document, vendor file or person whose workspace is in `orgs-gone.txt` went with that workspace: step 2 takes it.
   2. Accounts: for each id in `users-gone.txt`, on the copy, connected as `shipshape_app` (production's `DATABASE_URL` with the copy's host: the request roles belong to that login, not to the master), the account deletion the app runs (`lib/server/account.ts` deleteRows). It names every workspace the person owned as handled, because their subscriptions were already cancelled when the account went:
      ```sql
      begin;
      set local role authenticated;
      select set_config('request.jwt.claims', json_build_object('sub', '<user id>', 'role', 'authenticated')::text, true);
      select storage_path from app.delete_my_account(array(select org_id from app.members where user_id = '<user id>' and role = 'owner'));
      commit;
      ```
   3. The rest, the same way (as `shipshape_app`, `set local role authenticated`, the claims of an owner of that workspace on the copy: `select user_id from app.members where org_id = '<org id>' and role = 'owner' limit 1`), for each line whose workspace isn't in `orgs-gone.txt`:
      - a document: `update app.documents set status = 'archived' where id = '<document id>' and org_id = '<org id>';` then `select storage_path from app.delete_document('<org id>', '<document id>');`. It can't refuse for a signature: a signed document couldn't have been deleted, and a signature is never undone;
      - a vendor file: `delete from app.vendor_files where id = '<file id>' and org_id = '<org id>';` (what `deleteVendorFile` does);
      - a person: `delete from app.contacts where id = '<contact id>' and org_id = '<org id>';` (what People's delete does);
      - a waitlist address, as the master with `set local role shipshape_owner` instead: `delete from app.waitlist where email = '<address>';`.
   4. List the copy again and compare: every `-gone` file must now be empty, except documents, vendor files and people whose workspace is in the old `orgs-gone.txt`. **Anything left is a deletion this runbook doesn't cover: stop, and don't swap.**
   5. Sign everyone out on the copy. A "Sign out on every device" or a suspension after the restore time is undone on the copy, so its sessions would work again. As the master with `set local role shipshape_owner`: `insert into app.session_revocations (user_id, valid_after) select id, now() from auth.users on conflict (user_id) do update set valid_after = excluded.valid_after;` and `update app.sessions set revoked_at = now() where revoked_at is null;`. Everyone signs in again once; Cognito's own disables and sign-outs live outside the database and still hold.
   6. Payments: in Stripe's Dashboard (Developers, Webhooks, ShipShape's endpoint), resend every event after the restore time once the swap is done, so plans and statuses match what Stripe charged. The webhook is idempotent (`app.stripe_events`), so a repeat does nothing.
5. Swap. Production is down from the first rename until the second finishes (a few minutes). Between them, with nothing writing to the old instance any more, do step 4 once more for anything deleted since you first listed it (connect to the old one by its new name). The second rename gives the copy the old name, so its address, `DATABASE_URL`, the log group and the stack's `InstanceIdentifier` are the same as before:

```sh
aws rds modify-db-instance --region us-east-1 --db-instance-identifier shipshape-prod --new-db-instance-identifier shipshape-prod-old --apply-immediately
aws rds wait db-instance-available --region us-east-1 --db-instance-identifier shipshape-prod-old
# Step 4 again, old = shipshape-prod-old, then:
aws rds modify-db-instance --region us-east-1 --db-instance-identifier shipshape-restore --new-db-instance-identifier shipshape-prod --apply-immediately
aws rds wait db-instance-available --region us-east-1 --db-instance-identifier shipshape-prod
```

6. Open `/api/health` (200, `"db": "up"`), then run `scripts/probe-aws.mjs` as at launch. Run the daily run once by hand (`curl -H "Authorization: Bearer $CRON_SECRET" <production>/api/cron/reminders`) so the queued paths clear. The stack's `MasterSecretArn` output now names the old instance's secret; the master's secret is the one `describe-db-instances` shows under `MasterUserSecret`.
7. Delete `shipshape-prod-old` within 7 days (BOSS rule 1: no copy outlives them), as in Rollback step 2 with its new name, and the log group `/aws/rds/instance/shipshape-restore/postgresql`, which the copy wrote to before its rename. Delete the step 4 folder as soon as the swap is checked (`rm -rf ~/shipshape-restore`).

### Suspending an account

For an account that breaks the terms or puts others at risk (Terms, "The service"). It stops new sign-ins and ends every session at once; nothing is deleted, and the workspace's passport links keep working unless you also turn them off. Find the person's ids, as the master in `psql`, acting as the owner role (it owns every table, so it reads every row):

```sql
begin; set local role shipshape_owner;
select u.id, i.subject from auth.users u join app.identities i on i.user_id = u.id where u.email = '<address>';
rollback;
```

Then, in this order, so no new session starts while the old ones end:

```sh
# 1. Cognito: no new sign-in, and its own tokens revoked. The pool's user name is looked up by the sub.
name=$(aws cognito-idp list-users --region us-east-1 --user-pool-id <UserPoolId> --filter 'sub = "<subject>"' --query 'Users[0].Username' --output text)
aws cognito-idp admin-disable-user --region us-east-1 --user-pool-id <UserPoolId> --username "$name"
aws cognito-idp admin-user-global-sign-out --region us-east-1 --user-pool-id <UserPoolId> --username "$name"
```

```sql
-- 2. ShipShape's own sessions: the watermark refuses every older cookie (0029), and each live row is marked signed out (0036).
begin; set local role shipshape_owner;
insert into app.session_revocations (user_id, valid_after) values ('<id>', now())
on conflict (user_id) do update set valid_after = greatest(app.session_revocations.valid_after, excluded.valid_after);
update app.sessions set revoked_at = now() where user_id = '<id>' and revoked_at is null;
commit;
```

Tell the person why where you can (the Terms promise it), from the support address. To lift it: `aws cognito-idp admin-enable-user` with the same name; they sign in again as usual. A paid subscription keeps running while suspended: cancel or refund it in Stripe's dashboard if the suspension is final (the webhook moves the workspace to Free).

## Rollback

Deleting a stack never deletes data. The key, bucket, pool, database and log group have `DeletionPolicy: Retain`, so they stay behind:

| Stack | Stays behind | Goes with the stack |
| --- | --- | --- |
| `shipshape-storage` | The KMS key; the bucket and every file in it | The key alias, the bucket policy |
| `shipshape-signin` | The user pool and its accounts (the pool also has its own deletion protection) | The managed-login domain and style, the app client |
| `shipshape-app-role` | Nothing | The OIDC provider, the role |
| `shipshape-database` | The RDS instance (also deletion protection) and its log group | The parameter group, subnet group and security group, but only once the instance is gone: while it uses them, the stack's delete fails |
| `shipshape-budgets` | Nothing | Both budgets |
| `shipshape-mail` (only if email was turned on) | Nothing | The SES identity, the configuration set, the topic and its subscription |

To remove everything, in this order (us-east-1; the ids are in each stack's outputs):

```sh
# 1. Let the stacks be deleted.
for s in shipshape-storage shipshape-signin shipshape-app-role shipshape-database; do
  aws cloudformation update-termination-protection --region us-east-1 --no-enable-termination-protection --stack-name "$s"; done

# 2. The database first. Deleting the instance also deletes its master secret.
aws rds modify-db-instance --region us-east-1 --db-instance-identifier shipshape-prod --no-deletion-protection --apply-immediately
aws rds delete-db-instance --region us-east-1 --db-instance-identifier shipshape-prod --skip-final-snapshot --delete-automated-backups
aws rds wait db-instance-deleted --region us-east-1 --db-instance-identifier shipshape-prod
aws cloudformation delete-stack --region us-east-1 --stack-name shipshape-database
aws logs delete-log-group --region us-east-1 --log-group-name /aws/rds/instance/shipshape-prod/postgresql

# 3. Budgets and the app role go with their stacks.
aws cloudformation delete-stack --region us-east-1 --stack-name shipshape-budgets
aws cloudformation delete-stack --region us-east-1 --stack-name shipshape-app-role

# 4. Sign-in. update-user-pool resets the pool's other settings, which doesn't matter for a pool being deleted.
aws cloudformation delete-stack --region us-east-1 --stack-name shipshape-signin
aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name shipshape-signin
aws cognito-idp update-user-pool --region us-east-1 --user-pool-id <UserPoolId> --deletion-protection INACTIVE
aws cognito-idp delete-user-pool --region us-east-1 --user-pool-id <UserPoolId>

# 5. Files. Empty the bucket in the S3 console first: its Empty button removes every version.
aws cloudformation delete-stack --region us-east-1 --stack-name shipshape-storage
aws s3api delete-bucket --region us-east-1 --bucket shipshape-files-<account id>
aws kms schedule-key-deletion --region us-east-1 --key-id <KeyArn> --pending-window-in-days 7
```

The account-level Block Public Access (step 0) can stay on; it costs nothing.

Cost per day if it's left up (us-east-1 on-demand, from aws-plan's cost table plus the master secret):

| Left up | About per day |
| --- | --- |
| Everything | $0.63 ($19 a month): the instance $0.38, its public IPv4 address $0.12, 20 GB of storage $0.08, the key $0.03, the master secret in Secrets Manager $0.01 |
| After deleting only the stacks (the instance still runs) | The same $0.63: what the stacks delete costs nothing |
| The key, bucket, pool and log group (database deleted by hand) | $0.03 for the key, plus pennies for any stored files and logs; a pool with no active users is free |
| Nothing | $0 |

### Undoing a migration

Applied migrations never change. A migration with a down file in `supabase/rollback/` (`NNNN_name.down.sql`; the runner reads only `supabase/migrations/`) is undone as the owner, then forgotten by deleting its row from `meta.migrations` (where `lib/server/migrations.ts` records each applied file, by file name), in one transaction. As the master user, in `psql`:

```sql
begin;
set local role shipshape_owner;
\i supabase/rollback/0046_contacts.down.sql
delete from meta.migrations where name = '0046_contacts.sql';
commit;
```

The next `npm run migrate` applies it again. Undo only the newest applied migration this way: an older one would then sort before an applied one, and the run refuses that unless `--allow-late` names it. `tests/saved.test.ts` proves down then up for 0045 on PGlite.

`0046_contacts.down.sql` (People) drops `app.contacts` and its two trigger functions; every contact goes with it, so export the workspace first (`contacts.csv`) to keep them. `tests/people.test.ts` proves down then up for 0046 on PGlite.

`0047_audit_request_about.down.sql` (History names a request's signer) puts back 0015's audit trigger function, so new signature-request rows are about the document only again. Rows written meanwhile keep their `about` and their hashes, which cover it, so `app.audit_verify` still passes. `tests/activity.test.ts` proves down then up for 0047 on PGlite.

`0048_delete_document.down.sql` (Delete for good) drops `app.delete_document`, puts back 0039's `esign_issue_code` and the outbox without `document_id`, and gives signed-in owners and admins their direct delete on `app.documents` back (0001's grant and policy). Documents already deleted stay deleted, with their History rows; files still queued in `app.storage_cleanup` stay queued for the daily run. `tests/delete-document.test.ts` proves down then up for 0048 on PGlite.

`0049_email_sending.down.sql` (reminder email) drops `app.email_suppressions` and the outbox's sending columns (`claimed_at`, `sent_at`, `attempts`, `last_error`, `ses_message_id`). Turn email off first: the sender reads them. The outbox rows stay. `tests/mail.test.ts` proves down then up for 0049 on PGlite.

## Not in these templates (operator or the account owner, at M6)

| Item | Why it isn't here | Source |
| --- | --- | --- |
| Account-level Block Public Access | Not a CloudFormation resource. Step 0 above sets it; `launch.sh` reads it back for the signed-in account (`--output json`, all four on and nothing else, or the run fails) | aws-plan S3 row |
| CloudTrail, all regions, into a separate private bucket | aws-plan lists it under Audit. It isn't one of these five templates | aws-plan Audit row |
| GuardDuty RDS Protection | Account-wide, and it costs money after the trial. aws-plan says to check that cost at setup | R-4 (SHOULD) |
| SES production access | It's a support request ("Email", step 3). Production email stays off until BOSS and Security say go | aws-plan Email row |
| IAM Identity Center, root MFA, the Paid plan, Activate | account owner only | aws-plan "What the owner does" |
| The database's roles and `shipshape_app`'s password | They live in SQL (`plain-postgres.sql`, `npm run migrate`), not in AWS resources. `launch.sh` sets the password as a SCRAM-SHA-256 verifier it computes (`scripts/launch-checks.ts`), then logs in once as `shipshape_app` to prove it | R-1, R-2, BOSS rule 2 |

## Requirement → template

| Requirement | Source | Where |
| --- | --- | --- |
| us-east-1 only | aws-plan Region | Every command uses `--region us-east-1`. The budgets are global, created from us-east-1 |
| Block Public Access, all four, on the bucket | aws-plan S3; probe "Block Public Access" | `storage.yaml` `FilesBucket.PublicAccessBlockConfiguration` |
| ACLs off (`BucketOwnerEnforced`) | aws-plan S3; probe "ACLs are off" | `FilesBucket.OwnershipControls` |
| Versioning on | aws-plan S3; probe "versioning is on" | `FilesBucket.VersioningConfiguration.Status: Enabled` |
| Noncurrent versions expire after 7 days | BOSS rule 1; probe "versioning…go within 7 days" | `FilesBucket.LifecycleConfiguration.Rules[deleted-data-7-days].NoncurrentVersionExpiration.NoncurrentDays: 7`, with no `NewerNoncurrentVersions` (which would keep that many old versions forever). The rule has no filter, so it covers the whole bucket; the probe counts only rules with no filter or an empty prefix (no other prefix, tags, sizes or `And`) |
| Expired delete markers removed | BOSS rule 1; same probe line | Same rule, `ExpiredObjectDeleteMarker: true` |
| Incomplete multipart uploads aborted after 1 day | aws-plan S3; same probe line (within 7 days) | Same rule, `AbortIncompleteMultipartUpload.DaysAfterInitiation: 1` |
| SSE-KMS by default with the customer key | aws-plan S3; probe "default encryption is SSE-KMS with the key", "canary…encrypted with the bucket's KMS key" | `FilesBucket.BucketEncryption…SSEAlgorithm: aws:kms`, `KMSMasterKeyID: !GetAtt FileKey.Arn`. The ARN, because the probe compares it with `PROBE_KMS_KEY_ARN` |
| S3 Bucket Keys | aws-plan S3 and cost table | `BucketEncryption…BucketKeyEnabled: true` |
| Object Lock off | BOSS rule 1; probe "Object Lock is off" | `FilesBucket` has no `ObjectLockEnabled` or `ObjectLockConfiguration` |
| The policy denies non-TLS | aws-plan bucket policy; probe "denies every request that isn't TLS" | `FilesBucketPolicy` `DenyNonTLS`: `Principal: "*"`, `s3:*`, the bucket and `/*`, `Bool aws:SecureTransport "false"` |
| …and denies nothing else | probe "denies nothing else" (P-b0a) | `FilesBucketPolicy` has one statement |
| The policy isn't public and grants nothing outside the account | probe "isn't public", "grants nothing…outside" (canonical users, services, federated users, `*` and a `NotPrincipal` count as outside) | `FilesBucketPolicy` has no Allow statement |
| Anonymous canary, bucket and listing GETs answer 403 | Security 0158 | Block Public Access, `BucketOwnerEnforced`, and no Allow in the policy |
| One customer key, rotated yearly | aws-plan cost table; `launch.sh` key-policy read-back | `FileKey` (`EnableKeyRotation: true`). Its key policy is one statement: the account root, `kms:*`, on `*`. So any principal in the account whose own IAM policy grants it the key can use it: an exposure Security accepted (W12-11), narrowed for the app role by `kms:ViaService`. `launch.sh` reads the policy back after step 1 (`--output json`) and fails on anything else: another statement, `"AWS": "*"`, another account, a service, a condition |
| RDS storage encrypted with the key | aws-plan RDS; probe "RDS: storage encrypted with the key" (`KmsKeyId` = `PROBE_KMS_KEY_ARN`, so the default `aws/rds` key fails) | `database.yaml` `Database.StorageEncrypted: true`, `KmsKeyId: FileKeyArn` (the plan prices one key) |
| PostgreSQL 17, `db.t4g.micro`, Single-AZ, 20 GB gp3 | aws-plan RDS | `Database.Engine: postgres`, `EngineVersion` (pattern `17.x`), `DBInstanceClass`, `MultiAZ: false`, `AllocatedStorage: "20"`, `StorageType: gp3` |
| 7 days of automated backups (PITR) | aws-plan RDS, BOSS rule 1; probe "7 days of backups" | `Database.BackupRetentionPeriod: 7` |
| Deletion protection | aws-plan RDS; probe | `Database.DeletionProtection: true` |
| No manual snapshot past 7 days | BOSS rule 1; probe "no manual snapshot older than 7 days" | `Database` `DeletionPolicy: Retain`, so CloudFormation's default `Snapshot` never makes a final snapshot |
| No manual snapshot shared | probe "no manual snapshot is shared" (each one's `restore` attribute names no account and not `all`) | Nothing in the templates shares one |
| `rds.force_ssl=1` | R-3; aws-plan RDS | `DatabaseParameters.Parameters.rds.force_ssl: "1"` |
| SCRAM only, `password_encryption=scram-sha-256` | R-3; aws-plan reachability row | `DatabaseParameters`: `password_encryption: scram-sha-256`, `rds.accepted_password_auth_method: scram` |
| `PubliclyAccessible=true` (Security ACCEPTED) | aws-plan reachability row | `Database.PubliclyAccessible: true` |
| Security group on 5432 only | aws-plan reachability row | `DatabaseSecurityGroup`: one ingress rule, tcp 5432 |
| The master password managed by RDS in Secrets Manager | R-2 | `Database.ManageMasterUserPassword: true`, `MasterUsername: postgres` (output `MasterSecretArn`) |
| `log_connections`, `log_disconnections` | R-4 | `DatabaseParameters`: both `"1"` |
| No values in the exported log: terse errors, no full statement logging | W12-10; probe "the parameter group logs no statement in full… and logs errors tersely" | `DatabaseParameters`: `log_error_verbosity: terse` (no CONTEXT, DETAIL or HINT lines); `log_statement` left at its default (`none`), and the probe fails if it is `all` |
| Failed-auth logs exported to CloudWatch | R-4 | `Database.EnableCloudwatchLogsExports: [postgresql]`. `DatabaseLog` sets its retention |
| Automatic minor version upgrades | R-4 | `Database.AutoMinorVersionUpgrade: true` |
| OIDC provider for `https://oidc.vercel.com/<team>` | aws-plan Credentials | `app-role.yaml` `VercelOidcProvider.Url`, `ClientIdList: [Audience]` |
| Role `shipshape-prod-app` | aws-plan IAM drafts | `AppRole.RoleName` |
| Trust: exactly the provider, `aud` and the production `sub`, with `StringEquals` only | S3-1; probe PR-3 | `AppRole.AssumeRolePolicyDocument`: one statement, `Federated: <provider ARN>`, `sts:AssumeRoleWithWebIdentity`, `StringEquals` on `oidc.vercel.com/<team>:aud` and `:sub`. It's a `!Sub` JSON string because the condition keys contain the team |
| A preview token is refused | S3-1; probe "STS refuses this project's preview token" | The `sub` holds `environment:production` only, enforced by the `ProductionSub` pattern. Only real STS can prove it, at M6. The probe first decodes the token (no signature check) and requires `iss` `https://oidc.vercel.com/<team>`, `aud` `PROBE_OIDC_AUD` and `sub` `PROBE_PRODUCTION_SUB` with `environment:preview`: another project's token would be refused too, proving nothing |
| S3 Put/Get/DeleteObject on `<bucket>/*` | IAM drafts `Files`; probe PR-2 | `AppRole.Policies[app]`, Sid `Files` |
| `s3:ListBucket` on the bucket, only under a workspace's `<org id>/` prefix (the daily sweep of a deleted workspace's files, W11-7; telling a missing file from a refused one, W12-1) | aws-plan TO-1; probe PR-2 (exactly this condition) | Sid `SweepDeletedWorkspace`, `Condition: StringLike s3:prefix "????????-????-????-????-????????????/*"`. Any one workspace's keys, one prefix per call: listing `<org id>/` already returned every key under it. The app checks the exact id shape before it lists (`assertWorkspacePrefix`) |
| `kms:GenerateDataKey` and `kms:Decrypt` on the one key, only through S3 | IAM drafts `FileKey`; W12-11; probe PR-2 (exactly this condition) | Sid `FileKey`, `Resource: FileKeyArn`, `Condition: StringEquals kms:ViaService "s3.${AWS::Region}.amazonaws.com"` (the app uses the key only through SSE-KMS) |
| `cognito-idp:AdminDeleteUser` on the one pool | IAM drafts `DeleteAccounts`; probe PR-2 | Sid `DeleteAccounts`, `Resource: UserPoolArn` |
| `ses:SendEmail` only, on the sender's identity and the configuration set, as the one sender; only once email is on | Security 2026-11-04 0715, answer 5; probe PR-2 with `PROBE_SES_*` (exactly this statement; without them any ses grant fails) | Sid `SendReminders`, only with `SenderAddress` and `SenderIdentityArn` set (`SendsEmail`): `Action: ses:SendEmail` (no `SendRawEmail`, `SendBulkEmail` or `ses:*`), `Resource: [SenderIdentityArn, configuration-set/shipshape-mail]`, `Condition: StringEquals ses:FromAddress SenderAddress`. `tests/probe-aws-rules.test.ts` pins the template's lines |
| Cognito email through SES only once out of the sandbox | Security answer 5 | `signin.yaml` `UserPool.EmailConfiguration`, only with `CodesFrom` and `CodesIdentityArn` set (`CodesThroughSes`): `EmailSendingAccount: DEVELOPER`, `SourceArn: CodesIdentityArn`, `ConfigurationSet: shipshape-mail`. Otherwise absent: Cognito's default sender |
| Bounces and complaints suppressed; no tracking | Security answer 5 | `mail.yaml` `MailSet.SuppressionOptions.SuppressedReasons: [BOUNCE, COMPLAINT]`, no `TrackingOptions`; `BouncesAndComplaints` publishes only `bounce` and `complaint` to `EventsTopic` (`SignatureVersion: "2"`), whose policy lets only SES, for this configuration set, publish |
| Nothing more: no other conditions, no wildcards, no managed policies, no permissions boundary | probe PR-2, P-b0a | `AppRole` has one inline policy and no `ManagedPolicyArns` or `PermissionsBoundary`. Only `SweepDeletedWorkspace`, `FileKey` and (with email on) `SendReminders` carry a condition |
| No long-lived access keys | aws-plan Credentials | No `AWS::IAM::User` or `AccessKey` anywhere |
| Pool: email sign-in, email required and auto-verified | Security 0541 M6 list; probe Cognito pool | `signin.yaml` `UserPool.UsernameAttributes: [email]`, `Schema` email `Required: true`, `AutoVerifiedAttributes: [email]` |
| An email change applies only once the new address is verified | same probe line | `UserPool.UserAttributeUpdateSettings.AttributesRequireVerificationBeforeUpdate: [email]` |
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

Result (`probe-moto.log`, a run of the probe before wave 12 added its checks): 15 PASS, 11 FAIL, `exit 3` (the probe's exit code for any local stand-in run).
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
