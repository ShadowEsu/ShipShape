import "server-only";
import { PLANS, type PlanId } from "@/lib/plans";
import type { Tx } from "./db";
import { billingConfig } from "./billing-config";
import { PlanLimit } from "./errors";
import type { Ctx } from "./profile";

export async function orgPlan(tx: Tx, orgId: string): Promise<PlanId> {
  const [row] = await tx.query<{ plan: PlanId | null }>("select app.org_plan($1) as plan", [orgId]);
  return row?.plan ?? "free";
}

/**
 * The message for a limit, and the one page where room can be made. "Move to Pro" is offered only to someone who
 * can take that path: payments on (Security MUST, Design) and the workspace's owner, outside the sample (`canPay`
 * in billing.ts refuses everyone else).
 */
export function planLimit(ctx: Pick<Ctx, "role" | "demo">, what: "documents" | "passports" | "esign"): PlanLimit {
  const pro = billingConfig() !== null && ctx.role === "owner" && !ctx.demo;
  if (what === "esign") return new PlanLimit("Asking for signatures is part of Pro.");
  if (what === "documents") {
    // The fix link says what to do; the message adds only the Pro half, so "archive one" isn't said twice.
    return new PlanLimit(`The Free plan holds ${PLANS.free.documents} active documents.${pro ? " Or move to Pro for no limit." : ""}`, {
      href: "/app/documents",
      label: "Choose one to archive",
    });
  }
  return new PlanLimit(`The Free plan has ${PLANS.free.passports} passport link open at a time. ${pro ? "Turn one off, or move to Pro for more." : "Turn one off to make room."}`);
}

/**
 * Refuses an action the workspace's plan doesn't include. Runs inside the action's own
 * transaction, under a per-workspace lock, so two requests at once can't both squeeze past a limit.
 */
export async function assertWithinPlan(tx: Tx, ctx: Pick<Ctx, "orgId" | "role" | "demo">, what: "documents" | "passports" | "esign") {
  const orgId = ctx.orgId;
  const plan = PLANS[await orgPlan(tx, orgId)];
  if (what === "esign") {
    if (!plan.esign) throw planLimit(ctx, "esign");
    return;
  }
  const limit = what === "documents" ? plan.documents : plan.passports;
  if (limit === null) return;
  await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plan:${orgId}`]);
  const [row] = await tx.query<{ n: number }>(
    what === "documents"
      ? "select count(*)::int as n from app.documents where org_id = $1 and status = 'active'"
      : "select count(*)::int as n from app.share_links where org_id = $1 and revoked_at is null and expires_at > now()",
    [orgId],
  );
  if (row.n >= limit) throw planLimit(ctx, what);
}
