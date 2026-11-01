import "server-only";
import { PLANS, type PlanId } from "@/lib/plans";
import type { Tx } from "./db";
import { billingConfig } from "./billing";
import { PlanLimit } from "./errors";

export async function orgPlan(tx: Tx, orgId: string): Promise<PlanId> {
  const [row] = await tx.query<{ plan: PlanId | null }>("select app.org_plan($1) as plan", [orgId]);
  return row?.plan ?? "free";
}

/**
 * The message for a limit, and the one page where room can be made. "Move to Pro" is offered only while payments
 * are on (Security MUST, Design): with billing off nobody can take that path, so the message says what they can do.
 */
export function planLimit(what: "documents" | "passports" | "esign"): PlanLimit {
  const paid = billingConfig() !== null;
  if (what === "esign") return new PlanLimit("Asking for signatures is part of Pro.");
  if (what === "documents") {
    return new PlanLimit(
      `The Free plan holds ${PLANS.free.documents} active documents.${paid ? " Archive one, or move to Pro for no limit." : ""}`,
      { href: "/app/documents", label: "Archive one to make room" },
    );
  }
  return new PlanLimit(`The Free plan has ${PLANS.free.passports} passport link open at a time. ${paid ? "Turn one off, or move to Pro for more." : "Turn one off to make room."}`);
}

/**
 * Refuses an action the workspace's plan doesn't include. Runs inside the action's own
 * transaction, under a per-workspace lock, so two requests at once can't both squeeze past a limit.
 */
export async function assertWithinPlan(tx: Tx, orgId: string, what: "documents" | "passports" | "esign") {
  const plan = PLANS[await orgPlan(tx, orgId)];
  if (what === "esign") {
    if (!plan.esign) throw planLimit("esign");
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
  if (row.n >= limit) throw planLimit(what);
}
