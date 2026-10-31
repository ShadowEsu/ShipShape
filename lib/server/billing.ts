import "server-only";
import Stripe from "stripe";
import { TERMS_VERSION } from "@/lib/legal";
import { PLANS, type PlanId } from "@/lib/plans";
import { asService, asUser, type Tx } from "./db";
import { UserError } from "./errors";
import { realDocsEnabled } from "./flags";
import type { Ctx } from "./profile";

/**
 * Stripe billing, TEST MODE ONLY (fleet rule: no live keys until an attorney names the seller).
 *
 * Access comes only from verified webhooks, after re-reading the subscription from Stripe, so event
 * order, duplicates and stale events can't grant or keep Pro. The checkout redirect grants nothing.
 */

/** Pinned here and on the webhook endpoint in the Stripe dashboard. */
export const STRIPE_API_VERSION = "2026-10-28.endive";

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9]{10,}$/;

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  proPrice: string;
  appUrl: string;
}

/**
 * Billing is on only with a Stripe TEST key, a webhook secret, the Pro price and the app URL.
 * Anything else (a live key included) turns it off. In production it's also off once real
 * documents are on: a test card would otherwise buy real Pro.
 */
export function billingConfig(): BillingConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const proPrice = process.env.STRIPE_PRICE_PRO ?? "";
  const appUrl = process.env.SHIPSHAPE_APP_URL ?? "";
  if (!TEST_KEY.test(secretKey) || !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret) || !/^price_[A-Za-z0-9]+$/.test(proPrice)) return null;
  if (!/^https?:\/\/[^/\s]+$/.test(appUrl)) return null;
  if (process.env.NODE_ENV === "production" && realDocsEnabled()) return null;
  return { secretKey, webhookSecret, proPrice, appUrl };
}

/** What billing reads from a subscription (Stripe's full object satisfies this). */
export interface SubscriptionState {
  id: string;
  customer: string | { id: string };
  status: Stripe.Subscription.Status;
  cancel_at_period_end: boolean;
  items: { data: { price: { id: string }; current_period_end: number }[] };
}

/** The few Stripe calls ShipShape makes; tests swap in a fake (no network). */
export interface StripePort {
  createCustomer(params: Stripe.CustomerCreateParams, idempotencyKey: string): Promise<{ id: string }>;
  createCheckout(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
  createPortal(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }>;
  retrievePrice(id: string): Promise<{ active: boolean; unit_amount: number | null; currency: string; recurring: { interval: string } | null }>;
  retrieveSubscription(id: string): Promise<SubscriptionState>;
  cancelSubscription(id: string): Promise<unknown>;
}

let testPort: StripePort | null = null;
export function setStripeForTests(port: StripePort | null) {
  testPort = port;
}

function stripePort(cfg: BillingConfig): StripePort {
  if (testPort) return testPort;
  const s = new Stripe(cfg.secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20_000 });
  return {
    createCustomer: (params, idempotencyKey) => s.customers.create(params, { idempotencyKey }),
    createCheckout: (params) => s.checkout.sessions.create(params),
    createPortal: (params) => s.billingPortal.sessions.create(params),
    retrievePrice: (id) => s.prices.retrieve(id),
    retrieveSubscription: (id) => s.subscriptions.retrieve(id),
    cancelSubscription: (id) => s.subscriptions.cancel(id),
  };
}

// Subscriptions in these states are still the workspace's subscription: a second one isn't allowed.
const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused"];

// Plan and status as members see them --------------------------------------------------------------

export interface BillingView {
  plan: PlanId;
  status: string;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** A Stripe customer exists, so the billing portal can open. */
  customer: boolean;
  /** A subscription is still running (possibly unpaid): manage it rather than start another. */
  subscribed: boolean;
  /** Payments are switched on in this environment. */
  available: boolean;
}

export async function billingView(ctx: Ctx): Promise<BillingView> {
  return asUser(ctx.userId, async (tx) => {
    const [plan] = await tx.query<{ plan: PlanId }>("select app.org_plan($1) as plan", [ctx.orgId]);
    const [row] = await tx.query<{ status: string; current_period_end: string | null; cancel_at_period_end: boolean }>(
      "select status, current_period_end::text as current_period_end, cancel_at_period_end from app.billing where org_id = $1",
      [ctx.orgId],
    );
    return {
      plan: plan?.plan ?? "free",
      status: row?.status ?? "none",
      periodEnd: row?.current_period_end ?? null,
      cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
      customer: Boolean(row),
      subscribed: row ? LIVE_STATUSES.includes(row.status) : false,
      available: billingConfig() !== null,
    };
  });
}

// Checkout and portal --------------------------------------------------------------------------------

