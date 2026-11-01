import "server-only";
import Stripe from "stripe";
import { TERMS_VERSION } from "@/lib/legal";
import { PLANS, type PlanId } from "@/lib/plans";
import { billingConfig, type BillingConfig } from "./billing-config";
import { asService, asUser, type Tx } from "./db";
import { SubscriptionStillRunning, UserError } from "./errors";
import type { Ctx } from "./profile";

/**
 * Stripe billing, TEST MODE unless BILLING_LIVE_KEYS_OK admits a live key (fleet rule: no live keys until an attorney names the seller).
 *
 * Access comes only from verified webhooks, after re-reading the subscription from Stripe, so event
 * order, duplicates and stale events can't grant or keep Pro. The checkout redirect grants nothing.
 */

/** Pinned here and on the webhook endpoint in the Stripe dashboard. */
export const STRIPE_API_VERSION = "2026-10-28.endive";

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
  /** Every subscription the customer has in Stripe, ended ones included. */
  listSubscriptions(customer: string): Promise<{ id: string; status: string }[]>;
  /** Every open Checkout Session of the customer (one can still be paid until it expires). */
  listOpenCheckouts(customer: string): Promise<{ id: string; status: string }[]>;
  expireCheckout(id: string): Promise<unknown>;
  /** Who a charge belongs to, and the subscription it paid for (null for a one-off charge). */
  chargeOwner(id: string): Promise<{ customer: string | null; subscription: string | null }>;
  /** Refunds whatever was paid on an invoice (a duplicate subscription's first payment). */
  refundInvoice(invoiceId: string): Promise<unknown>;
}

let testPort: StripePort | null = null;
export function setStripeForTests(port: StripePort | null) {
  testPort = port;
}

function stripePort(cfg: BillingConfig): StripePort {
  if (testPort) return testPort;
  // Some calls run inside a database transaction whose idle timeout is 60 s (lib/server/db.ts): one
  // attempt and one retry of 15 s each, plus backoff, finish well before Postgres closes the session.
  const s = new Stripe(cfg.secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 1, timeout: 15_000 });
  return {
    createCustomer: (params, idempotencyKey) => s.customers.create(params, { idempotencyKey }),
    createCheckout: (params) => s.checkout.sessions.create(params),
    createPortal: (params) => s.billingPortal.sessions.create(params),
    retrievePrice: (id) => s.prices.retrieve(id),
    retrieveSubscription: (id) => s.subscriptions.retrieve(id),
    cancelSubscription: (id) => s.subscriptions.cancel(id),
    listSubscriptions: async (customer) => (await s.subscriptions.list({ customer, status: "all", limit: 100 }).autoPagingToArray({ limit: 1000 })).map((x) => ({ id: x.id, status: x.status })),
    listOpenCheckouts: async (customer) =>
      (await s.checkout.sessions.list({ customer, status: "open", limit: 100 }).autoPagingToArray({ limit: 1000 })).map((x) => ({ id: x.id, status: x.status ?? "unknown" })),
    expireCheckout: (id) => s.checkout.sessions.expire(id),
    chargeOwner: async (id) => {
      // A charge names its payment intent; the invoice payment for that intent names the invoice, whose parent is the subscription.
      const charge = await s.charges.retrieve(id);
      const intent = idOf(charge.payment_intent);
      const payments = intent ? await s.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: intent }, expand: ["data.invoice"], limit: 1 }) : null;
      const invoice = payments?.data[0]?.invoice;
      const subscription = invoice && typeof invoice !== "string" && !invoice.deleted ? invoice.parent?.subscription_details?.subscription : null;
      return { customer: idOf(charge.customer), subscription: idOf(subscription) };
    },
    refundInvoice: async (invoiceId) => {
      const payments = await s.invoicePayments.list({ invoice: invoiceId, limit: 10 });
      for (const p of payments.data) {
        const intent = idOf(p.payment.payment_intent);
        if (p.status === "paid" && intent) await s.refunds.create({ payment_intent: intent, reason: "duplicate" }, { idempotencyKey: `refund-dup-${intent}` });
      }
    },
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
  /** Payments take real money: a live key, admitted with BILLING_LIVE_KEYS_OK. False while payments are off. */
  live: boolean;
}

