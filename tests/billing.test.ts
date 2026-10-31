import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "@/lib/server/account";
import { billingConfig, billingView, handleStripeWebhook, openPortal, setStripeForTests, startCheckout, type StripePort, type SubscriptionState } from "@/lib/server/billing";
import { asUser } from "@/lib/server/db";
import { uploadDocument } from "@/lib/server/documents";
import { PlanLimit, UserError } from "@/lib/server/errors";
import { requestSignature } from "@/lib/server/esign";
import { createPassport } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { freshDb, type TestDb } from "./support/db";

/** Stripe billing in test mode (stripe-billing-readiness checks A-H), against a fake Stripe. */

const KEY = `sk_test_${"a".repeat(24)}`;
const WHSEC = "whsec_testsecret123";
const PRO = "price_Pro1";

class FakeStripe implements StripePort {
  subs = new Map<string, SubscriptionState>();
  checkouts: Stripe.Checkout.SessionCreateParams[] = [];
  cancelled: string[] = [];
  customersCreated = 0;
  retrieves = 0;
  failNextRetrieve = false;
  price = { active: true, unit_amount: 1500, currency: "usd", recurring: { interval: "month" } };

  async createCustomer() {
    this.customersCreated++;
    return { id: `cus_T${++seq}` };
  }
  async createCheckout(params: Stripe.Checkout.SessionCreateParams) {
    this.checkouts.push(params);
    return { url: "https://checkout.stripe.com/c/pay/cs_test_1" };
  }
  portals: Stripe.BillingPortal.SessionCreateParams[] = [];
  async createPortal(params: Stripe.BillingPortal.SessionCreateParams) {
    this.portals.push(params);
    return { url: "https://billing.stripe.com/p/session/test_1" };
  }
  async retrievePrice() {
    return this.price;
  }
  async retrieveSubscription(id: string) {
    this.retrieves++;
    if (this.failNextRetrieve) {
      this.failNextRetrieve = false;
      throw new Error("network down");
    }
    const s = this.subs.get(id);
    if (!s) throw new Error("no such subscription");
    return s;
  }
  async cancelSubscription(id: string) {
    const s = this.subs.get(id);
    if (!s || s.status === "canceled") throw new Error("subscription already canceled"); // as Stripe does
    this.cancelled.push(id);
    s.status = "canceled";
    return {};
  }
  /** charge id → who it belongs to and the subscription it paid for */
  charges = new Map<string, { customer: string; subscription: string | null }>();
  async chargeOwner(id: string) {
    const owner = this.charges.get(id);
    if (!owner) throw new Error("no such charge");
    return owner;
  }
  async listSubscriptions(customer: string) {
    return [...this.subs.values()].filter((s) => s.customer === customer).map((s) => ({ id: s.id, status: s.status }));
  }
  refunded: string[] = [];
  async refundInvoice(invoiceId: string) {
    this.refunded.push(invoiceId);
  }
}

let seq = 0;
let db: TestDb;
let blobDir: string;
let fake: FakeStripe;

const inDays = (d: number) => Math.floor(Date.now() / 1000) + d * 86400;

function subscription(id: string, customer: string, opts: Partial<Pick<SubscriptionState, "status" | "cancel_at_period_end">> & { price?: string; periodEnd?: number } = {}): SubscriptionState {
  const s: SubscriptionState = {
    id,
    customer,
    status: opts.status ?? "active",
    cancel_at_period_end: opts.cancel_at_period_end ?? false,
    items: { data: [{ price: { id: opts.price ?? PRO }, current_period_end: opts.periodEnd ?? inDays(30) }] },
  };
  fake.subs.set(id, s);
  return s;
}

function send(type: string, object: object, opts: { id?: string; timestamp?: number; secret?: string; livemode?: boolean } = {}) {
  const payload = JSON.stringify({ id: opts.id ?? `evt_${++seq}x`, object: "event", type, livemode: opts.livemode ?? false, data: { object } });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WHSEC, timestamp: opts.timestamp });
  return handleStripeWebhook(payload, header);
}

