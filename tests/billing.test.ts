import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as healthGet } from "@/app/api/health/route";
import { deleteAccount } from "@/lib/server/account";
import {
  billingView,
  handleStripeWebhook,
  openPortal,
  setStripeForTests,
  startCheckout,
  StripeCallFailed,
  type StripePort,
  type SubscriptionState,
} from "@/lib/server/billing";
import { billingConfig } from "@/lib/server/billing-config";
import { asUser } from "@/lib/server/db";
import { setArchived, uploadDocument } from "@/lib/server/documents";
import { PlanLimit, UserError } from "@/lib/server/errors";
import { requestSignature } from "@/lib/server/esign";
import { createPassport, revokePassport } from "@/lib/server/passport";
import type { Ctx } from "@/lib/server/profile";
import { localBlobStore, setBlobStoreForTests } from "@/lib/server/storage";
import { isoToday } from "@/lib/today";
import { freshDb, type TestDb } from "./support/db";

/** The live-key tests run under final terms (goLive); every other test under the real TERMS_VERSION. */
const FINAL_TERMS = "2026-12-01";
const legal = vi.hoisted(() => ({ version: "", real: "" }));
vi.mock("@/lib/legal", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/legal")>();
  legal.real = real.TERMS_VERSION;
  legal.version = real.TERMS_VERSION;
  return {
    ...real,
    get TERMS_VERSION() {
      return legal.version;
    },
  };
});

/** Stripe billing in test mode (stripe-billing-readiness checks A-H), against a fake Stripe. */

const KEY = `sk_test_${"a".repeat(24)}`;
const LIVE = `rk_live_${"a".repeat(24)}`;
const WHSEC = "whsec_testsecret123";
const PRO = "price_Pro1";

/** Everything Vercel's Production needs before it takes real money (Security L3). */
function goLive() {
  legal.version = FINAL_TERMS;
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SHIPSHAPE_CHECKOUT_LIVE", "1");
  vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
  vi.stubEnv("SHIPSHAPE_APP_URL", "https://shipshape.example.com");
  vi.stubEnv("STRIPE_SECRET_KEY", LIVE);
}

class FakeStripe implements StripePort {
  subs = new Map<string, SubscriptionState>();
  checkouts: Stripe.Checkout.SessionCreateParams[] = [];
  cancelled: string[] = [];
  customersCreated = 0;
  retrieves = 0;
  failNextRetrieve = false;
  price: Awaited<ReturnType<StripePort["retrievePrice"]>> = { active: true, unit_amount: 1500, currency: "usd", recurring: { interval: "month", interval_count: 1 } };

  async createCustomer() {
    this.customersCreated++;
    return { id: `cus_T${++seq}` };
  }
  async createCheckout(params: Stripe.Checkout.SessionCreateParams) {
    this.checkouts.push(params);
    if (typeof params.customer === "string") this.openCheckout(params.customer);
    return { url: "https://checkout.stripe.com/c/pay/cs_test_1" };
  }
  /** Checkout Sessions by id; createCheckout opens one for its customer. */
  sessions = new Map<string, { id: string; customer: string; status: "open" | "complete" | "expired" }>();
  expired: string[] = [];
  /** A session the buyer pays between the deletion's list and its expire: Stripe then refuses the expire. */
  paidBeforeExpire: string | null = null;
  /** The order of the deletion's Stripe calls. */
  calls: string[] = [];
  openCheckout(customer: string) {
    const id = `cs_test_${++seq}`;
    this.sessions.set(id, { id, customer, status: "open" });
    return id;
  }
  async listOpenCheckouts(customer: string) {
    this.calls.push("listOpenCheckouts");
    return [...this.sessions.values()].filter((s) => s.customer === customer && s.status === "open").map((s) => ({ id: s.id, status: s.status }));
  }
  async expireCheckout(id: string) {
    this.calls.push("expireCheckout");
    const s = this.sessions.get(id);
    if (s && this.paidBeforeExpire === id) s.status = "complete";
    if (!s || s.status !== "open") {
      // As Stripe answers for a session that already completed or expired.
      throw new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: 'Only Checkout Sessions with a status in ["open"] can be expired.' });
    }
    s.status = "expired";
    this.expired.push(id);
    return s;
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
    this.calls.push("listSubscriptions");
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
  return { userId, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: org.id, name: "Real Co", role: "owner", today: isoToday() };
}