export async function billingView(ctx: Ctx): Promise<BillingView> {
  const cfg = billingConfig();
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
      available: cfg !== null,
      live: cfg?.live ?? false,
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
  // The tick first, so an unticked box can only ever get its own refusal (app/app/settings/actions.ts marks the box by that).
  if (!agreed) throw new UserError("Check the box to agree to the Terms, including billing and refunds.");
  const cfg = canPay(ctx);
  const stripe = stripePort(cfg);

  // The price shown on the site must be the price charged.
  const price = await stripe.retrievePrice(cfg.proPrice);
  if (!price.active || price.unit_amount !== PLANS.pro.price * 100 || price.currency !== "usd" || price.recurring?.interval !== "month") {
    console.error("billing: the Stripe Pro price doesn't match lib/plans.ts; checkout refused");
    throw new UserError("Payments are paused while we fix a price mismatch. Nothing was charged; try again later.");
  }

  const customer = await asService(async (tx) => {
    const [row] = await tx.query<{ stripe_customer_id: string; stripe_subscription_id: string | null; status: string }>(
      "select stripe_customer_id, stripe_subscription_id, status from app.billing where org_id = $1 for update",
      [ctx.orgId],
    );
    if (row?.stripe_subscription_id && LIVE_STATUSES.includes(row.status)) {
      throw new UserError("This workspace already has a subscription. Change it with Manage billing.");
    }
    if (row) return row.stripe_customer_id;
    const created = await stripe.createCustomer({ metadata: { org_id: ctx.orgId } }, `customer:${ctx.orgId}`);
    // A second first checkout at the same moment gets the same customer (same idempotency key) and
    // finds the row the other one stored (Security I5).
    await tx.query("insert into app.billing (org_id, stripe_customer_id) values ($1, $2) on conflict (org_id) do nothing", [ctx.orgId, created.id]);
    const [stored] = await tx.query<{ stripe_customer_id: string }>("select stripe_customer_id from app.billing where org_id = $1", [ctx.orgId]);
    return stored.stripe_customer_id;
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
  if (!row) throw new UserError("There's no billing account for this workspace yet. It's made when you move to Pro.");
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
  // past_due_since starts the 7-day grace at the first past-due sync and clears on any other status.
  await tx.query(
    `update app.billing set stripe_subscription_id = $2, status = $3, plan = $4, current_period_end = to_timestamp($5), cancel_at_period_end = $6,
       past_due_since = case when $3 = 'past_due' then coalesce(past_due_since, now()) end, updated_at = now() where org_id = $1`,
    [orgId, sub.id, sub.status, plan, items[0]?.current_period_end ?? null, sub.cancel_at_period_end],
  );
}

// Subscriptions in these states are over: nothing to cancel.
const ENDED_STATUSES = ["canceled", "incomplete_expired"];

/** Cancels a subscription unless it already ended, so a redelivered event can run again safely. */
async function cancelIfRunning(stripe: StripePort, id: string) {
  const sub = await stripe.retrieveSubscription(id);
  if (!ENDED_STATUSES.includes(sub.status)) await stripe.cancelSubscription(id);
}

async function applyEvent(tx: Tx, cfg: BillingConfig, stripe: StripePort, event: Stripe.Event) {
  // A partial refund changes nothing (refund policy), so it needs no lookups.
  if (event.type === "charge.refunded" && !event.data.object.refunded) return;
  // Refunds and disputes are about a charge: read who it belongs to and which subscription it paid
  // for (a dispute doesn't even name the customer).
  const charge = event.type === "charge.refunded" ? event.data.object.id : event.type === "charge.dispute.created" ? idOf(event.data.object.charge) : null;
  const owner = charge ? await stripe.chargeOwner(charge) : null;
  const object = event.data.object;
  const customer = owner ? owner.customer : "customer" in object ? idOf(object.customer) : null;
  if (!customer) return;
  const [row] = await tx.query<{ org_id: string; stripe_subscription_id: string | null; status: string }>(
    "select org_id, stripe_subscription_id, status from app.billing where stripe_customer_id = $1 for update",
    [customer],
  );
  if (!row) {
    // Not one of ours (another product in the same sandbox), or a workspace deleted since: a checkout paid after its
    // account was deleted (Security W9-2) is refused here, never attached to anything.
    console.warn(`billing: ${event.type} ${event.id} names a customer with no workspace here; finished as not ours`);
    return;
  }
  const current = row.stripe_subscription_id;
  const currentLive = current !== null && LIVE_STATUSES.includes(row.status);

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const fresh = idOf(event.data.object.subscription);
      if (!fresh) return;
      if (currentLive && fresh !== current) {
        // A second checkout went through while one subscription is live: undo the duplicate and
        // give its first payment back (the refund's idempotency key makes a redelivery harmless).
        await cancelIfRunning(stripe, fresh);
        const invoice = idOf(event.data.object.invoice);
        if (invoice) await stripe.refundInvoice(invoice);
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
      // Refund policy: a full refund or a dispute ends Pro straight away, but only when the charge
      // paid for the live subscription (refunding a cancelled duplicate must not end the good one).
      if (!current || !currentLive || owner?.subscription !== current) return;
      await cancelIfRunning(stripe, current);
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
  // An event in the other mode than the key is refused before it touches anything: live-mode events only once
  // BILLING_LIVE_KEYS_OK admitted a live key (Security B5), test-mode events never with a live key.
  if (event.livemode !== cfg.live) return { status: 400, message: event.livemode ? "live events refused" : "test events refused" };
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
 * person is the only owner). For each workspace's customer it first expires every open Checkout
 * Session, so a checkout started before the deletion can't be paid after it (Security W9-2), then
 * asks Stripe for every subscription of the customer, so one whose webhook never reached us (a
 * checkout paid moments ago) stops too (Security B3). Runs before the deletion; if Stripe can't be
 * reached, the deletion stops. A session that completed or expired on its own meanwhile doesn't
 * stop it, so a retry runs safely.
 *
 * Returns the workspaces whose billing it handled. The deletion refuses any billed workspace outside
 * that list: another owner leaving at the same moment can make this person the sole owner after
 * this check ran (Security F5-r2).
 */
export async function cancelSubscriptionsBeforeDeletion(userId: string): Promise<string[]> {
  const customers = await asService((tx) =>
    tx.query<{ org_id: string; stripe_customer_id: string; known_live: boolean }>(
      `select b.org_id, b.stripe_customer_id, (b.stripe_subscription_id is not null and b.status = any($2::text[])) as known_live from app.billing b
       join app.members m on m.org_id = b.org_id and m.user_id = $1 and m.role = 'owner'
       where b.stripe_customer_id is not null
         and not exists (select 1 from app.members o where o.org_id = b.org_id and o.role = 'owner' and o.user_id <> $1)`,
      [userId, LIVE_STATUSES],
    ),
  );
  const handled = customers.map((c) => c.org_id);
  if (!customers.length) return handled;
  const cfg = billingConfig();
  if (!cfg) {
    // Billing is off, so no new checkout can have started; only a subscription we know is running stops the deletion.
    // The settings form adds the way to reach us (an address when one is set).
    if (customers.some((c) => c.known_live)) throw new SubscriptionStillRunning();
    return handled;
  }
  const stripe = stripePort(cfg);
  const busy = "Your subscription couldn't be cancelled just now. Try again in a minute, or cancel it with Manage billing under Plan first.";
  for (const c of customers) {
    const open = await stripe.listOpenCheckouts(c.stripe_customer_id).catch(() => {
      throw new UserError(busy);
    });
    for (const s of open) {
      try {
        await stripe.expireCheckout(s.id);
      } catch (e) {
        // Stripe refuses to expire a session that completed or expired since the list was read. Anything still open stops the deletion.
        const still = await stripe.listOpenCheckouts(c.stripe_customer_id).catch(() => null);
        if (!still || still.some((x) => x.id === s.id)) throw new UserError(busy);
        console.warn(`billing: a checkout had already ended when the account deletion tried to expire it (${e instanceof Error ? e.name : "error"})`);
      }
    }
    const subs = await stripe.listSubscriptions(c.stripe_customer_id).catch(() => {
      throw new UserError(busy);
    });
    for (const s of subs) {
      if (ENDED_STATUSES.includes(s.status)) continue;
      try {
        await stripe.cancelSubscription(s.id);
      } catch {
        // Stripe refuses to cancel a subscription that ended since the list was read. Anything still running stops the deletion.
        const now = await stripe.retrieveSubscription(s.id).catch(() => null);
        if (!now || !ENDED_STATUSES.includes(now.status)) throw new UserError(busy);
      }
    }
  }
  return handled;
}