async function realWorkspace(): Promise<Ctx> {
  const userId = await db.user(`owner${++seq}@example.com`);
  const [org] = await asUser(userId, (tx) => tx.query<{ id: string }>("select app.create_workspace('Real Co') as id"));
  return { userId, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Real Co", role: "owner" };
}

const plan = async (ctx: Ctx) => (await billingView(ctx)).plan;
const customerOf = async (ctx: Ctx) =>
  (await db.root((tx) => tx.query<{ stripe_customer_id: string }>("select stripe_customer_id from app.billing where org_id = $1", [ctx.orgId])))[0].stripe_customer_id;

/** A paying workspace: checkout, then Stripe's completed event. */
async function payingWorkspace() {
  const ctx = await realWorkspace();
  await startCheckout(ctx, true);
  const customer = await customerOf(ctx);
  const sub = subscription(`sub_P${++seq}`, customer);
  expect((await send("checkout.session.completed", { object: "checkout.session", customer, subscription: sub.id })).status).toBe(200);
  return { ctx, customer, sub };
}

beforeAll(async () => {
  db = await freshDb();
  blobDir = await mkdtemp(path.join(os.tmpdir(), "shipshape-billing-"));
  setBlobStoreForTests(localBlobStore(blobDir));
});

afterAll(async () => {
  await rm(blobDir, { recursive: true, force: true });
});

beforeEach(() => {
  fake = new FakeStripe();
  setStripeForTests(fake);
  vi.stubEnv("STRIPE_SECRET_KEY", KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WHSEC);
  vi.stubEnv("STRIPE_PRICE_PRO", PRO);
  vi.stubEnv("SHIPSHAPE_APP_URL", "http://127.0.0.1:3917");
});

afterEach(() => {
  vi.unstubAllEnvs();
  setStripeForTests(null);
});

describe("keys and mode", () => {
  it("runs only with a Stripe test key; a live key switches billing off", () => {
    expect(billingConfig()).not.toBeNull();
    vi.stubEnv("STRIPE_SECRET_KEY", `sk_live_${"a".repeat(24)}`);
    expect(billingConfig()).toBeNull();
    vi.stubEnv("STRIPE_SECRET_KEY", `rk_live_${"a".repeat(24)}`);
    expect(billingConfig()).toBeNull();
    vi.stubEnv("STRIPE_SECRET_KEY", ` ${KEY}`);
    expect(billingConfig()).toBeNull();
  });

  it("is off in production once real documents are on, so a test card can't buy real Pro", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(billingConfig()).not.toBeNull();
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    expect(billingConfig()).toBeNull();
  });
});

describe("webhook authenticity and idempotency", () => {
  it("answers 503 when billing is off, 400 for a bad or stale signature, and ignores other events", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await send("invoice.paid", { object: "invoice", customer: "cus_X" })).status).toBe(503);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WHSEC);
    expect((await send("invoice.paid", { object: "invoice", customer: "cus_X" }, { secret: "whsec_wrong" })).status).toBe(400);
    expect((await send("invoice.paid", { object: "invoice", customer: "cus_X" }, { timestamp: Math.floor(Date.now() / 1000) - 600 })).status).toBe(400);
    expect(await handleStripeWebhook("{}", null)).toEqual({ status: 400, message: "bad signature" });
    expect(await send("product.created", { object: "product" })).toEqual({ status: 200, message: "ignored" });
  });

  it("refuses a live-mode event even with a valid signature, before it touches anything (Security B5)", async () => {
    const { ctx, customer, sub } = await payingWorkspace();
    sub.status = "canceled";
    expect(await send("customer.subscription.deleted", { object: "subscription", id: sub.id, customer }, { id: "evt_Live1", livemode: true })).toEqual({
      status: 400,
      message: "live events refused",
    });
    expect(await plan(ctx)).toBe("pro");
    expect(await db.root((tx) => tx.query("select 1 from app.stripe_events where id = 'evt_Live1'"))).toEqual([]);
  });

  it("processes an event once: a redelivery is acknowledged without re-reading Stripe", async () => {
    const ctx = await realWorkspace();
    await startCheckout(ctx, true);
    const customer = await customerOf(ctx);
    const sub = subscription("sub_Once1", customer);
    const event = { object: "checkout.session", customer, subscription: sub.id };
    expect(await send("checkout.session.completed", event, { id: "evt_Once1" })).toEqual({ status: 200, message: "ok" });
    const reads = fake.retrieves;
    expect(await send("checkout.session.completed", event, { id: "evt_Once1" })).toEqual({ status: 200, message: "duplicate" });
    expect(fake.retrieves).toBe(reads);
    expect(await plan(ctx)).toBe("pro");
  });

  it("makes Stripe retry while a claim is in progress, takes over a stale claim, and releases a failed one", async () => {
    const ctx = await realWorkspace();
    await startCheckout(ctx, true);
    const customer = await customerOf(ctx);
    const sub = subscription("sub_Lease1", customer);
    const event = { object: "checkout.session", customer, subscription: sub.id };

    await db.root((tx) => tx.query("insert into app.stripe_events (id, type) values ('evt_Busy1', 'checkout.session.completed')"));
    expect(await send("checkout.session.completed", event, { id: "evt_Busy1" })).toEqual({ status: 409, message: "in progress" });
    await db.root((tx) => tx.query("update app.stripe_events set claimed_at = now() - interval '10 minutes' where id = 'evt_Busy1'"));
    expect(await send("checkout.session.completed", event, { id: "evt_Busy1" })).toEqual({ status: 200, message: "ok" });

    await db.root((tx) => tx.query("update app.billing set status = 'none', plan = 'free' where org_id = $1", [ctx.orgId]));
    fake.failNextRetrieve = true;
    expect(await send("checkout.session.completed", event, { id: "evt_Fail1" })).toEqual({ status: 500, message: "retry" });
    expect(await db.root((tx) => tx.query("select 1 from app.stripe_events where id = 'evt_Fail1'"))).toEqual([]);
    expect(await plan(ctx)).toBe("free");
    expect(await send("checkout.session.completed", event, { id: "evt_Fail1" })).toEqual({ status: 200, message: "ok" });
    expect(await plan(ctx)).toBe("pro");
  });
});