const plan = async (ctx: Ctx) => (await billingView(ctx)).plan;
const customerOf = async (ctx: Ctx) =>
  (await db.root((tx) => tx.query<{ stripe_customer_id: string }>("select stripe_customer_id from app.billing where org_id = $1", [ctx.orgId])))[0].stripe_customer_id;

/** A paying workspace: checkout, then Stripe's completed event. */
async function payingWorkspace() {
  const ctx = await realWorkspace();
  await startCheckout(ctx, true);
  const customer = await customerOf(ctx);
  for (const s of fake.sessions.values()) if (s.customer === customer) s.status = "complete";
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
  legal.version = legal.real;
  fake = new FakeStripe();
  setStripeForTests(fake);
  vi.stubEnv("BILLING_ENABLED", "1");
  vi.stubEnv("SHIPSHAPE_CHECKOUT_LIVE", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("SHIPSHAPE_REAL_DOCS", undefined);
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
  it("is off unless BILLING_ENABLED is 1, even with every Stripe variable set (W9-14)", () => {
    vi.stubEnv("STRIPE_PORTAL_CONFIG", "bpc_Test1");
    vi.stubEnv("BILLING_ENABLED", undefined);
    expect(billingConfig()).toBeNull();
    vi.stubEnv("BILLING_ENABLED", "true");
    expect(billingConfig()).toBeNull();
    vi.stubEnv("BILLING_ENABLED", "1");
    expect(billingConfig()).toEqual({ secretKey: KEY, webhookSecret: WHSEC, proPrice: PRO, appUrl: "http://127.0.0.1:3917", live: false, automaticTax: false, checkoutPaused: false });
  });

  it("outside Vercel's Production takes only a test key: a live key switches billing off there, flag or not", () => {
    expect(billingConfig()).not.toBeNull();
    for (const env of [undefined, "preview", "development"]) {
      vi.stubEnv("VERCEL_ENV", env);
      for (const key of [`sk_live_${"a".repeat(24)}`, LIVE, ` ${KEY}`, `${KEY}\n`]) {
        vi.stubEnv("STRIPE_SECRET_KEY", key);
        vi.stubEnv("SHIPSHAPE_CHECKOUT_LIVE", "1");
        legal.version = FINAL_TERMS;
        expect(billingConfig()).toBeNull();
      }
      vi.stubEnv("STRIPE_SECRET_KEY", KEY);
      expect(billingConfig()).toMatchObject({ secretKey: KEY, live: false });
    }
  });

  it("Vercel's Production takes real money only with an rk_live_ key, the flag exactly 1, final terms, real documents and https (Security L3)", () => {
    goLive();
    expect(billingConfig()).toEqual({ secretKey: LIVE, webhookSecret: WHSEC, proPrice: PRO, appUrl: "https://shipshape.example.com", live: true, automaticTax: false, checkoutPaused: false });
    const refused: [string, string | undefined][] = [
      ["SHIPSHAPE_CHECKOUT_LIVE", undefined],
      ["SHIPSHAPE_CHECKOUT_LIVE", "true"],
      ["SHIPSHAPE_CHECKOUT_LIVE", " 1"],
      ["SHIPSHAPE_CHECKOUT_LIVE", "1\n"],
      ["STRIPE_SECRET_KEY", `sk_live_${"a".repeat(24)}`],
      ["STRIPE_SECRET_KEY", `RK_LIVE_${"a".repeat(24)}`],
      ["STRIPE_SECRET_KEY", ` ${LIVE}`],
      ["STRIPE_SECRET_KEY", `${LIVE}\n`],
      ["STRIPE_SECRET_KEY", `${LIVE} `],
      ["STRIPE_SECRET_KEY", `pk_live_${"a".repeat(24)}`],
      ["SHIPSHAPE_REAL_DOCS", undefined],
      ["SHIPSHAPE_APP_URL", "http://shipshape.example.com"],
      ["VERCEL_ENV", "preview"],
      ["BILLING_ENABLED", undefined],
    ];
    for (const [name, value] of refused) {
      goLive();
      vi.stubEnv(name, value);
      expect([name, value, billingConfig()]).toEqual([name, value, null]);
    }
    goLive();
    legal.version = legal.real;
    expect(billingConfig()).toBeNull();
  });

  it("Vercel's Production refuses a test key, real documents or not, so a test card can't buy Pro in the production database", () => {
    goLive();
    vi.stubEnv("STRIPE_SECRET_KEY", KEY);
    expect(billingConfig()).toBeNull();
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", undefined);
    expect(billingConfig()).toBeNull();
    vi.stubEnv("STRIPE_SECRET_KEY", `rk_test_${"a".repeat(24)}`);
    expect(billingConfig()).toBeNull();
  });

  it("refuses a live key while the terms are a draft, since draft terms say no real money moves (W13-5)", async () => {
    const ctx = await realWorkspace();
    goLive();
    legal.version = "2026-12-01-draft";
    expect(billingConfig()).toBeNull();
    expect(await billingView(ctx)).toMatchObject({ available: false, live: false });
    legal.version = FINAL_TERMS;
    expect(billingConfig()).toMatchObject({ live: true });
    expect(await billingView(ctx)).toMatchObject({ available: true, live: true });
  });

  it("the terms in force aren't a draft, so a live key can be admitted with them", () => {
    expect(legal.real).not.toMatch(/-draft$/);
    goLive();
    legal.version = legal.real;
    expect(billingConfig()).toMatchObject({ live: true });
  });

  it("tells members whether payments take real money: live only for an admitted live key", async () => {
    legal.version = FINAL_TERMS;
    const ctx = await realWorkspace();
    expect(await billingView(ctx)).toMatchObject({ available: true, live: false });
    goLive();
    vi.stubEnv("SHIPSHAPE_CHECKOUT_LIVE", undefined);
    expect(await billingView(ctx)).toMatchObject({ available: false, live: false });
    vi.stubEnv("SHIPSHAPE_CHECKOUT_LIVE", "1");
    expect(await billingView(ctx)).toMatchObject({ available: true, live: true });
    vi.stubEnv("BILLING_ENABLED", undefined);
    expect(await billingView(ctx)).toMatchObject({ available: false, live: false });
  });

  it("is off in a production build outside Vercel's Production once real documents are on, so a test card can't buy real Pro", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(billingConfig()).not.toBeNull();
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    expect(billingConfig()).toBeNull();
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(billingConfig()).toBeNull();
  });

  it("health names the billing mode and whether a webhook secret is set, never a key (Security L4)", async () => {
    const mode = async () => {
      const res = await healthGet();
      const text = await res.text();
      expect(text).not.toMatch(/sk_|rk_|whsec_|price_/);
      const body = JSON.parse(text);
      return [body.billing, body.checkout, body.webhookConfigured];
    };
    expect(await mode()).toEqual(["test", "open", true]);
    goLive();
    expect(await mode()).toEqual(["live", "open", true]);
    vi.stubEnv("SHIPSHAPE_CHECKOUT_PAUSED", "true");
    expect(await mode()).toEqual(["live", "open", true]);
    vi.stubEnv("SHIPSHAPE_CHECKOUT_PAUSED", "1");
    expect(await mode()).toEqual(["live", "paused", true]);
    vi.stubEnv("SHIPSHAPE_CHECKOUT_LIVE", undefined);
    expect(await mode()).toEqual(["off", "off", true]);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined);
    expect(await mode()).toEqual(["off", "off", false]);
  });
});