function canPay(ctx: Ctx): BillingConfig {
  const cfg = billingConfig();
  if (!cfg) throw new UserError("Payments aren't switched on yet.");
  if (ctx.demo) throw new UserError("Sample workspaces already include every Pro feature.");
  if (ctx.role !== "owner") throw new UserError("Only the workspace owner can change the plan.");
  return cfg;
}

/** Starts a Stripe Checkout for Pro and returns its URL. One subscription per workspace. */
export async function startCheckout(ctx: Ctx, agreed: boolean): Promise<string> {
  const cfg = canPay(ctx);
  if (!agreed) throw new UserError("Tick the box to agree to the Terms, including billing and refunds.");
  const stripe = stripePort(cfg);

  // The price shown on the site must be the price charged.
  const price = await stripe.retrievePrice(cfg.proPrice);
  if (!price.active || price.unit_amount !== PLANS.pro.price * 100 || price.currency !== "usd" || price.recurring?.interval !== "month") {
    console.error("billing: the Stripe Pro price doesn't match lib/plans.ts; checkout refused");
    throw new UserError("Payments are paused for a moment while we fix a price mismatch. Please try again later.");
  }

  const customer = await asService(async (tx) => {
    const [row] = await tx.query<{ stripe_customer_id: string; stripe_subscription_id: string | null; status: string }>(
      "select stripe_customer_id, stripe_subscription_id, status from app.billing where org_id = $1 for update",
      [ctx.orgId],
    );
    if (row?.stripe_subscription_id && LIVE_STATUSES.includes(row.status)) {
      throw new UserError("This workspace already has a subscription. Manage it from Billing.");
    }
    if (row) return row.stripe_customer_id;
    const created = await stripe.createCustomer({ metadata: { org_id: ctx.orgId } }, `customer:${ctx.orgId}`);
    await tx.query("insert into app.billing (org_id, stripe_customer_id) values ($1, $2)", [ctx.orgId, created.id]);
    return created.id;
  });

  await asUser(ctx.userId, (tx) =>
    tx.query("insert into app.consents (user_id, item, policy_version, object_id) values ($1, 'billing', $2, $3)", [ctx.userId, TERMS_VERSION, ctx.orgId]),
  );

  const session = await stripe.createCheckout({
    mode: "subscription",
    customer,
    client_reference_id: ctx.orgId,
    line_items: [{ price: cfg.proPrice, quantity: 1 }],
    subscription_data: { metadata: { org_id: ctx.orgId } },
    success_url: `${cfg.appUrl}/app/settings?billing=success`,
    cancel_url: `${cfg.appUrl}/app/settings?billing=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  if (!session.url) throw new Error("Stripe returned a checkout session without a URL");
  return session.url;
}

/** Opens Stripe's billing portal: card, invoices, cancel. */
export async function openPortal(ctx: Ctx): Promise<string> {
  const cfg = canPay(ctx);
  const [row] = await asService((tx) => tx.query<{ stripe_customer_id: string }>("select stripe_customer_id from app.billing where org_id = $1", [ctx.orgId]));
  if (!row) throw new UserError("There's no billing account for this workspace yet.");
  const portal = await stripePort(cfg).createPortal({
    customer: row.stripe_customer_id,
    return_url: `${cfg.appUrl}/app/settings`,
    ...(process.env.STRIPE_PORTAL_CONFIG ? { configuration: process.env.STRIPE_PORTAL_CONFIG } : {}),
  });
  return portal.url;
}

// Webhooks ----------------------------------------------------------------------------------------------

/** Exactly the events the code handles; the webhook endpoint subscribes to these and no others. */
export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
] as const;

const HANDLED = new Set<string>(STRIPE_EVENTS);

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

/** Re-reads the subscription from Stripe and stores what it says now. */
async function syncSubscription(tx: Tx, cfg: BillingConfig, stripe: StripePort, orgId: string, customer: string, subscriptionId: string) {
  const sub = await stripe.retrieveSubscription(subscriptionId);
  if (idOf(sub.customer) !== customer) throw new Error("subscription belongs to another customer");
  const items = sub.items.data;
  const plan: PlanId = items.length === 1 && items[0].price.id === cfg.proPrice ? "pro" : "free";
  await tx.query(
    "update app.billing set stripe_subscription_id = $2, status = $3, plan = $4, current_period_end = to_timestamp($5), cancel_at_period_end = $6, updated_at = now() where org_id = $1",
    [orgId, sub.id, sub.status, plan, items[0]?.current_period_end ?? null, sub.cancel_at_period_end],
  );
}

async function applyEvent(tx: Tx, cfg: BillingConfig, stripe: StripePort, event: Stripe.Event) {
  const object = event.data.object;
  const customer = "customer" in object ? idOf(object.customer) : null;
  if (!customer) return;
  const [row] = await tx.query<{ org_id: string; stripe_subscription_id: string | null; status: string }>(
    "select org_id, stripe_subscription_id, status from app.billing where stripe_customer_id = $1 for update",
    [customer],
  );
  if (!row) return; // not one of ours (another product in the same sandbox)
  const current = row.stripe_subscription_id;
  const currentLive = current !== null && LIVE_STATUSES.includes(row.status);

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const fresh = idOf(event.data.object.subscription);
      if (!fresh) return;
      if (currentLive && fresh !== current) {
        // A second checkout went through while one subscription is live: undo the duplicate.
        await stripe.cancelSubscription(fresh);
        return;
      }
      return syncSubscription(tx, cfg, stripe, row.org_id, customer, fresh);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const id = event.data.object.id;
      // Never let another (older or duplicate) subscription overwrite the live one.
      if (currentLive && id !== current) return;
      return syncSubscription(tx, cfg, stripe, row.org_id, customer, id);
    }
    case "invoice.paid":
    case "invoice.payment_failed":
      if (current) await syncSubscription(tx, cfg, stripe, row.org_id, customer, current);
      return;
    case "charge.refunded":
    case "charge.dispute.created": {
      // Refund policy: a full refund or a dispute ends Pro straight away.
      const full = event.type === "charge.dispute.created" || event.data.object.refunded;
      if (!full || !current || !currentLive) return;
      await stripe.cancelSubscription(current);
      return syncSubscription(tx, cfg, stripe, row.org_id, customer, current);
    }
  }
}

/**
 * The webhook: verify the signature over the raw body, claim the event (a lease), apply it, and
 * mark it done. A duplicate of a finished event is acknowledged; one still being handled gets 409
 * so Stripe retries; a failure releases the claim and returns 500 so Stripe retries.
 */
export async function handleStripeWebhook(rawBody: string, signature: string | null): Promise<{ status: number; message: string }> {
  const cfg = billingConfig();
  if (!cfg) return { status: 503, message: "billing off" };
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature ?? "", cfg.webhookSecret, 300);
  } catch {
    return { status: 400, message: "bad signature" };
  }
  if (!HANDLED.has(event.type)) return { status: 200, message: "ignored" };

  const claimed = await asService((tx) =>
    tx.query(
      "insert into app.stripe_events (id, type) values ($1, $2) on conflict (id) do update set claimed_at = now() where app.stripe_events.finished_at is null and app.stripe_events.claimed_at < now() - interval '5 minutes' returning 1",
      [event.id, event.type],
    ),
  );
  if (!claimed.length) {
    const [row] = await asService((tx) => tx.query<{ done: boolean }>("select finished_at is not null as done from app.stripe_events where id = $1", [event.id]));
    return row?.done ? { status: 200, message: "duplicate" } : { status: 409, message: "in progress" };
  }

  const stripe = stripePort(cfg);
  try {
    await asService(async (tx) => {
      await applyEvent(tx, cfg, stripe, event);
      await tx.query("update app.stripe_events set finished_at = now() where id = $1", [event.id]);
    });
    return { status: 200, message: "ok" };
  } catch (e) {
    await asService((tx) => tx.query("delete from app.stripe_events where id = $1 and finished_at is null", [event.id]));
    console.error(`billing: ${event.type} failed (${e instanceof Error ? e.name : "error"})`);
    return { status: 500, message: "retry" };
  }
}

// Account deletion --------------------------------------------------------------------------------------

/**
 * Cancels the subscriptions of the workspaces an account deletion will remove (those where the
 * person is the only owner). Runs before the deletion; if Stripe can't be reached, the deletion stops.
 */
export async function cancelSubscriptionsBeforeDeletion(userId: string) {
  const subs = await asService((tx) =>
    tx.query<{ stripe_subscription_id: string }>(
      `select b.stripe_subscription_id from app.billing b
       join app.members m on m.org_id = b.org_id and m.user_id = $1 and m.role = 'owner'
       where b.stripe_subscription_id is not null and b.status = any($2::text[])
         and not exists (select 1 from app.members o where o.org_id = b.org_id and o.role = 'owner' and o.user_id <> $1)`,
      [userId, LIVE_STATUSES],
    ),
  );
  if (!subs.length) return;
  const cfg = billingConfig();
  if (!cfg) throw new UserError("Your subscription couldn't be cancelled automatically. Cancel it under Billing first, then delete your account.");
  const stripe = stripePort(cfg);
  for (const s of subs) {
    try {
      await stripe.cancelSubscription(s.stripe_subscription_id);
    } catch {
      // Stripe refuses to cancel a subscription that already ended (its webhook may not have
      // reached us yet). Anything still running stops the deletion.
      const now = await stripe.retrieveSubscription(s.stripe_subscription_id).catch(() => null);
      if (now?.status !== "canceled" && now?.status !== "incomplete_expired") {
        throw new UserError("Your subscription couldn't be cancelled just now. Try again in a minute, or cancel it under Billing first.");
      }
    }
  }
}