describe("checkout", () => {
  it("needs the owner of a real workspace, the billing agreement, and a Stripe price that matches the site", async () => {
    const ctx = await realWorkspace();
    await expect(startCheckout({ ...ctx, demo: true }, true)).rejects.toThrow(/Sample workspaces/);
    await expect(startCheckout({ ...ctx, role: "admin" }, true)).rejects.toThrow(/owner/);
    await expect(startCheckout(ctx, false)).rejects.toThrow(/Tick the box/);
    fake.price = { ...fake.price, unit_amount: 1200 };
    await expect(startCheckout(ctx, true)).rejects.toThrow(UserError);
    expect(fake.customersCreated).toBe(0);
  });

  it("reuses one Stripe customer, records the agreement, and the success redirect grants nothing", async () => {
    const ctx = await realWorkspace();
    expect(await startCheckout(ctx, true)).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    await startCheckout(ctx, true);
    expect(fake.customersCreated).toBe(1);
    expect(fake.checkouts[1]).toMatchObject({ mode: "subscription", customer: await customerOf(ctx), client_reference_id: ctx.orgId, line_items: [{ price: PRO, quantity: 1 }] });
    expect(fake.checkouts[1].success_url).toBe("http://127.0.0.1:3917/app/settings?billing=success");
    const consents = await db.root((tx) => tx.query("select 1 from app.consents where user_id = $1 and item = 'billing'", [ctx.userId]));
    expect(consents).toHaveLength(2);
    expect(await plan(ctx)).toBe("free");
  });

  it("refuses a second subscription; a duplicate that slipped through is cancelled and its payment refunded, once", async () => {
    const { ctx, customer, sub } = await payingWorkspace();
    await expect(startCheckout(ctx, true)).rejects.toThrow(/already has a subscription/);
    const dup = subscription("sub_Dup1", customer);
    const session = { object: "checkout.session", customer, subscription: dup.id, invoice: "in_Dup1" };
    expect(await send("checkout.session.completed", session)).toEqual({ status: 200, message: "ok" });
    expect(fake.cancelled).toEqual([dup.id]);
    expect(fake.refunded).toEqual(["in_Dup1"]);
    // The same session arriving again (async_payment_succeeded) finds it already cancelled and still succeeds.
    expect(await send("checkout.session.async_payment_succeeded", session)).toEqual({ status: 200, message: "ok" });
    expect(fake.cancelled).toEqual([dup.id]);
    const [row] = await db.root((tx) => tx.query<{ stripe_subscription_id: string }>("select stripe_subscription_id from app.billing where org_id = $1", [ctx.orgId]));
    expect(row.stripe_subscription_id).toBe(sub.id);
  });

  it("opens the billing portal only for the owner of a workspace that has a Stripe customer, and for that customer", async () => {
    await payingWorkspace(); // another workspace's customer exists
    const fresh = await realWorkspace();
    await expect(openPortal(fresh)).rejects.toThrow(/no billing account/);
    const { ctx, customer } = await payingWorkspace();
    await expect(openPortal({ ...ctx, role: "admin" })).rejects.toThrow(/owner/);
    await expect(openPortal({ ...ctx, demo: true })).rejects.toThrow(/Sample workspaces/);
    expect(fake.portals).toEqual([]);
    expect(await openPortal(ctx)).toBe("https://billing.stripe.com/p/session/test_1");
    vi.stubEnv("STRIPE_PORTAL_CONFIG", "bpc_Test1");
    await openPortal(ctx);
    expect(fake.portals).toEqual([
      { customer, return_url: "http://127.0.0.1:3917/app/settings" },
      { customer, return_url: "http://127.0.0.1:3917/app/settings", configuration: "bpc_Test1" },
    ]);
  });
});