describe("webhook authenticity and idempotency", () => {
  it("answers 503 when billing is off, 400 for a bad or stale signature, and ignores other events", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await send("invoice.paid", { object: "invoice", customer: "cus_X" })).status).toBe(503);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", WHSEC);
    vi.stubEnv("BILLING_ENABLED", undefined);
    expect(await send("invoice.paid", { object: "invoice", customer: "cus_X" })).toEqual({ status: 503, message: "billing off" });
    vi.stubEnv("BILLING_ENABLED", "1");
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

  it("with a live key admitted, takes live-mode events and refuses test-mode ones", async () => {
    goLive();
    expect(await send("product.created", { object: "product" }, { livemode: true })).toEqual({ status: 200, message: "ignored" });
    expect(await send("invoice.paid", { object: "invoice", customer: "cus_X" }, { id: "evt_Test1" })).toEqual({ status: 400, message: "test events refused" });
    expect(await db.root((tx) => tx.query("select 1 from app.stripe_events where id = 'evt_Test1'"))).toEqual([]);
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
    await expect(startCheckout(ctx, false)).rejects.toThrow(/Check the box/);
    fake.price = { ...fake.price, unit_amount: 1200 };
    await expect(startCheckout(ctx, true)).rejects.toThrow(UserError);
    expect(fake.customersCreated).toBe(0);
  });

  it("adds Stripe Tax to the checkout only with STRIPE_AUTOMATIC_TAX exactly 1, saving the buyer's address to the customer", async () => {
    const ctx = await realWorkspace();
    await startCheckout(ctx, true);
    expect(fake.checkouts.at(-1)).not.toHaveProperty("automatic_tax");
    expect(fake.checkouts.at(-1)).not.toHaveProperty("customer_update");
    vi.stubEnv("STRIPE_AUTOMATIC_TAX", "true");
    await startCheckout(await realWorkspace(), true);
    expect(fake.checkouts.at(-1)).not.toHaveProperty("automatic_tax");
    vi.stubEnv("STRIPE_AUTOMATIC_TAX", "1");
    await startCheckout(await realWorkspace(), true);
    expect(fake.checkouts.at(-1)).toMatchObject({ automatic_tax: { enabled: true }, customer_update: { address: "auto" } });
  });

  it("a failed Stripe call leaves billing as its type, code and status only, never Stripe's message (it can name the key)", async () => {
    const ctx = await realWorkspace();
    const leak = "Invalid API Key provided: sk_test_****************abcd";
    fake.createCheckout = async () => {
      throw new Stripe.errors.StripeAuthenticationError({ message: leak, statusCode: 401 });
    };
    const failure = await startCheckout(ctx, true).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(StripeCallFailed);
    expect(failure).toMatchObject({ name: "StripeAuthenticationError", message: "Stripe StripeAuthenticationError (HTTP 401)" });
    expect(String(failure)).not.toContain("sk_test_");
    fake.createCheckout = async () => {
      throw new Error(leak);
    };
    const other = await startCheckout(ctx, true).catch((e: unknown) => e);
    expect(other).toMatchObject({ name: "StripeCallFailed", message: "Stripe call failed" });
  });

  it("every Stripe call on the checkout and portal paths fails as type and status only (Security SHOULD-2)", async () => {
    const boom = async (): Promise<never> => {
      throw new Stripe.errors.StripeAuthenticationError({ message: "Invalid API Key provided: sk_test_****abcd", statusCode: 401 });
    };
    for (const m of ["retrievePrice", "createCustomer", "createCheckout"] as const) {
      fake = new FakeStripe();
      setStripeForTests(fake);
      fake[m] = boom;
      const e = await startCheckout(await realWorkspace(), true).catch((x: unknown) => x);
      expect([m, String(e)]).toEqual([m, "StripeAuthenticationError: Stripe StripeAuthenticationError (HTTP 401)"]);
    }
    const ctx = await realWorkspace();
    fake = new FakeStripe();
    setStripeForTests(fake);
    await startCheckout(ctx, true);
    fake.createPortal = boom;
    expect(String(await openPortal(ctx).catch((x: unknown) => x))).toBe("StripeAuthenticationError: Stripe StripeAuthenticationError (HTTP 401)");
  });

  it("paused (SHIPSHAPE_CHECKOUT_PAUSED exactly 1): no new checkout and no Stripe call, while the portal and the webhook keep working", async () => {
    const { ctx, customer } = await payingWorkspace();
    const fresh = await realWorkspace();
    const made = fake.checkouts.length;
    vi.stubEnv("SHIPSHAPE_CHECKOUT_PAUSED", "true");
    await startCheckout(fresh, true);
    expect(fake.checkouts).toHaveLength(made + 1);
    vi.stubEnv("SHIPSHAPE_CHECKOUT_PAUSED", "1");
    const before = fake.customersCreated;
    await expect(startCheckout(await realWorkspace(), true)).rejects.toThrow("New Pro subscriptions are paused for now. Nothing was charged.");
    expect([fake.checkouts.length, fake.customersCreated]).toEqual([made + 1, before]);
    expect(await openPortal(ctx)).toMatch(/^https:\/\/billing\.stripe\.com\//);
    expect(await send("customer.subscription.deleted", { ...subscription("sub_Paused1", customer), status: "canceled" })).toEqual({ status: 200, message: "ok" });
  });

  it("refuses checkout and the billing portal while payments are switched off", async () => {
    const ctx = await realWorkspace();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(startCheckout(ctx, true)).rejects.toThrow(/aren't switched on/);
    await expect(openPortal(ctx)).rejects.toThrow(/aren't switched on/);
    expect(fake.customersCreated).toBe(0);
  });

  it("refuses checkout when the Stripe price is in another currency, archived, not monthly, or not every single month (Security SHOULD-1)", async () => {
    const good = fake.price;
    const bad: Partial<typeof good>[] = [
      { currency: "eur" },
      { active: false },
      { recurring: { interval: "year", interval_count: 1 } },
      { recurring: { interval: "month", interval_count: 3 } },
      { recurring: null },
    ];
    for (const b of bad) {
      fake.price = { ...good, ...b };
      await expect(startCheckout(await realWorkspace(), true)).rejects.toThrow("Payments are paused while we fix a price mismatch. Nothing was charged; try again later.");
    }
    expect(fake.checkouts).toEqual([]);
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
    await expect(startCheckout(ctx, true)).rejects.toThrow("This workspace already has a subscription. Change it with Manage billing.");
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
    await expect(openPortal(fresh)).rejects.toThrow("There's no billing account for this workspace yet. It's made when you move to Pro.");
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
    await expect(deleteAccount(a.ctx)).rejects.toThrow(
      "Your subscription couldn't be cancelled automatically, so nothing was deleted.",
    );
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

  it("stops if Stripe can't list the open checkouts or the subscriptions", async () => {
    const a = await payingWorkspace();
    const listOpen = fake.listOpenCheckouts.bind(fake);
    fake.listOpenCheckouts = () => Promise.reject(new Error("network"));
    await expect(deleteAccount(a.ctx)).rejects.toThrow(
      "Your subscription couldn't be cancelled just now. Try again in a minute, or cancel it with Manage billing under Plan first.",
    );
    expect(fake.calls).not.toContain("listSubscriptions");
    fake.listOpenCheckouts = listOpen;
    fake.listSubscriptions = () => Promise.reject(new Error("network"));
    await expect(deleteAccount(a.ctx)).rejects.toThrow(
      "Your subscription couldn't be cancelled just now. Try again in a minute, or cancel it with Manage billing under Plan first.",
    );
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [a.ctx.orgId]))).toHaveLength(1);
  });

  it("expires every open checkout before it lists the subscriptions, so a Stripe tab left open can't be paid after the deletion (W9-2)", async () => {
    const a = await realWorkspace();
    await startCheckout(a, true); // "Move to Pro": the Stripe tab is open
    const customer = await customerOf(a);
    for (let i = 0; i < 150; i++) fake.openCheckout(customer);
    await deleteAccount(a);
    expect(fake.expired).toHaveLength(151);
    expect([...fake.sessions.values()].filter((s) => s.customer === customer && s.status === "open")).toEqual([]);
    expect(fake.calls[0]).toBe("listOpenCheckouts");
    expect(fake.calls.indexOf("listSubscriptions")).toBeGreaterThan(fake.calls.lastIndexOf("expireCheckout"));
    expect(await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [a.orgId]))).toEqual([]);
  });

  it("a checkout paid as the deletion expires it doesn't stop the deletion, and its subscription is cancelled; one still open does stop it (W9-2)", async () => {
    const exists = async (orgId: string) => (await db.root((tx) => tx.query("select 1 from app.organizations where id = $1", [orgId]))).length === 1;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const expire = fake.expireCheckout.bind(fake);

    // Paid between the list and the expire: Stripe refuses the expire as "not open", and the payment made a subscription.
    const a = await realWorkspace();
    await startCheckout(a, true);
    const customer = await customerOf(a);
    const paid = fake.openCheckout(customer);
    fake.paidBeforeExpire = paid;
    fake.expireCheckout = async (id) => {
      if (id === paid) subscription("sub_PaidMeanwhile1", customer);
      return expire(id);
    };
    await deleteAccount(a);
    expect(await exists(a.orgId)).toBe(false);
    expect(fake.sessions.get(paid)?.status).toBe("complete");
    expect(fake.cancelled).toEqual(["sub_PaidMeanwhile1"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already ended"));

    // Stripe can't be reached for the expire and the session is still open: keep the account. A retry finishes.
    const b = await realWorkspace();
    await startCheckout(b, true);
    fake.calls = [];
    fake.expireCheckout = () => Promise.reject(new Error("network"));
    await expect(deleteAccount(b)).rejects.toThrow(/couldn't be cancelled just now/);
    expect(fake.calls).not.toContain("listSubscriptions");
    expect(await exists(b.orgId)).toBe(true);
    fake.expireCheckout = expire;
    await deleteAccount(b);
    expect(await exists(b.orgId)).toBe(false);
    warn.mockRestore();
  });

  it("a checkout completed for a deleted workspace's customer is acknowledged, logged and attached to nothing (W9-2)", async () => {
    const a = await realWorkspace();
    await startCheckout(a, true);
    const customer = await customerOf(a);
    await deleteAccount(a);
    // Stripe sends the completion anyway (paid moments before the expire landed).
    const sub = subscription("sub_Late1", customer);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = { object: "checkout.session", customer, subscription: sub.id, invoice: "in_Late1" };
    expect(await send("checkout.session.completed", event, { id: "evt_Late1" })).toEqual({ status: 200, message: "ok" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("evt_Late1"));
    warn.mockRestore();
    expect(await db.root((tx) => tx.query("select 1 from app.billing where stripe_customer_id = $1 or stripe_subscription_id = $2", [customer, sub.id]))).toEqual([]);
    expect(await db.root((tx) => tx.query("select 1 from app.stripe_events where id = 'evt_Late1' and finished_at is not null"))).toHaveLength(1);
    expect(fake.cancelled).toEqual([]);
    expect(fake.refunded).toEqual([]);
    expect(fake.retrieves).toBe(0);
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
        await deleteAccount({ userId: b, demo: false, authAt: Math.floor(Date.now() / 1000), orgId: w.ctx.orgId, name: "Real Co", role: "owner", today: isoToday() });
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
    await expect(requestSignature(ctx, { documentId: ids[0], signerName: "Jordan Lee", signerEmail: "jordan@example.com", days: 7 }, "192.0.2.10")).rejects.toThrow(PlanLimit);

    await startCheckout(ctx, true);
    const customer = await customerOf(ctx);
    const sub = subscription(`sub_L${++seq}`, customer);
    await send("checkout.session.completed", { object: "checkout.session", customer, subscription: sub.id });
    await uploadDocument(ctx, { title: "Doc 11", kind: "other" }, bytes);
    await createPassport(ctx, { label: "Two", days: 7, documentIds: [ids[1]] });
    await requestSignature(ctx, { documentId: ids[0], signerName: "Jordan Lee", signerEmail: "jordan@example.com", days: 7 }, "192.0.2.10");
  });

  it("Free counts only active documents: archiving one of ten makes room for another, and it can't come back over the limit", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await realWorkspace();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await uploadDocument(ctx, { title: `Doc ${i}`, kind: "other" }, bytes));
    await setArchived(ctx, ids[0], true);
    await uploadDocument(ctx, { title: "Doc 11", kind: "other" }, bytes);
    await expect(setArchived(ctx, ids[0], false)).rejects.toThrow(PlanLimit);
  });

  it("Free counts only open passport links: an expired or a revoked link makes room for a new one", async () => {
    vi.stubEnv("SHIPSHAPE_REAL_DOCS", "1");
    const ctx = await realWorkspace();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const doc = await uploadDocument(ctx, { title: "License", kind: "other" }, await pdf.save());
    const link = () => createPassport(ctx, { label: "For a client", days: 7, documentIds: [doc] });
    const expired = await link();
    await db.root((tx) => tx.query("update app.share_links set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [expired.id]));
    const revoked = await link();
    await revokePassport(ctx, revoked.id);
    await link();
    await expect(link()).rejects.toThrow(PlanLimit);
  });
});
