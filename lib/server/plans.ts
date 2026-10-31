import "server-only";
import { PLANS, type PlanId } from "@/lib/plans";
import type { Tx } from "./db";
import { PlanLimit } from "./errors";

export async function orgPlan(tx: Tx, orgId: string): Promise<PlanId> {
  const [row] = await tx.query<{ plan: PlanId | null }>("select app.org_plan($1) as plan", [orgId]);
  return row?.plan ?? "free";
}

const LIMIT_MESSAGES: Record<"documents" | "passports" | "esign", string> = {
  documents: `The Free plan holds ${PLANS.free.documents} active documents. Archive one, or move to Pro for no limit.`,
  passports: `The Free plan has ${PLANS.free.passports} passport link open at a time. Turn one off, or move to Pro for more.`,
  esign: "Asking for signatures is part of Pro.",
};

/**
 * Refuses an action the workspace's plan doesn't include. Runs inside the action's own
 * transaction, under a per-workspace lock, so two requests at once can't both squeeze past a limit.
 */
export async function assertWithinPlan(tx: Tx, orgId: string, what: "documents" | "passports" | "esign") {
  const plan = PLANS[await orgPlan(tx, orgId)];
  if (what === "esign") {
    if (!plan.esign) throw new PlanLimit(LIMIT_MESSAGES.esign);
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
  if (row.n >= limit) throw new PlanLimit(LIMIT_MESSAGES[what]);
}