describe("access follows the subscription Stripe reports now", () => {
  it("ignores event order: a late 'updated' after 'deleted' can't bring Pro back", async () => {
    const { ctx, customer, sub } = await payingWorkspace();
    sub.status = "canceled";
    await send("customer.subscription.deleted", { object: "subscription", id: sub.id, customer });
    expect(await plan(ctx)).toBe("free");
    await send("customer.subscription.updated", { object: "subscription", id: sub.id, customer, status: "active" });
    expect(await plan(ctx)).toBe("free");
  });

  it("an old subscription's events don't overwrite the live one; a non-Pro price grants nothing", async () => {
    const { ctx, customer } = await payingWorkspace();
    const old = subscription("sub_Old1", customer, { status: "canceled" });
    await send("customer.subscription.updated", { object: "subscription", id: old.id, customer });
    expect(await plan(ctx)).toBe("pro");

    const other = await realWorkspace();
    await startCheckout(other, true);
    const c2 = await customerOf(other);
    const cheap = subscription("sub_Cheap1", c2, { price: "price_Other1" });
    await send("checkout.session.completed", { object: "checkout.session", customer: c2, subscription: cheap.id });
    expect(await plan(other)).toBe("free");
  });

  it("keeps Pro at period end after a cancel request, then Free", async () => {
    const { ctx, customer, sub } = await payingWorkspace();
    sub.cancel_at_period_end = true;
    await send("customer.subscription.updated", { object: "subscription", id: sub.id, customer });
    expect(await billingView(ctx)).toMatchObject({ plan: "pro", cancelAtPeriodEnd: true });
    sub.status = "canceled";
    await send("customer.subscription.deleted", { object: "subscription", id: sub.id, customer });
    expect(await plan(ctx)).toBe("free");
  });

  it("a failed payment keeps Pro for 7 days from the first failure, even though Stripe already moved the period on (Security B2)", async () => {
    const { ctx, customer, sub } = await payingWorkspace();
    // Renewal: Stripe starts the new period, then the charge fails.
    sub.status = "past_due";
    sub.items.data[0].current_period_end = inDays(30);
    await send("invoice.payment_failed", { object: "invoice", customer });
    expect(await plan(ctx)).toBe("pro");
    // A retry fails 8 days after the first failure: the grace is over, period end notwithstanding.
    await db.root((tx) => tx.query("update app.billing set past_due_since = now() - interval '8 days' where org_id = $1", [ctx.orgId]));
    await send("invoice.payment_failed", { object: "invoice", customer });
    expect(await plan(ctx)).toBe("free");
    // Paying clears it.
    sub.status = "active";
    await send("invoice.paid", { object: "invoice", customer });
    expect(await plan(ctx)).toBe("pro");
    const [row] = await db.root((tx) => tx.query<{ past_due_since: string | null }>("select past_due_since from app.billing where org_id = $1", [ctx.orgId]));
    expect(row.past_due_since).toBeNull();
  });

  it("a full refund or a dispute of the live subscription's charge ends Pro at once; a partial refund doesn't", async () => {
    const a = await payingWorkspace();
    fake.charges.set("ch_A1", { customer: a.customer, subscription: a.sub.id });
    await send("charge.refunded", { object: "charge", id: "ch_A1", customer: a.customer, refunded: false });
    expect(await plan(a.ctx)).toBe("pro");
    await send("charge.refunded", { object: "charge", id: "ch_A1", customer: a.customer, refunded: true });
    expect(fake.cancelled).toContain(a.sub.id);
    expect(await plan(a.ctx)).toBe("free");

    // A real dispute names its charge and no customer.
    const b = await payingWorkspace();
    fake.charges.set("ch_Disputed1", { customer: b.customer, subscription: b.sub.id });
    await send("charge.dispute.created", { object: "dispute", charge: "ch_Disputed1" });
    expect(fake.cancelled).toContain(b.sub.id);
    expect(await plan(b.ctx)).toBe("free");

    // A dispute on someone else's charge changes nothing here.
    const c = await payingWorkspace();
    fake.charges.set("ch_Stranger1", { customer: "cus_Stranger1", subscription: "sub_Stranger1" });
    await send("charge.dispute.created", { object: "dispute", charge: "ch_Stranger1" });
    expect(await plan(c.ctx)).toBe("pro");
  });

  it("refunding a cancelled duplicate's charge leaves the live subscription alone (Security B4)", async () => {
    const { ctx, customer, sub } = await payingWorkspace();
    const dup = subscription("sub_Dup2", customer);
    fake.charges.set("ch_Dup2", { customer, subscription: dup.id });
    await send("checkout.session.completed", { object: "checkout.session", customer, subscription: dup.id, invoice: "in_Dup2" });
    await send("charge.refunded", { object: "charge", id: "ch_Dup2", customer, refunded: true });
    expect(fake.cancelled).toEqual([dup.id]);
    expect(fake.cancelled).not.toContain(sub.id);
    expect(await plan(ctx)).toBe("pro");
  });

  it("events for a customer that isn't ours change nothing", async () => {
    expect(await send("invoice.paid", { object: "invoice", customer: "cus_Stranger1" })).toEqual({ status: 200, message: "ok" });
    expect(fake.retrieves).toBe(0);
  });
});

