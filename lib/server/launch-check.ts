import "server-only";
import { cognitoConfig } from "./cognito";
import { fieldKey, hashKey } from "./crypto";
import { appUrl, contactEmail, cronSecret } from "./flags";
import { sessionSecret } from "./session";
import { storeFromEnv } from "./storage";

type Env = Record<string, string | undefined>;

/**
 * What a deployment is missing, one line per problem, naming variables, never their values (W12-2).
 * Each value is checked by the function the app reads it with, so these rules can't drift from the
 * app's. All of it applies to Vercel's production environment only: previews run
 * NODE_ENV=production without AWS by design (aws-plan).
 */
export function launchProblems(env: Env): string[] {
  const problems: string[] = [];
  const check = (read: () => unknown) => {
    try {
      read();
    } catch (e) {
      problems.push(e instanceof Error ? e.message : "a setting is invalid");
    }
  };
  // Any production build with real documents open: /privacy and every shared page's "Report this page" use it.
  if (env.NODE_ENV === "production" && env.SHIPSHAPE_REAL_DOCS === "1" && !contactEmail(env)) problems.push("Production with real documents needs CONTACT_EMAIL (not configured)");
  if (env.VERCEL_ENV !== "production") return problems;
  check(() => sessionSecret(env));
  check(() => hashKey(env));
  check(() => fieldKey(env));
  if (!cronSecret(env)) problems.push("CRON_SECRET must be at least 32 characters");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  // RDS and Supabase sign with their own CAs: without the bundle every database call fails verification.
  if (!env.DATABASE_CA_CERT) problems.push("DATABASE_CA_CERT is not set");
  if (appUrl(env)?.protocol !== "https:") problems.push("SHIPSHAPE_APP_URL must be an https:// URL");
  check(() => storeFromEnv(env));
  check(() => {
    if (!cognitoConfig(env) && env.SHIPSHAPE_REAL_DOCS === "1") throw new Error("Real documents need account sign-in (COGNITO_*)");
  });
  return problems;
}

/** Checked when the server starts (instrumentation.ts): a deployment missing any of it doesn't serve. */
export function assertLaunchConfig(env: Env) {
  const problems = launchProblems(env);
  if (problems.length) throw new Error(`ShipShape isn't configured for this deployment: ${problems.join("; ")}`);
}
