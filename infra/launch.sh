#!/usr/bin/env bash
# M6 on AWS in one command (infra/README.md, "One command"): from a fresh account to a probed deploy.
#
#   infra/launch.sh                  Dry run, the default: checks infra/launch.env, validates the
#                                    templates if it can, and prints every command it would run.
#   LAUNCH_APPLY=1 infra/launch.sh   Runs them: account Block Public Access, the five stacks in the
#                                    README's order, migrations as the master user, shipshape_app's
#                                    password, scripts/probe-aws.mjs, then the Vercel Production env.
#
# Reruns are safe: unchanged stacks report "Up to date". Each apply gives shipshape_app a new
# password and stores it (Vercel, or ~/.shipshape-launch/DATABASE_URL) the moment it is set. Once
# the role can already log in (production is on RDS) that needs LAUNCH_ROTATE_APP_PASSWORD=1, and
# production must be redeployed afterwards. Runs only under an Identity Center session (never root,
# an IAM user or stored keys).
# Every line goes to stdout and infra/launch-<UTC stamp>.log (git-ignored). Secrets travel only in
# variables and pipes; the run fails if the log contains one.
# Exit codes: 0 done, 1 a step failed, 2 infra/launch.env is incomplete or invalid.
# LAUNCH_ENV_FILE and LAUNCH_LOG_DIR move the settings file and the log (the test uses both).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${LAUNCH_ENV_FILE:-$ROOT/infra/launch.env}"
LOG_DIR="${LAUNCH_LOG_DIR:-$ROOT/infra}"
LOG="$LOG_DIR/launch-$(date -u +%Y%m%dT%H%M%SZ).log"

# DATABASE_CA_CERT: the RDS CA bundle for us-east-1, pinned. If AWS replaces it, compare the new file
# with https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html and update the hash.
RDS_CA_URL="https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem"
RDS_CA_SHA256="b1711d12bae51838581281e23b6cb97b1074016873b4dafc80ed14002462dd77"

# The 8 settings in infra/launch.env (infra/launch.env.example explains each).
KEYS="AWS_PROFILE ACCOUNT_ID AWS_REGION APP_URL VERCEL_TEAM VERCEL_PROJECT COGNITO_DOMAIN_PREFIX ALERT_EMAIL"

# Reads the RDS master secret (JSON) on stdin. Prints the password, or with DB_HOST set, the master's
# connection string. Never echoes its input, even when it can't parse it.
MASTER_SECRET_JS='let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let j = null;
  try { j = JSON.parse(s); } catch {}
  if (!j || typeof j.username !== "string" || typeof j.password !== "string") {
    console.error("The master secret is not the JSON RDS writes (username and password).");
    process.exit(1);
  }
  const host = process.env.DB_HOST;
  process.stdout.write(host ? `postgres://${encodeURIComponent(j.username)}:${encodeURIComponent(j.password)}@${host}:5432/shipshape` : j.password);
});'

APPLY=0
if [ "${LAUNCH_APPLY:-}" = 1 ]; then APPLY=1; fi
for arg in "$@"; do
  case "$arg" in
    --dry-run) APPLY=0 ;;
    -h | --help) sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'Unknown option %s. Run infra/launch.sh --dry-run to see the plan.\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