describe("account deletion", () => {
  it("cancels the subscription before deleting, and stops if it can't", async () => {
    const a = await payingWorkspace();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(deleteAccount(a.ctx)).rejects.toThrow(/couldn't be cancelled/);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [a.ctx.orgId]))).toHaveLength(1);
    vi.stubEnv("STRIPE_SECRET_KEY", KEY);
    await deleteAccount(a.ctx);
    expect(fake.cancelled).toEqual([a.sub.id]);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [a.ctx.orgId]))).toEqual([]);
  });

  it("goes ahead when Stripe already ended the subscription but its webhook hasn't arrived", async () => {
    const a = await payingWorkspace();
    a.sub.status = "canceled"; // cancelled in Stripe; our row still says active
    await deleteAccount(a.ctx);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [a.ctx.orgId]))).toEqual([]);
  });

  it("cancels a subscription Stripe has that our database never heard of (Security B3)", async () => {
    const a = await payingWorkspace();
    // A second checkout paid moments ago; its webhook hasn't arrived.
    const unseen = subscription("sub_Unseen1", a.customer);
    // An abandoned checkout of another workspace: a customer, no subscription.
    const b = await realWorkspace();
    await startCheckout(b, true);
    await deleteAccount(a.ctx);
    expect(fake.cancelled.sort()).toEqual([a.sub.id, unseen.id].sort());
    await deleteAccount(b);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = any($1::uuid[])", [[a.ctx.orgId, b.orgId]]))).toEqual([]);
  });

  it("stops if Stripe can't list the subscriptions", async () => {
    const a = await payingWorkspace();
    fake.listSubscriptions = () => Promise.reject(new Error("network"));
    await expect(deleteAccount(a.ctx)).rejects.toThrow(/couldn't be cancelled just now/);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [a.ctx.orgId]))).toHaveLength(1);
  });

  it("when Stripe refuses a cancel, goes ahead only if the subscription has ended meanwhile", async () => {
    const exists = async (orgId: string) => (await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [orgId]))).length === 1;
    const cancel = fake.cancelSubscription.bind(fake);

    // It ended between the list and the cancel (Stripe: "already canceled"): nothing is billed, so delete.
    const ended = await payingWorkspace();
    fake.cancelSubscription = async (id) => {
      ended.sub.status = "canceled";
      return cancel(id);
    };
    await deleteAccount(ended.ctx);
    expect(await exists(ended.ctx.orgId)).toBe(false);

    // The cancel failed and Stripe still reports it active, or can't be read: keep the account.
    const running = await payingWorkspace();
    fake.cancelSubscription = () => Promise.reject(new Error("network"));
    await expect(deleteAccount(running.ctx)).rejects.toThrow(/couldn't be cancelled just now/);
    fake.failNextRetrieve = true;
    await expect(deleteAccount(running.ctx)).rejects.toThrow(/couldn't be cancelled just now/);
    expect(await exists(running.ctx.orgId)).toBe(true);
  });

  it("a co-owner leaving mid-deletion can't leave a deleted workspace billed (Security F5-r2)", async () => {
    // The database refuses to delete a billed workspace whose billing wasn't handled.
    const solo = await payingWorkspace();
    await expect(asUser(solo.ctx.userId, (tx) => tx.query("select * from app.delete_my_account('{}'::uuid[])"))).rejects.toMatchObject({ code: "SS001" });
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [solo.ctx.orgId]))).toHaveLength(1);

    // W is paying and co-owned by A and B; A also solely owns X, which has a Stripe customer.
    const w = await payingWorkspace();
    const a = w.ctx.userId;
    const b = await db.user(`coowner${++seq}@example.com`);
    await db.root((tx) => tx.query("insert into app.members (org_id, user_id, role) values ($1, $2, 'owner')", [w.ctx.orgId, b]));
    const [x] = await asUser(a, (tx) => tx.query<{ id: string }>("select app.create_workspace('Second Co') as id"));
    await startCheckout({ ...w.ctx, orgId: x.id, name: "Second Co" }, true);

    // While A's deletion is asking Stripe about X (W isn't A's to cancel yet), B deletes their account,
    // which leaves A as W's only owner.
    const list = fake.listSubscriptions.bind(fake);
    let raced = false;
    fake.listSubscriptions = async (customer: string) => {
      if (!raced) {
        raced = true;
        await deleteAccount({ userId: b, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: w.ctx.orgId, name: "Real Co", role: "owner" });
      }
      return list(customer);
    };
    await deleteAccount(w.ctx);
    expect(raced).toBe(true);
    expect(fake.cancelled).toEqual([w.sub.id]);
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = any($1::uuid[])", [[w.ctx.orgId, x.id]]))).toEqual([]);
  });
});

