import type { DBInstance } from "@aws-sdk/client-rds";
import type { LifecycleRule } from "@aws-sdk/client-s3";
import type { GetUserPoolMfaConfigCommandOutput, UserPoolType } from "@aws-sdk/client-cognito-identity-provider";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fileKeyCondition,
  lifecycleFacts,
  outsidePrincipals,
  parameterProblems,
  poolCheck,
  previewTokenProblems,
  rdsInstanceOk,
  rolePolicyProblems,
  snapshotSharing,
  SWEEP_CONDITION,
  tokenClaims,
  wholeBucket,
} from "../scripts/probe-aws-rules.ts";

// The decisions scripts/probe-aws.mjs makes about AWS's answers (W12-4, W12-5, W12-10, W12-1, W12-11).
const account = "111122223333";
const jwt = (claims: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2lnbmF0dXJl`;

describe("the preview token's claims (W12-4)", () => {
  const want = {
    issuer: "https://oidc.vercel.com/example-team",
    audience: "https://vercel.com/example-team",
    productionSub: "owner:example-team:project:shipshape:environment:production",
  };
  const preview = { iss: want.issuer, aud: want.audience, sub: "owner:example-team:project:shipshape:environment:preview" };

  it("accepts this project's preview token", () => {
    expect(previewTokenProblems(jwt(preview), want)).toEqual([]);
    expect(tokenClaims(jwt(preview))).toEqual(preview);
  });

  it.each([
    ["another project's preview", { sub: "owner:example-team:project:other:environment:preview" }, "sub is owner:example-team:project:other:environment:preview"],
    ["another team's token", { iss: "https://oidc.vercel.com/other-team" }, "iss is https://oidc.vercel.com/other-team"],
    ["another audience", { aud: "https://vercel.com/other-team" }, "aud is \"https://vercel.com/other-team\""],
    ["the production token itself", { sub: want.productionSub }, "sub is owner:example-team:project:shipshape:environment:production"],
    ["a development token", { sub: "owner:example-team:project:shipshape:environment:development" }, "sub is"],
  ])("refuses %s", (_what, change, problem) => {
    const problems = previewTokenProblems(jwt({ ...preview, ...change }), want);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(problem);
  });

  it("refuses something that isn't a JWT, without decoding it", () => {
    expect(previewTokenProblems("preview-token-for-the-test", want)).toEqual(["it isn't a JWT with a JSON payload"]);
    expect(tokenClaims("a.b.c")).toBeNull();
  });
});

describe("lifecycle rules for the whole bucket (W12-5)", () => {
  // As infra/storage.yaml writes it, and as S3 answers for a rule with no filter.
  const template: LifecycleRule = {
    ID: "deleted-data-7-days",
    Status: "Enabled",
    Filter: { Prefix: "" },
    NoncurrentVersionExpiration: { NoncurrentDays: 7 },
    Expiration: { ExpiredObjectDeleteMarker: true },
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  };

  it("counts the template's rule, with an empty prefix or no filter at all", () => {
    expect(wholeBucket(template)).toBe(true);
    expect(wholeBucket({ ...template, Filter: undefined })).toBe(true);
    expect(wholeBucket({ ...template, Filter: {} })).toBe(true);
    expect(lifecycleFacts([template])).toEqual({ versions: true, markers: true, multipart: true });
  });

  it.each<[string, Partial<LifecycleRule>]>([
    ["a prefix", { Filter: { Prefix: "probe-" } }],
    ["objects over a size", { Filter: { ObjectSizeGreaterThan: 1024 } }],
    ["objects under a size", { Filter: { ObjectSizeLessThan: 1024 } }],
    ["a tag", { Filter: { Tag: { Key: "k", Value: "v" } } }],
    ["And", { Filter: { And: { Prefix: "" } } }],
    ["the legacy prefix", { Prefix: "x/" }],
    ["a disabled rule", { Status: "Disabled" }],
  ])("doesn't count a rule limited to %s", (_what, change) => {
    const rule: LifecycleRule = { ...template, ...change };
    expect(wholeBucket(rule)).toBe(false);
    expect(lifecycleFacts([rule])).toEqual({ versions: false, markers: false, multipart: false });
  });

  it("doesn't count a rule that keeps the newest old versions forever", () => {
    const rule: LifecycleRule = { ...template, NoncurrentVersionExpiration: { NoncurrentDays: 7, NewerNoncurrentVersions: 3 } };
    expect(lifecycleFacts([rule]).versions).toBe(false);
  });

  it("needs unfinished uploads aborted within 7 days", () => {
    expect(lifecycleFacts([{ ...template, AbortIncompleteMultipartUpload: undefined }]).multipart).toBe(false);
    expect(lifecycleFacts([{ ...template, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 8 } }]).multipart).toBe(false);
  });
});

describe("bucket policy principals outside the account (W12-5)", () => {
  const allow = (Principal: unknown) => ({ Effect: "Allow", Principal, Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" });

  it("finds nobody outside in the template's policy (one Deny) or an Allow to this account's role", () => {
    const deny = { Effect: "Deny", Principal: "*", Action: "s3:*", Resource: ["arn:aws:s3:::b", "arn:aws:s3:::b/*"] };
    expect(outsidePrincipals([deny, allow({ AWS: `arn:aws:iam::${account}:role/shipshape-prod-app` })], account)).toEqual([]);
  });

  it.each([
    ["another account's canonical user", { CanonicalUser: "79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be" }],
    ["another account", { AWS: "arn:aws:iam::444455556666:root" }],
    ["everyone", "*"],
    ["everyone, as AWS", { AWS: "*" }],
    ["a service", { Service: "cloudfront.amazonaws.com" }],
    ["a federated user", { Federated: "cognito-identity.amazonaws.com" }],
  ])("counts %s as outside", (_what, principal) => {
    expect(outsidePrincipals([allow(principal)], account)).toHaveLength(1);
  });

  it("counts whoever a NotPrincipal leaves in", () => {
    expect(outsidePrincipals([{ Effect: "Allow", NotPrincipal: { AWS: `arn:aws:iam::${account}:root` }, Action: "s3:*" }], account)).toHaveLength(1);
  });

  // Only an AWS principal can be inside: a Federated or Service principal is whoever that provider or
  // service vouches for, even when its ARN carries this account's id.
  it.each([
    ["a Federated principal with this account's OIDC provider ARN", { Federated: `arn:aws:iam::${account}:oidc-provider/oidc.vercel.com/example-team` }],
    ["a Service principal written as this account's ARN", { Service: `arn:aws:iam::${account}:role/x` }],
  ])("counts %s as outside", (_what, principal) => {
    expect(outsidePrincipals([allow(principal)], account)).toEqual([`${Object.keys(principal)[0]} ${Object.values(principal)[0]}`]);
  });
});

describe("RDS (W12-5, W12-10)", () => {
  const key = `arn:aws:kms:us-east-1:${account}:key/1234abcd-12ab-34cd-56ef-1234567890ab`;
  const db: DBInstance = { StorageEncrypted: true, KmsKeyId: key, DeletionProtection: true, BackupRetentionPeriod: 7 };

  it("wants the file key itself, not the aws/rds key", () => {
    expect(rdsInstanceOk(db, key)).toBe(true);
    expect(rdsInstanceOk({ ...db, KmsKeyId: `arn:aws:kms:us-east-1:${account}:key/aws-rds-default` }, key)).toBe(false);
  });

  it("reads whom a manual snapshot is shared with", () => {
    expect(snapshotSharing([{ AttributeName: "restore", AttributeValues: [] }])).toEqual([]);
    expect(snapshotSharing([{ AttributeName: "restore", AttributeValues: ["all"] }])).toEqual(["all"]);
    expect(snapshotSharing([{ AttributeName: "restore", AttributeValues: ["444455556666"] }])).toEqual(["444455556666"]);
  });

  it("wants log_statement other than all and terse errors, from the whole parameter list", () => {
    expect(parameterProblems([{ ParameterName: "log_statement" }, { ParameterName: "log_error_verbosity", ParameterValue: "terse" }])).toEqual([]);
    expect(parameterProblems([{ ParameterName: "log_statement", ParameterValue: "all" }, { ParameterName: "log_error_verbosity", ParameterValue: "terse" }])).toEqual(["log_statement is all"]);
    expect(parameterProblems([{ ParameterName: "log_statement", ParameterValue: "ddl" }, { ParameterName: "log_error_verbosity" }])).toEqual([
      "log_error_verbosity is the default, not terse",
    ]);
    expect(parameterProblems([{ ParameterName: "log_error_verbosity", ParameterValue: "terse" }])).toEqual(["log_statement isn't in the list"]);
  });
});

describe("the Cognito pool (W12-5)", () => {
  const pool: UserPoolType = {
    UsernameAttributes: ["email"],
    SchemaAttributes: [{ Name: "email", Required: true }],
    AutoVerifiedAttributes: ["email"],
    UserAttributeUpdateSettings: { AttributesRequireVerificationBeforeUpdate: ["email"] },
    DeletionProtection: "ACTIVE",
    Policies: { PasswordPolicy: { MinimumLength: 12 } },
  };
  const mfa: GetUserPoolMfaConfigCommandOutput = { $metadata: {}, MfaConfiguration: "ON", SoftwareTokenMfaConfiguration: { Enabled: true } };

  it("passes the template's pool and needs an email change verified before it applies", () => {
    expect(poolCheck(pool, mfa, 2).ok).toBe(true);
    expect(poolCheck({ ...pool, UserAttributeUpdateSettings: { AttributesRequireVerificationBeforeUpdate: [] } }, mfa, 2).ok).toBe(false);
    expect(poolCheck({ ...pool, UserAttributeUpdateSettings: undefined }, mfa, 2).ok).toBe(false);
  });
});

describe("the app role's policy (W12-1, W12-11)", () => {
  const bucket = "shipshape-files-111122223333";
  const key = `arn:aws:kms:us-east-1:${account}:key/k`;
  const pool = `arn:aws:cognito-idp:us-east-1:${account}:userpool/us-east-1_x`;
  const resourceOf = new Map([
    ["s3:PutObject", `arn:aws:s3:::${bucket}/*`],
    ["s3:GetObject", `arn:aws:s3:::${bucket}/*`],
    ["s3:DeleteObject", `arn:aws:s3:::${bucket}/*`],
    ["s3:ListBucket", `arn:aws:s3:::${bucket}`],
    ["kms:GenerateDataKey", key],
    ["kms:Decrypt", key],
    ["cognito-idp:AdminDeleteUser", pool],
  ]);
  // infra/app-role.yaml's statements, as IAM returns them.
  const files = { Sid: "Files", Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource: `arn:aws:s3:::${bucket}/*` };
  const sweep = {
    Sid: "SweepDeletedWorkspace",
    Effect: "Allow",
    Action: "s3:ListBucket",
    Resource: `arn:aws:s3:::${bucket}`,
    Condition: { StringLike: { "s3:prefix": "????????-????-????-????-????????????/*" } },
  };
  const fileKey = {
    Sid: "FileKey",
    Effect: "Allow",
    Action: ["kms:GenerateDataKey", "kms:Decrypt"],
    Resource: key,
    Condition: { StringEquals: { "kms:ViaService": "s3.us-east-1.amazonaws.com" } },
  };
  const deleteAccounts = { Sid: "DeleteAccounts", Effect: "Allow", Action: "cognito-idp:AdminDeleteUser", Resource: pool };
  const check = (statements: unknown[]) => rolePolicyProblems("app", statements, resourceOf, "us-east-1");

  it("passes the template's four statements and grants all seven actions", () => {
    const { problems, granted } = check([files, sweep, fileKey, deleteAccounts]);
    expect(problems).toEqual([]);
    expect(granted.sort()).toEqual([...resourceOf.keys()].sort());
  });

  it.each([
    ["the old 37-character prefix", { ...sweep, Condition: { StringLike: { "s3:prefix": "????????-????-????-????-????????????/" } } }],
    ["no condition", { ...sweep, Condition: undefined }],
    ["any prefix", { ...sweep, Condition: { StringLike: { "s3:prefix": "*" } } }],
    ["a second condition", { ...sweep, Condition: { ...sweep.Condition, Bool: { "aws:SecureTransport": "true" } } }],
  ])("refuses s3:ListBucket under %s", (_what, statement) => {
    expect(check([files, statement, fileKey, deleteAccounts]).problems).toEqual([
      "app: s3:ListBucket other than alone, under the workspace-prefix condition",
    ]);
  });

  it.each([
    ["no condition", { ...fileKey, Condition: undefined }],
    ["another service", { ...fileKey, Condition: { StringEquals: { "kms:ViaService": "lambda.us-east-1.amazonaws.com" } } }],
    ["another region's S3", { ...fileKey, Condition: { StringEquals: { "kms:ViaService": "s3.eu-west-1.amazonaws.com" } } }],
    ["StringLike", { ...fileKey, Condition: { StringLike: { "kms:ViaService": "s3.*.amazonaws.com" } } }],
  ])("refuses the key's grant with %s", (_what, statement) => {
    expect(check([files, sweep, statement, deleteAccounts]).problems).toEqual([
      "app: the key's actions other than both together, under kms:ViaService s3.us-east-1.amazonaws.com",
    ]);
  });

  it("refuses a condition anywhere else", () => {
    const narrowed = { ...files, Condition: { StringEquals: { "aws:RequestedRegion": "us-east-1" } } };
    expect(check([narrowed, sweep, fileKey, deleteAccounts]).problems).toEqual(['app: condition {"StringEquals":{"aws:RequestedRegion":"us-east-1"}}']);
  });

  describe("with email on (Security 2026-11-04 0715, answer 5)", () => {
    const email = {
      from: "reminders@shipshape.example",
      identityArn: `arn:aws:ses:us-east-1:${account}:identity/shipshape.example`,
      configurationSetArn: `arn:aws:ses:us-east-1:${account}:configuration-set/shipshape-mail`,
    };
    // app-role.yaml's SendReminders, as IAM returns it.
    const send = {
      Sid: "SendReminders",
      Effect: "Allow",
      Action: "ses:SendEmail",
      Resource: [email.identityArn, email.configurationSetArn],
      Condition: { StringEquals: { "ses:FromAddress": email.from } },
    };
    const withEmail = (statement: unknown, grant: typeof email | null = email) => rolePolicyProblems("app", [files, sweep, fileKey, deleteAccounts, statement], resourceOf, "us-east-1", grant);
    const refused = "app: ses other than SendEmail alone, on the sender's identity and the configuration set, under ses:FromAddress reminders@shipshape.example";

    it("passes SendEmail alone, on the identity and the configuration set, from the one sender", () => {
      const { problems, granted } = withEmail(send);
      expect(problems).toEqual([]);
      expect(granted).toContain("ses:SendEmail");
    });

    it.each([
      ["SendRawEmail beside it", { ...send, Action: ["ses:SendEmail", "ses:SendRawEmail"] }],
      ["SendRawEmail instead", { ...send, Action: "ses:SendRawEmail" }],
      ["SendBulkEmail", { ...send, Action: "ses:SendBulkEmail" }],
      ["ses:*", { ...send, Action: "ses:*" }],
      ["any resource", { ...send, Resource: "*" }],
      ["another identity", { ...send, Resource: [`arn:aws:ses:us-east-1:${account}:identity/*`, email.configurationSetArn] }],
      ["the identity only", { ...send, Resource: email.identityArn }],
      ["no condition", { ...send, Condition: undefined }],
      ["another sender", { ...send, Condition: { StringEquals: { "ses:FromAddress": "anyone@shipshape.example" } } }],
      ["StringLike", { ...send, Condition: { StringLike: { "ses:FromAddress": "*@shipshape.example" } } }],
      ["a second condition", { ...send, Condition: { ...send.Condition, Bool: { "aws:SecureTransport": "true" } } }],
    ])("refuses %s", (_what, statement) => {
      expect(withEmail(statement).problems).toEqual([refused]);
    });

    it("refuses any ses grant while email is off (no PROBE_SES_*)", () => {
      expect(withEmail(send, null).problems).toEqual(['app: condition {"StringEquals":{"ses:FromAddress":"reminders@shipshape.example"}}', "app: action ses:SendEmail"]);
    });
  });
});

// The probe pins what the templates write; a template edited alone would fail the launch's probe.
describe("the templates write what the probe pins", () => {
  const template = (name: string) => readFileSync(path.join(import.meta.dirname, "..", "infra", name), "utf8");

  it("infra/app-role.yaml: the sweep's s3:prefix and the key's kms:ViaService, exactly", () => {
    const yaml = template("app-role.yaml");
    expect(yaml).toContain(`s3:prefix: "${SWEEP_CONDITION.StringLike["s3:prefix"]}"`);
    expect(fileKeyCondition("us-east-1").StringEquals["kms:ViaService"]).toBe("s3.us-east-1.amazonaws.com");
    expect(yaml).toContain('kms:ViaService: !Sub "s3.${AWS::Region}.amazonaws.com"');
  });

  it("infra/database.yaml: terse errors, and log_statement left at its default", () => {
    const yaml = template("database.yaml");
    expect(yaml).toMatch(/^ {8}log_error_verbosity: terse$/m);
    expect(yaml).not.toMatch(/log_statement:/);
  });

  /** The lines of `yaml` from the one matching `start` through the one matching `end`. */
  const block = (yaml: string, start: RegExp, end: RegExp) => {
    const lines = yaml.split("\n");
    const from = lines.findIndex((l) => start.test(l));
    const to = lines.findIndex((l, i) => i > from && end.test(l));
    return lines.slice(from, to + 1).join("\n");
  };
  /** Every non-comment line naming an SES action or condition key. */
  const sesLines = (yaml: string) =>
    yaml
      .split("\n")
      .filter((l) => !l.trim().startsWith("#") && /\bses:[A-Za-z*]/.test(l))
      .map((l) => l.trim());

  it("infra/app-role.yaml: SendEmail only, on the identity and the configuration set, from SenderAddress, and only with both parameters set (Security answer 5)", () => {
    const yaml = template("app-role.yaml");
    expect(block(yaml, /^ {14}- !If$/, /^ {16}- !Ref AWS::NoValue$/)).toBe(
      [
        "              - !If",
        "                - SendsEmail",
        "                - Sid: SendReminders",
        "                  Effect: Allow",
        "                  Action: ses:SendEmail",
        "                  Resource:",
        "                    - !Ref SenderIdentityArn",
        '                    - !Sub "arn:${AWS::Partition}:ses:${AWS::Region}:${AWS::AccountId}:configuration-set/shipshape-mail"',
        "                  Condition:",
        "                    StringEquals:",
        "                      ses:FromAddress: !Ref SenderAddress",
        "                - !Ref AWS::NoValue",
      ].join("\n"),
    );
    expect(sesLines(yaml)).toEqual(["Action: ses:SendEmail", "ses:FromAddress: !Ref SenderAddress"]);
    expect(block(yaml, /^Conditions:$/, /SenderIdentityArn, ""/)).toBe(
      ["Conditions:", "  SendsEmail: !And", '    - !Not [!Equals [!Ref SenderAddress, ""]]', '    - !Not [!Equals [!Ref SenderIdentityArn, ""]]'].join("\n"),
    );
    // Off by default: both parameters default to empty.
    expect(block(yaml, /^ {2}SenderAddress:$/, /Default:/)).toContain('Default: ""');
    expect(block(yaml, /^ {2}SenderIdentityArn:$/, /Default:/)).toContain('Default: ""');
  });

  it("infra/signin.yaml: Cognito sends through SES (DEVELOPER, the identity) only with both parameters set, off by default", () => {
    const yaml = template("signin.yaml");
    expect(block(yaml, /^ {6}EmailConfiguration: !If$/, /^ {8}- !Ref AWS::NoValue$/)).toBe(
      [
        "      EmailConfiguration: !If",
        "        - CodesThroughSes",
        "        - EmailSendingAccount: DEVELOPER",
        "          SourceArn: !Ref CodesIdentityArn",
        "          From: !Ref CodesFrom",
        "          ConfigurationSet: shipshape-mail",
        "        - !Ref AWS::NoValue",
      ].join("\n"),
    );
    expect(yaml).toContain("only once SES is out of the sandbox, Security #5");
    expect(block(yaml, /^ {2}CodesFrom:$/, /Default:/)).toContain('Default: ""');
    expect(block(yaml, /^ {2}CodesIdentityArn:$/, /Default:/)).toContain('Default: ""');
  });

  it("infra/mail.yaml: the configuration set suppresses bounces and complaints, tracks nothing, and publishes only those two events, signed with SHA256", () => {
    const yaml = template("mail.yaml");
    expect(yaml).toMatch(/^ {6}Name: shipshape-mail$/m);
    expect(block(yaml, /^ {6}SuppressionOptions:$/, /- COMPLAINT$/)).toBe(["      SuppressionOptions:", "        SuppressedReasons:", "          - BOUNCE", "          - COMPLAINT"].join("\n"));
    expect(yaml).not.toMatch(/^\s*TrackingOptions:/m);
    expect(yaml).not.toMatch(/^\s*- (open|click|OPEN|CLICK)$/m);
    expect(block(yaml, /^ {8}MatchingEventTypes:$/, /- complaint$/)).toBe(["        MatchingEventTypes:", "          - bounce", "          - complaint"].join("\n"));
    expect(yaml).toContain('SignatureVersion: "2"');
    expect(yaml).toContain('Endpoint: !Sub "${AppUrl}/api/mail/events"');
  });
});
