import { billingConfig, webhookConfigured } from "@/lib/server/billing-config";
import { dbUp } from "@/lib/server/db";
import { launchProblems } from "@/lib/server/launch-check";

export const dynamic = "force-dynamic";

/** The settings don't change while an instance runs, so they're checked once (not a store and Cognito config per call). */
let configOk: boolean | undefined;

/**
 * Revision, build time and dependency flags only: no environment variable names or values. `config`
 * is whether the deployment has every setting it needs (W12-2), so the launch's last check fails on
 * a missing secret, not only on a database that doesn't answer. `billing` is the mode payments run
 * in and `webhookConfigured` whether a Stripe signing secret is set, so the live switch can be
 * checked from outside (Security L4): mode names and a boolean, never a key.
 */
export async function GET() {
  const db = await dbUp();
  const config = (configOk ??= launchProblems(process.env).length === 0);
  const billing = billingConfig();
  return Response.json(
    {
      ok: db && config,
      revision: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
      builtAt: process.env.SHIPSHAPE_BUILT_AT ?? null,
      db: db ? "up" : "down",
      config: config ? "ok" : "missing",
      billing: billing ? (billing.live ? "live" : "test") : "off",
      webhookConfigured: webhookConfigured(),
    },
    { status: db && config ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
