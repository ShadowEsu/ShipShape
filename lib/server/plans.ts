import "server-only";
import { PLANS, type PlanId } from "@/lib/plans";
import type { Tx } from "./db";
import { billingConfig } from "./billing-config";
import { PlanLimit } from "./errors";
import { FILES_FULL, FILES_FULL_PRO, SAMPLE_DOCUMENTS, SAMPLE_FULL } from "./limits";
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
export function planLimit(ctx: Pick<Ctx, "role" | "demo">, what: "documents" | "passports" | "esign" | "files"): PlanLimit {
  const pro = billingConfig() !== null && ctx.role === "owner" && !ctx.demo;
  if (what === "esign") return new PlanLimit("Asking for signatures is part of Pro.");
  // Free has no delete, so archiving makes no room: Pro is the only way on, and only for someone who can take it.
  if (what === "files") return new PlanLimit(pro ? FILES_FULL + FILES_FULL_PRO : FILES_FULL);
  if (what === "documents") {
    // The fix link says what to do; the message adds only the Pro half, so "archive one" isn't said twice.
    return new PlanLimit(`The Free plan holds ${PLANS.free.documents} active documents.${pro ? " Or move to Pro for no limit." : ""}`, {
      href: "/app/documents",
      label: "Choose one to archive",
    });
  }
  return new PlanLimit(`The Free plan has ${PLANS.free.passports} passport link open at a time. ${pro ? "Turn one off, or move to Pro for more." : "Turn one off to make room."}`);
}

/** The per-workspace lock every limit is checked under, so two requests at once can't both squeeze past one. */
const lockPlan = (tx: Tx, orgId: string) => tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`plan:${orgId}`]);

/**
 * Refuses an action the workspace's plan doesn't include. Runs inside the action's own
 * transaction, under a per-workspace lock, so two requests at once can't both squeeze past a limit.
 * `documents` is a new document; `restore` brings an archived one back, which counts against the
 * active documents but stores nothing new.
 */
export async function assertWithinPlan(tx: Tx, ctx: Pick<Ctx, "orgId" | "role" | "demo">, what: "documents" | "restore" | "passports" | "esign") {
  const orgId = ctx.orgId;
  const plan = PLANS[await orgPlan(tx, orgId)];
  if (what === "esign") {
    if (!plan.esign) throw planLimit(ctx, "esign");
    return;
  }
  // A sample counts as Pro (no document limit) but holds SAMPLE_DOCUMENTS in all, archived ones included:
  // it can't delete, so archiving makes no room (W15-2). Checked before Pro's no-limit return below.
  if (what === "documents" && ctx.demo) {
    await lockPlan(tx, orgId);
    if (await sampleFull(tx, ctx)) throw new PlanLimit(SAMPLE_FULL);
  }
  const limit = what === "passports" ? plan.passports : plan.documents;
  if (limit === null) return;
  await lockPlan(tx, orgId);
  const [row] = await tx.query<{ n: number }>(
    what === "passports"
      ? "select count(*)::int as n from app.share_links where org_id = $1 and revoked_at is null and expires_at > now()"
      : "select count(*)::int as n from app.documents where org_id = $1 and status = 'active'",
    [orgId],
  );
  if (row.n >= limit) throw planLimit(ctx, what === "passports" ? "passports" : "documents");
}

/** Whether a sample already holds all the documents it can, so the Make page says so before a form is filled. */
export async function sampleFull(tx: Tx, ctx: Pick<Ctx, "orgId" | "demo">): Promise<boolean> {
  if (!ctx.demo) return false;
  const [all] = await tx.query<{ n: number }>("select count(*)::int as n from app.documents where org_id = $1", [ctx.orgId]);
  return all.n >= SAMPLE_DOCUMENTS;
}

/**
 * Refuses storing a file that would take the workspace past its plan's total (W15-3): every stored version
 * counts, archived documents included, since Free can't delete. Under the plan lock, in the storing transaction.
 */
export async function assertRoomForFile(tx: Tx, ctx: Pick<Ctx, "orgId" | "role" | "demo">, size: number) {
  const quota = PLANS[await orgPlan(tx, ctx.orgId)].files;
  if (quota === null) return;
  await lockPlan(tx, ctx.orgId);
  const [row] = await tx.query<{ n: number }>("select coalesce(sum(size_bytes), 0)::float8 as n from app.document_versions where org_id = $1", [ctx.orgId]);
  if (row.n + size > quota) throw planLimit(ctx, "files");
}