describe("plan limits, enforced by the server", () => {
  it("Free: 10 active documents, 1 open passport link, no signature requests; Pro lifts them", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await realWorkspace();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await uploadDocument(ctx, { title: `Doc ${i}`, kind: "other" }, bytes));
    await expect(uploadDocument(ctx, { title: "Doc 11", kind: "other" }, bytes)).rejects.toThrow(PlanLimit);

    await createPassport(ctx, { label: "One", days: 7, documentIds: [ids[0]] });
    await expect(createPassport(ctx, { label: "Two", days: 7, documentIds: [ids[1]] })).rejects.toThrow(PlanLimit);
    await expect(requestSignature(ctx, { documentId: ids[0], signerName: "Jordan Lee", signerEmail: "jordan@example.com", days: 7 })).rejects.toThrow(PlanLimit);

    await startCheckout(ctx, true);
    const customer = await customerOf(ctx);
    const sub = subscription(`sub_L${++seq}`, customer);
    await send("checkout.session.completed", { object: "checkout.session", customer, subscription: sub.id });
    await uploadDocument(ctx, { title: "Doc 11", kind: "other" }, bytes);
    await createPassport(ctx, { label: "Two", days: 7, documentIds: [ids[1]] });
    await requestSignature(ctx, { documentId: ids[0], signerName: "Jordan Lee", signerEmail: "jordan@example.com", days: 7 });
  });
});