# One line on what stopped the run, one on what fixes it.
fail() { printf 'Stopped: %s\nFix: %s\n' "$1" "$2" >&2; exit 1; }
# Step 6 gives shipshape_app a login password, and the rotation guard keys on "can already log in": a stop after
# step 6 can only be rerun with the flag. On a first launch production isn't on that password, so nothing to redeploy.
RERUN_AFTER_6="Rerun with LAUNCH_ROTATE_APP_PASSWORD=1 (step 6 already set a password; if production is live on it, redeploy production after)."
step() { say ""; say "== $*"; }
rel() { case "$1" in "$ROOT"/*) printf '%s' "${1#"$ROOT"/}" ;; *) printf '%s' "$1" ;; esac; }
# An argument as the plan shows it: placeholders as they are, anything unusual in single quotes.
shown() {
  case "$1" in
    *'<from '*) printf '%s' "$1" ;;
    '' | *[!A-Za-z0-9_./:=,@%+-]*) printf "'%s'" "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}
show() {
  local line="  \$" a
  for a in "$@"; do line="$line $(shown "$a")"; done
  say "$line"
}
# Prints the command; runs it only when applying.
run() {
  show "$@"
  if [ "$APPLY" = 1 ]; then "$@"; fi
}
# Prints the command; when applying, keeps its output in REPLY (in the dry run, where it comes from).
fetch() {
  show "$@"
  if [ "$APPLY" = 1 ]; then REPLY="$("$@")"; else REPLY="<from $1 $2 $3>"; fi
}

# ---- infra/launch.env -----------------------------------------------------------------------------

PROBLEMS=""
problem() { PROBLEMS="${PROBLEMS}launch.env: $1"$'\n'; }
check() {
  local key="$1" re="$2" want="$3" value
  value="${!key:-}"
  if [ -z "$value" ]; then
    problem "$key is missing. Add $key=$want."
  elif ! [[ $value =~ $re ]]; then
    problem "$key=$value isn't valid. It should be $want."
  fi
}
load_env() {
  local line key value k
  # Only the file counts: a value left over in the shell doesn't fill a missing line.
  for k in $KEYS; do unset "$k"; done
  if [ ! -f "$ENV_FILE" ]; then
    PROBLEMS="There is no $(rel "$ENV_FILE"). Copy infra/launch.env.example to infra/launch.env and fill in its 8 values."$'\n'
    return 0
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in '' | '#'*) continue ;; esac
    if [ "${line#*=}" = "$line" ]; then problem "the line \"$line\" isn't KEY=value."; continue; fi
    key="${line%%=*}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in \"*\" | \'*\') value="${value:1:${#value}-2}" ;; esac
    case " $KEYS " in
      *" $key "*) printf -v "$key" '%s' "$value" ;;
      *) problem "$key isn't a setting launch.sh reads. Check its spelling against infra/launch.env.example." ;;
    esac
  done <"$ENV_FILE"

  check AWS_PROFILE '^[A-Za-z0-9._-]+$' "the profile you sign in with (aws sso login --profile NAME)"
  check ACCOUNT_ID '^[0-9]{12}$' "your 12-digit AWS account id"
  check AWS_REGION '^[a-z]{2}(-[a-z]+)+-[0-9]+$' "us-east-1"
  if [[ ${AWS_REGION:-} =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] && [ "$AWS_REGION" != us-east-1 ]; then
    problem "AWS_REGION=$AWS_REGION isn't supported. Set AWS_REGION=us-east-1: the plan, the templates and the pinned database certificate are for us-east-1 only."
  fi
  check APP_URL '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' \
    "the production address, like https://app.example.com (https, lowercase, no path or trailing slash)"
  check VERCEL_TEAM '^[a-z0-9][a-z0-9_-]*$' "your Vercel team slug, as in vercel.com/your-team"
  check VERCEL_PROJECT '^[a-z0-9][a-z0-9._-]*$' "the Vercel project's name, like shipshape"
  check COGNITO_DOMAIN_PREFIX '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' \
    "the sign-in page's address prefix: lowercase letters, digits and hyphens, like shipshape-signin"
  case "${COGNITO_DOMAIN_PREFIX:-}" in
    *aws* | *amazon* | *cognito*) problem "COGNITO_DOMAIN_PREFIX=$COGNITO_DOMAIN_PREFIX can't contain aws, amazon or cognito (AWS reserves them). Pick another prefix." ;;
  esac
  check ALERT_EMAIL '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' "the address that gets the budget alarms"
  return 0
}

# ---- AWS helpers ----------------------------------------------------------------------------------

stack_status() {
  aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true
}
# deploy <stack> <template> <extra deploy arguments...>
deploy() {
  local stack="$1" template="$2" status
  shift 2
  if [ "$APPLY" = 1 ]; then
    status="$(stack_status "$stack")"
    case "$status" in
      ROLLBACK_COMPLETE) fail "$stack failed to create on an earlier run, and CloudFormation can't update it." \
        "Delete it (aws cloudformation delete-stack --region $AWS_REGION --stack-name $stack; see Rollback in infra/README.md for what it leaves behind), then rerun." ;;
      *_IN_PROGRESS) fail "$stack is busy ($status)." "Wait until it finishes in the CloudFormation console, then rerun." ;;
    esac
  fi
  if ! run aws cloudformation deploy --region "$AWS_REGION" --stack-name "$stack" --template-file "infra/$template.yaml" \
    --no-fail-on-empty-changeset "$@" | tee "$WORK/deploy.out"; then
    fail "$stack didn't deploy (the error is above)." \
      "See why with aws cloudformation describe-stack-events --region $AWS_REGION --stack-name $stack --max-items 10, fix it, then rerun."
  fi
  if [ "$APPLY" = 1 ]; then
    if grep -q 'No changes to deploy' "$WORK/deploy.out"; then say "$stack: Up to date."; else say "$stack: deployed."; fi
  fi
}
# read_outputs <stack>, then output <key>: the stack's outputs (in the dry run, where they come from).
read_outputs() {
  OUT_STACK="$1"
  show aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$1" --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
  if [ "$APPLY" = 1 ]; then
    OUTPUTS="$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$1" --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text)"
  fi
}
output() {
  if [ "$APPLY" != 1 ]; then printf '<from %s output %s>' "$OUT_STACK" "$1"; return 0; fi
  local v
  v="$(printf '%s\n' "$OUTPUTS" | awk -F '\t' -v k="$1" '$1 == k { print $2 }')"
  if [ -z "$v" ]; then fail "$OUT_STACK has no output $1." "Check $OUT_STACK's Outputs tab in the CloudFormation console, then rerun."; fi
  printf '%s' "$v"
}
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{ print $1 }'; else sha256sum "$1" | awk '{ print $1 }'; fi
}
vercel_ready() { command -v vercel >/dev/null 2>&1 && [ -f "$ROOT/.vercel/project.json" ]; }

# Stores DATABASE_URL (shipshape_app's new password) the moment it exists: in Vercel Production when
# the CLI is linked, otherwise in a file only the owner can read (Security MUST-L2: a stop later in
# the run must not strand the only copy). The checked CA bundle is kept beside it for the manual step.
store_database_url() {
  mkdir -p "$HOME/.shipshape-launch"
  cp "$CA_FILE" "$HOME/.shipshape-launch/rds-ca.pem"
  if vercel_ready; then
    say "  \$ printf %s postgres://shipshape_app:<from openssl rand>@$DB_HOST:5432/shipshape | vercel env add DATABASE_URL production"
    vercel env rm DATABASE_URL production --yes >/dev/null 2>&1 || true
    if ! printf '%s' "$APP_DB_URL" | vercel env add DATABASE_URL production; then
      # Vercel refused: the file keeps the only copy of the password (Security SHOULD-L7).
      printf '%s' "$APP_DB_URL" >"$HOME/.shipshape-launch/DATABASE_URL"
      fail "Vercel didn't take DATABASE_URL. The new password is in ~/.shipshape-launch/DATABASE_URL (only you can read it)." \
        "Run: vercel env add DATABASE_URL production < ~/.shipshape-launch/DATABASE_URL && rm ~/.shipshape-launch/DATABASE_URL; then redeploy production. A later rerun needs LAUNCH_ROTATE_APP_PASSWORD=1."
    fi
    say "  DATABASE_URL is in Vercel Production."
  else
    printf '%s' "$APP_DB_URL" >"$HOME/.shipshape-launch/DATABASE_URL"
    say "  DATABASE_URL is in ~/.shipshape-launch/DATABASE_URL (only you can read it); step 8 says how to add it to Vercel."
  fi
}

# ---- the plan -------------------------------------------------------------------------------------

validate_templates() {
  step "Templates"
  local t ok=1
  if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
    for t in storage signin app-role database budgets; do
      show aws cloudformation validate-template --region "$AWS_REGION" --template-body "file://infra/$t.yaml"
      if aws cloudformation validate-template --region "$AWS_REGION" --template-body "file://infra/$t.yaml" >/dev/null; then
        say "  infra/$t.yaml: valid"
      else
        ok=0
      fi
    done
  elif command -v uvx >/dev/null 2>&1; then
    say "  aws isn't on PATH or isn't signed in, so cfn-lint checks them instead."
    show uvx cfn-lint infra/storage.yaml infra/signin.yaml infra/app-role.yaml infra/database.yaml infra/budgets.yaml
    if uvx cfn-lint infra/storage.yaml infra/signin.yaml infra/app-role.yaml infra/database.yaml infra/budgets.yaml; then
      say "  cfn-lint: no errors or warnings"
    else
      ok=0
    fi
  else
    say "  Skipped template validation: aws isn't on PATH or isn't signed in, and uvx isn't on PATH. Sign in (aws sso login --profile $AWS_PROFILE) or install uv to check them before applying."
  fi
  if [ "$ok" != 1 ]; then fail "A template didn't validate (the errors are above)." "Correct that template, then rerun infra/launch.sh --dry-run."; fi
}

preflight() {
  step "Preflight: tools, and who is signed in (under a minute)"
  local ident account arn tool major
  command -v aws >/dev/null 2>&1 || fail "The AWS CLI isn't installed (aws isn't on PATH)." \
    "Install AWS CLI v2 (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), then rerun."
  show aws sts get-caller-identity --query '[Account,Arn]' --output text
  ident="$(aws sts get-caller-identity --query '[Account,Arn]' --output text 2>/dev/null)" ||
    fail "You aren't signed in to AWS with the profile $AWS_PROFILE." "Run aws sso login --profile $AWS_PROFILE, then rerun."
  account="${ident%%[[:space:]]*}"
  arn="${ident##*[[:space:]]}"
  say "  Signed in as $arn"
  [ "$account" = "$ACCOUNT_ID" ] || fail "You're signed in to account $account, but launch.env says ACCOUNT_ID=$ACCOUNT_ID." \
    "Sign in to account $ACCOUNT_ID (aws sso login with its profile) or correct ACCOUNT_ID, then rerun."
  # Only an Identity Center session may run this (aws-plan "never with stored keys"): its ARN is an
  # assumed role named AWSReservedSSO_<permission set>_<id> in this account. Root, IAM users and
  # other roles (stored keys, credential_process) are refused before anything is read or changed.
  case "$arn" in
    *:root) fail "These are the root user's credentials, and the launch never runs as root." \
      "Sign in through Identity Center (aws sso login --profile $AWS_PROFILE) and remove any root access keys, then rerun." ;;
    "arn:aws:sts::$ACCOUNT_ID:assumed-role/AWSReservedSSO_"*) ;;
    *) fail "These credentials aren't an Identity Center session for account $ACCOUNT_ID ($arn), and the launch runs with nothing else." \
      "Sign in with aws sso login --profile $AWS_PROFILE (a profile with sso_start_url, not stored keys), and check ACCOUNT_ID in launch.env, then rerun." ;;
  esac
  : >"$WORK/signed-in"

  for tool in node curl openssl awk; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool isn't on PATH." "Install $tool, then rerun."
  done
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 24 ] || fail "Node $major is too old: the migrations need Node 24 (package.json engines)." "Install Node 24, then rerun."
  [ -d "$ROOT/node_modules/@aws-sdk/client-rds" ] && [ -d "$ROOT/node_modules/postgres" ] ||
    fail "The repo's packages aren't installed (the migrations and the probe need them)." "Run npm ci in the repo, then rerun."
  [ "${#APP_DB_PASSWORD}" -ge 32 ] || fail "shipshape_app's new password couldn't be generated." "Check that openssl rand -base64 60 works, then rerun."
  if [ -z "${PROBE_PREVIEW_OIDC_TOKEN:-}" ] && ! vercel_ready; then
    fail "The probe needs a preview deployment's OIDC token, and the Vercel CLI isn't linked here to fetch it." \
      "Export PROBE_PREVIEW_OIDC_TOKEN (a preview deployment's VERCEL_OIDC_TOKEN), or run vercel link in the repo, then rerun."
  fi
  # Checked here, before step 6 sets a password: a stop after that point needs the rotation flag to rerun.
  if [ "$APPLY" = 1 ] && [ -z "${PROBE_PREVIEW_OIDC_TOKEN:-}" ] && [ -z "$PREVIEW_TOKEN" ]; then
    fail "vercel env pull returned no VERCEL_OIDC_TOKEN for previews (the probe in step 7 needs it)." \
      "Export PROBE_PREVIEW_OIDC_TOKEN (a preview deployment's VERCEL_OIDC_TOKEN), then rerun."
  fi
  say "  Tools found: aws, node $major, curl, openssl. Account $ACCOUNT_ID, an Identity Center session."
}

main() {
  set -euo pipefail
  cd "$ROOT"
  if [ "$APPLY" = 1 ]; then
    say "ShipShape launch: applying. This takes about 30 minutes."
  else
    say "ShipShape launch, dry run: nothing changes. To apply: LAUNCH_APPLY=1 infra/launch.sh"
  fi
  say "Log: $(rel "$LOG")"
  if [ -n "$PROBLEMS" ]; then
    say ""
    printf '%s' "$PROBLEMS"
    say "Fix those lines in $(rel "$ENV_FILE"), then rerun infra/launch.sh --dry-run."
    exit 2
  fi

  local R="$AWS_REGION" BUCKET="shipshape-files-$ACCOUNT_ID" AUDIENCE="https://vercel.com/$VERCEL_TEAM"
  local SUB="owner:$VERCEL_TEAM:project:$VERCEL_PROJECT:environment:production"
  local CA_FILE="$WORK/rds-ca.pem" CA="" MASTER_URL="" TOKEN="" TOKEN_FROM s
  local BUCKET_OUT KEY_ARN POOL_ID POOL_ARN CLIENT_ID COGNITO_DOMAIN ROLE_ARN ROLE_NAME OIDC_ARN
  local DB_STATUS="" ENGINE VPC SUBNETS DB_HOST DB_INSTANCE MASTER_SECRET_ARN APP_DB_URL
  say "Settings from $(rel "$ENV_FILE"): account $ACCOUNT_ID in $R, profile $AWS_PROFILE."
  say "  App $APP_URL; Vercel team $VERCEL_TEAM, project $VERCEL_PROJECT; sign-in prefix $COGNITO_DOMAIN_PREFIX; budget alarms to $ALERT_EMAIL."

  if [ "$APPLY" = 1 ]; then preflight; else validate_templates; fi

  step "0. Block Public Access for the whole account (under a minute; CloudFormation can't set it)"
  run aws s3control put-public-access-block --region "$R" --account-id "$ACCOUNT_ID" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

  step "1. Files: shipshape-storage (about 1 minute)"
  deploy shipshape-storage storage --parameter-overrides "BucketName=$BUCKET"
  read_outputs shipshape-storage
  BUCKET_OUT="$(output BucketName)"
  KEY_ARN="$(output KeyArn)"

  step "2. Sign-in: shipshape-signin (about 2 minutes)"
  deploy shipshape-signin signin --parameter-overrides "AppUrl=$APP_URL" "DomainPrefix=$COGNITO_DOMAIN_PREFIX"
  read_outputs shipshape-signin
  POOL_ID="$(output UserPoolId)"
  POOL_ARN="$(output UserPoolArn)"
  CLIENT_ID="$(output ClientId)"
  COGNITO_DOMAIN="$(output Domain)"

  step "3. The app role: shipshape-app-role (about 1 minute; a fixed role name needs CAPABILITY_NAMED_IAM)"
  deploy shipshape-app-role app-role --capabilities CAPABILITY_NAMED_IAM --parameter-overrides \
    "VercelTeam=$VERCEL_TEAM" "Audience=$AUDIENCE" "ProductionSub=$SUB" \
    "BucketName=$BUCKET_OUT" "FileKeyArn=$KEY_ARN" "UserPoolArn=$POOL_ARN"
  read_outputs shipshape-app-role
  ROLE_ARN="$(output RoleArn)"
  ROLE_NAME="$(output RoleName)"
  OIDC_ARN="$(output OidcProviderArn)"

  step "4. The database: shipshape-database (about 15 minutes while RDS creates the instance)"
  if [ "$APPLY" = 1 ]; then DB_STATUS="$(stack_status shipshape-database)"; fi
  if [ -n "$DB_STATUS" ]; then
    say "  shipshape-database exists, so it keeps its engine version, VPC and subnets (minor upgrades are automatic)."
    deploy shipshape-database database --parameter-overrides "FileKeyArn=$KEY_ARN"
  else
    fetch aws rds describe-db-engine-versions --region "$R" --engine postgres --engine-version 17 --default-only \
      --query 'DBEngineVersions[0].EngineVersion' --output text
    ENGINE="$REPLY"
    fetch aws ec2 describe-vpcs --region "$R" --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text
    VPC="$REPLY"
    if [ "$APPLY" = 1 ] && { [ -z "$VPC" ] || [ "$VPC" = None ]; }; then
      fail "This account has no default VPC for the database." "Create it with aws ec2 create-default-vpc --region $R, then rerun."
    fi
    fetch aws ec2 describe-subnets --region "$R" --filters "Name=vpc-id,Values=$VPC" Name=default-for-az,Values=true \
      --query 'Subnets[].[AvailabilityZone,SubnetId]' --output text
    if [ "$APPLY" = 1 ]; then
      SUBNETS="$(printf '%s\n' "$REPLY" | sort | awk '!seen[$1]++ && n < 2 { printf "%s%s", (n++ ? "," : ""), $2 }')"
      case "$SUBNETS" in
        *,*) ;;
        *) fail "The default VPC has fewer than 2 subnets in different availability zones." \
          "Add one with aws ec2 create-default-subnet --region $R --availability-zone ZONE (a zone it lacks), then rerun." ;;
      esac
    else
      SUBNETS="$REPLY"
      say "  (The first subnet in each of 2 availability zones. On a rerun, when the stack exists, only FileKeyArn is passed.)"
    fi
    deploy shipshape-database database --parameter-overrides \
      "FileKeyArn=$KEY_ARN" "VpcId=$VPC" "SubnetIds=$SUBNETS" "EngineVersion=$ENGINE"
  fi
  read_outputs shipshape-database
  DB_HOST="$(output Endpoint)"
  DB_INSTANCE="$(output InstanceIdentifier)"
  MASTER_SECRET_ARN="$(output MasterSecretArn)"

  step "5. Budget alarms: shipshape-budgets (about 1 minute)"
  deploy shipshape-budgets budgets --parameter-overrides "AlertEmail=$ALERT_EMAIL"

  step "Termination protection on the 4 stacks that hold data or access (under a minute)"
  for s in shipshape-storage shipshape-signin shipshape-app-role shipshape-database; do
    run aws cloudformation update-termination-protection --region "$R" --enable-termination-protection --stack-name "$s"
  done

  step "6. Migrations and the roles check, as the master user (about 1 minute)"
  run curl -fsS "$RDS_CA_URL" -o "$CA_FILE"
  say "  The bundle's sha256 must be $RDS_CA_SHA256."
  if [ "$APPLY" = 1 ]; then
    s="$(sha256_of "$CA_FILE")"
    [ "$s" = "$RDS_CA_SHA256" ] || fail "The RDS certificate bundle changed (its sha256 is now $s)." \
      "Compare it with AWS's RDS SSL page, then update RDS_CA_SHA256 in infra/launch.sh and rerun."
    CA="$(cat "$CA_FILE")"
  fi
  show aws secretsmanager get-secret-value --region "$R" --secret-id "$MASTER_SECRET_ARN" --query SecretString --output text
  say "  The master password goes into MIGRATE_DATABASE_URL in memory and is never printed."
  if [ "$APPLY" = 1 ]; then
    MASTER_URL="$(aws secretsmanager get-secret-value --region "$R" --secret-id "$MASTER_SECRET_ARN" --query SecretString --output text |
      DB_HOST="$DB_HOST" node -e "$MASTER_SECRET_JS")"
  fi
  show "MIGRATE_DATABASE_URL=postgres://postgres:<from Secrets Manager>@$DB_HOST:5432/shipshape" \
    "DATABASE_CA_CERT=<from the pinned RDS CA bundle>" node scripts/migrate.ts
  if [ "$APPLY" = 1 ]; then
    MIGRATE_DATABASE_URL="$MASTER_URL" DATABASE_CA_CERT="$CA" node scripts/migrate.ts ||
      fail "The migrations stopped (the FAIL line above says why)." "Correct what it names, then rerun: applied migrations are skipped."
  fi
  say "  Then shipshape_app gets a login password: 40 random characters from openssl, kept in memory and then only"
  say "  in Vercel Production (R-1). An inline node script runs, as the master: alter role shipshape_app with login"
  say "  password, the password bound as a query parameter. Once production is on RDS (the role can already log in),"
  say "  the launch stops here unless LAUNCH_ROTATE_APP_PASSWORD=1: a new password means production can't open"
  say "  database connections until it is redeployed with the new value."
  if [ "$APPLY" = 1 ]; then
    if ! MASTER_URL="$MASTER_URL" DATABASE_CA_CERT="$CA" APP_DB_PASSWORD="$APP_DB_PASSWORD" ROTATE="${LAUNCH_ROTATE_APP_PASSWORD:-}" node --input-type=module <<'JS'; then
import postgres from "postgres";
const sql = postgres(process.env.MASTER_URL, {
  max: 1,
  connect_timeout: 10,
  ssl: { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT },
  onnotice: () => {},
});
try {
  const [role] = await sql`select rolcanlogin from pg_catalog.pg_roles where rolname = 'shipshape_app'`;
  if (role?.rolcanlogin && process.env.ROTATE !== "1") {
    console.error("FAIL: shipshape_app can already log in, so production may be using its password. Set LAUNCH_ROTATE_APP_PASSWORD=1 to replace it (then redeploy production), or leave the password as it is.");
    process.exitCode = 3;
  } else {
    await sql.begin(async (t) => {
      await t`select set_config('shipshape.app_password', ${process.env.APP_DB_PASSWORD}, true)`;
      await t`do $$ begin execute format('alter role shipshape_app with login password %L', current_setting('shipshape.app_password')); end $$`;
    });
    console.log(role?.rolcanlogin ? "shipshape_app has its new password (rotated: redeploy production once DATABASE_URL is updated)." : "shipshape_app has its new password.");
  }
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
JS
      fail "shipshape_app's password wasn't set (the FAIL line above says why)." "Correct what it names, then rerun."
    fi
    APP_DB_URL="postgres://shipshape_app:$APP_DB_PASSWORD@$DB_HOST:5432/shipshape"
    # The only copy of the new password is in this shell: it goes to Vercel (or the owner's file) now,
    # before the roles check and the probe, so a stop there can't strand it (Security MUST-L2).
    store_database_url
  fi
  say "  Again, for the roles check Security reads (Up to date, Roles OK, and shipshape_app's login set):"
  say "  DATABASE_URL (with the new password) is stored at once, before the roles check and the probe: in Vercel"
  say "  Production when the CLI is linked, otherwise in ~/.shipshape-launch/DATABASE_URL."
  show "MIGRATE_DATABASE_URL=postgres://postgres:<from Secrets Manager>@$DB_HOST:5432/shipshape" \
    "DATABASE_CA_CERT=<from the pinned RDS CA bundle>" node scripts/migrate.ts
  if [ "$APPLY" = 1 ]; then
    MIGRATE_DATABASE_URL="$MASTER_URL" DATABASE_CA_CERT="$CA" node scripts/migrate.ts ||
      fail "The roles check failed (the FAIL line above says which rule)." "$RERUN_AFTER_6 Fix the role in the database first."
  fi

  step "7. Acceptance: scripts/probe-aws.mjs (about 2 minutes)"
  if [ -n "${PROBE_PREVIEW_OIDC_TOKEN:-}" ]; then
    TOKEN_FROM="PROBE_PREVIEW_OIDC_TOKEN"
    TOKEN="$PROBE_PREVIEW_OIDC_TOKEN"
  else
    # Pulled by the parent shell before this plan ran (so the secret check can see it); shown here where it belongs.
    TOKEN_FROM="vercel env pull"
    show vercel env pull --environment=preview --yes "<from mktemp, deleted at once>"
    TOKEN="$PREVIEW_TOKEN"
    if [ "$APPLY" = 1 ]; then
      [ -n "$TOKEN" ] || fail "vercel env pull returned no VERCEL_OIDC_TOKEN for previews." \
        "$RERUN_AFTER_6 Export PROBE_PREVIEW_OIDC_TOKEN (a preview deployment's VERCEL_OIDC_TOKEN) first."
    fi
  fi
  show "AWS_REGION=$R" "PROBE_BUCKET=$BUCKET_OUT" "PROBE_KMS_KEY_ARN=$KEY_ARN" "PROBE_DB_INSTANCE=$DB_INSTANCE" \
    "PROBE_DATABASE_URL=postgres://shipshape_app:<from openssl rand>@$DB_HOST:5432/shipshape" \
    "DATABASE_CA_CERT=<from the pinned RDS CA bundle>" "PROBE_ROLE_NAME=$ROLE_NAME" "PROBE_PRODUCTION_SUB=$SUB" \
    "PROBE_OIDC_PROVIDER_ARN=$OIDC_ARN" "PROBE_OIDC_AUD=$AUDIENCE" "PROBE_PREVIEW_OIDC_TOKEN=<from $TOKEN_FROM>" \
    "PROBE_COGNITO_POOL_ID=$POOL_ID" "PROBE_COGNITO_CLIENT_ID=$CLIENT_ID" "PROBE_APP_URL=$APP_URL" node scripts/probe-aws.mjs
  if [ "$APPLY" = 1 ]; then
    AWS_REGION="$R" PROBE_BUCKET="$BUCKET_OUT" PROBE_KMS_KEY_ARN="$KEY_ARN" PROBE_DB_INSTANCE="$DB_INSTANCE" \
      PROBE_DATABASE_URL="$APP_DB_URL" DATABASE_CA_CERT="$CA" PROBE_ROLE_NAME="$ROLE_NAME" PROBE_PRODUCTION_SUB="$SUB" \
      PROBE_OIDC_PROVIDER_ARN="$OIDC_ARN" PROBE_OIDC_AUD="$AUDIENCE" PROBE_PREVIEW_OIDC_TOKEN="$TOKEN" \
      PROBE_COGNITO_POOL_ID="$POOL_ID" PROBE_COGNITO_CLIENT_ID="$CLIENT_ID" PROBE_APP_URL="$APP_URL" \
      node scripts/probe-aws.mjs ||
      fail "The probe found failures (the FAIL lines above)." "$RERUN_AFTER_6 Correct each FAIL first; finished steps report Up to date."
  fi

  step "8. Vercel, Production only (previews get none of these: Security S3-1; about 2 minutes)"
  say "  Add these in Vercel: the project, Settings, Environment Variables, Production only (the block can be pasted):"
  say "    AWS_REGION=$R"
  say "    AWS_ROLE_ARN=$ROLE_ARN"
  say "    SHIPSHAPE_S3_BUCKET=$BUCKET_OUT"
  say "    COGNITO_DOMAIN=$COGNITO_DOMAIN"
  say "    COGNITO_USER_POOL_ID=$POOL_ID"
  say "    COGNITO_CLIENT_ID=$CLIENT_ID"
  say "    SHIPSHAPE_APP_URL=$APP_URL"
  say "  DATABASE_CA_CERT is the RDS bundle (several lines), checked against the sha256 pinned in this script:"
  if vercel_ready; then
    say "  \$ printf %s \"<the checked bundle>\" | vercel env add DATABASE_CA_CERT production"
  else
    say "  \$ vercel env add DATABASE_CA_CERT production < ~/.shipshape-launch/rds-ca.pem"
  fi
  say "  The 2 secrets go straight into Vercel and never print:"
  say "  \$ aws cognito-idp describe-user-pool-client --region $R --user-pool-id $POOL_ID --client-id $CLIENT_ID --query UserPoolClient.ClientSecret --output text | vercel env add COGNITO_CLIENT_SECRET production"
  say "  DATABASE_URL (with shipshape_app's password) was stored in step 6, right after the password was set."
  if vercel_ready; then
    say "  vercel is installed and linked here, so launch.sh runs these (replacing old values)."
    if [ "$APPLY" = 1 ]; then
      vercel env rm DATABASE_CA_CERT production --yes >/dev/null 2>&1 || true
      printf '%s' "$CA" | vercel env add DATABASE_CA_CERT production ||
        fail "Vercel didn't take DATABASE_CA_CERT." "Run: vercel env add DATABASE_CA_CERT production < ~/.shipshape-launch/rds-ca.pem (the checked bundle; the script keeps a copy there when it can't write Vercel itself)."
      vercel env rm COGNITO_CLIENT_SECRET production --yes >/dev/null 2>&1 || true
      aws cognito-idp describe-user-pool-client --region "$R" --user-pool-id "$POOL_ID" --client-id "$CLIENT_ID" \
        --query UserPoolClient.ClientSecret --output text | vercel env add COGNITO_CLIENT_SECRET production ||
        fail "Vercel didn't take COGNITO_CLIENT_SECRET." "Run the aws ... | vercel env add COGNITO_CLIENT_SECRET production line above yourself."
    fi
  else
    say "  vercel isn't installed, or this folder isn't linked (vercel link), so you run these yourself; the checked"
    say "  bundle is at ~/.shipshape-launch/rds-ca.pem and DATABASE_URL waits in ~/.shipshape-launch/DATABASE_URL (only you can read it):"
    say "  \$ vercel env add DATABASE_URL production < ~/.shipshape-launch/DATABASE_URL && rm ~/.shipshape-launch/DATABASE_URL"
    say "  Delete that file if you don't use it."
  fi

  say ""
  if [ "$APPLY" = 1 ]; then
    say "Done: the AWS side of M6 is up, and the probe passed."
    say "The record: $(rel "$LOG") (git-ignored)."
    say "What happens next:"
    say "  1. Add the step 8 variables in Vercel (Production only), then redeploy production and open $APP_URL/api/health."
    say "  2. Send Security this log: they read the probe's output (step 7) and the roles check (step 6, Roles OK)."
  else
    say "Plan complete: nothing was changed."
    say "To run it: LAUNCH_APPLY=1 infra/launch.sh (about 30 minutes)."
  fi
}

# After the run: the log must not contain a secret this run handled. AWS secrets are read again here
# because main ran in a subshell (the pipe into the log).
guard() {
  set -uo pipefail
  if [ "$APPLY" != 1 ]; then say "Secret check: a dry run reads no secrets."; return 0; fi
  if [ ! -f "$WORK/signed-in" ]; then say "Secret check: the run stopped before reading any secret."; return 0; fi
  local arn pool cid master="" master_encoded="" client="" log found="" checked=""
  arn="$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name shipshape-database \
    --query "Stacks[0].Outputs[?OutputKey=='MasterSecretArn'].OutputValue | [0]" --output text 2>/dev/null || true)"
  if [ -n "$arn" ] && [ "$arn" != None ]; then
    master="$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$arn" --query SecretString --output text 2>/dev/null |
      node -e "$MASTER_SECRET_JS" 2>/dev/null || true)"
    # MASTER_URL carried it URL-encoded (RDS passwords hold punctuation), so that form is checked too.
    master_encoded="$(printf '%s' "$master" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(encodeURIComponent(s)));' 2>/dev/null || true)"
  fi
  pool="$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name shipshape-signin \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue | [0]" --output text 2>/dev/null || true)"
  cid="$(aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name shipshape-signin \
    --query "Stacks[0].Outputs[?OutputKey=='ClientId'].OutputValue | [0]" --output text 2>/dev/null || true)"
  if [ -n "$pool" ] && [ "$pool" != None ] && [ -n "$cid" ] && [ "$cid" != None ]; then
    client="$(aws cognito-idp describe-user-pool-client --region "$AWS_REGION" --user-pool-id "$pool" --client-id "$cid" \
      --query UserPoolClient.ClientSecret --output text 2>/dev/null || true)"
  fi
  log="$(cat "$LOG")"
  # Compared in the shell, so no secret ever appears in a process's arguments.
  check_secret() {
    if [ "${#2}" -lt 8 ]; then return 0; fi
    checked="$checked, $1"
    case "$log" in *"$2"*) found="$found, $1" ;; esac
  }
  check_secret "the master password" "$master"
  check_secret "the master password (URL-encoded)" "$master_encoded"
  check_secret "the app client secret" "$client"
  check_secret "shipshape_app's password" "$APP_DB_PASSWORD"
  check_secret "the preview OIDC token" "${PROBE_PREVIEW_OIDC_TOKEN:-}"
  check_secret "the pulled preview token" "$PREVIEW_TOKEN"
  if [ -n "$found" ]; then
    printf 'Stopped: the log contains %s.\nFix: delete %s now, never share it, and tell Security.\n' "${found#, }" "$(rel "$LOG")"
    return 1
  fi
  if [ -z "$checked" ]; then say "Secret check: no secret was read yet."; else say "Secret check: the log holds none of these: ${checked#, }."; fi
}

umask 077
load_env
if [ -z "$PROBLEMS" ]; then
  export AWS_PROFILE AWS_REGION
  export AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""
fi
# An Identity Center session only (aws-plan, "What Preston does"): stored keys in the shell would win over the profile.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN PROBE_LOCAL_ENDPOINT
mkdir -p "$LOG_DIR"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/shipshape-launch.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
APP_DB_PASSWORD=""
if [ "$APPLY" = 1 ] && [ -z "$PROBLEMS" ] && command -v openssl >/dev/null 2>&1; then
  APP_DB_PASSWORD="$(openssl rand -base64 60 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
fi
# The preview token for the probe, pulled here (not in main's subshell) so the secret check can see it.
PREVIEW_TOKEN=""
if [ "$APPLY" = 1 ] && [ -z "$PROBLEMS" ] && [ -z "${PROBE_PREVIEW_OIDC_TOKEN:-}" ] && vercel_ready; then
  if vercel env pull --environment=preview --yes "$WORK/preview.env" >/dev/null 2>&1; then
    PREVIEW_TOKEN="$(awk 'index($0, "VERCEL_OIDC_TOKEN=") == 1 { v = substr($0, 19); gsub(/^"|"$/, "", v); print v }' "$WORK/preview.env")"
  fi
  rm -f "$WORK/preview.env"
fi

set +e
main 2>&1 | tee -a "$LOG"
status=${PIPESTATUS[0]}
guard 2>&1 | tee -a "$LOG"
guard_status=${PIPESTATUS[0]}
set -e
if [ "$guard_status" != 0 ]; then exit 1; fi
exit "$status"
