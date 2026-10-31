import "server-only";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

type Env = Record<string, string | undefined>;

/**
 * What every AWS client gets in production (Security S3-1, CG-1): credentials for AWS_ROLE_ARN from
 * Vercel's OIDC token, never stored keys, and AWS's own endpoints only. The SDK would also take an
 * endpoint from AWS_ENDPOINT_URL, AWS_ENDPOINT_URL_<SERVICE> or a config file's endpoint_url, and
 * send files and signed requests there; so those are ignored, and a deployment that sets one of the
 * variables doesn't start.
 */
export function productionAwsClient(env: Env, purpose: string) {
  const roleArn = env.AWS_ROLE_ARN;
  if (!roleArn) throw new Error(`${purpose} needs AWS_ROLE_ARN`);
  const redirects = Object.keys(env).filter((key) => key.startsWith("AWS_ENDPOINT_URL") && env[key]);
  if (redirects.length) throw new Error(`${purpose} refuses ${redirects.join(", ")}: AWS calls go to AWS only`);
  return { credentials: awsCredentialsProvider({ roleArn }), ignoreConfiguredEndpointUrls: true };
}
