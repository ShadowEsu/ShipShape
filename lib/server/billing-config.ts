import "server-only";
import { TERMS_VERSION } from "@/lib/legal";
import { realDocsEnabled } from "./flags";

// Kept apart from billing.ts so that reading "is billing on?" (plan-limit messages, the status page) doesn't load the
// Stripe SDK into the public share, sign and collect routes, which reach the plan check through passport, documents
// and esign. Every /app page still loads it: app/app/layout.tsx → account.ts → billing.ts.

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9]{10,}$/;
// A restricted key only (its scopes in PRESTON-STRIPE-LIVE.md): a full sk_live_ key could do anything to the account.
const LIVE_KEY = /^rk_live_[A-Za-z0-9]{10,}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]+$/;

export interface BillingConfig {
  secretKey: string;
  webhookSecret: string;
  proPrice: string;
  appUrl: string;
  /** Real money: Vercel's Production with a restricted live key, SHIPSHAPE_CHECKOUT_LIVE=1, final terms and real documents. */
  live: boolean;
  /** Stripe Tax on the checkout, only with STRIPE_AUTOMATIC_TAX exactly "1" (Preston turns Stripe Tax on in the Dashboard first). */
  automaticTax: boolean;
  /**
   * New Pro checkouts stopped (SHIPSHAPE_CHECKOUT_PAUSED exactly "1"), while the webhook, the billing portal and account
   * deletion keep working for people who already pay: the gentle way to stop selling (PRESTON-STRIPE-LIVE.md, part G).
   */
  checkoutPaused: boolean;
}

/**
 * Billing is on only when BILLING_ENABLED is "1" and there's a Stripe key, a webhook secret, the
 * Pro price and the app URL. Which key depends on where it runs, and anything else turns billing off
 * before any Stripe call:
 * - Vercel's Production takes real money or none: an rk_live_ key (never sk_live_), with
 *   SHIPSHAPE_CHECKOUT_LIVE exactly "1", final terms (a draft says no real money moves, W13-5), real
 *   documents on (Pro sells nothing while uploads are closed) and an https app URL. A test key there
 *   is refused: a test card would buy Pro in the production database, and keep it once money is real.
 * - Everywhere else (previews, local, CI) a test key only, and none in a production build with real
 *   documents on.
 */
export function billingConfig(): BillingConfig | null {
  if (process.env.BILLING_ENABLED !== "1") return null;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const proPrice = process.env.STRIPE_PRICE_PRO ?? "";
  const appUrl = process.env.SHIPSHAPE_APP_URL ?? "";
  const live = process.env.VERCEL_ENV === "production";
  const keyOk = live
    ? LIVE_KEY.test(secretKey) && process.env.SHIPSHAPE_CHECKOUT_LIVE === "1" && !TERMS_VERSION.endsWith("-draft") && realDocsEnabled() && appUrl.startsWith("https://")
    : TEST_KEY.test(secretKey) && !(process.env.NODE_ENV === "production" && realDocsEnabled());
  if (!keyOk || !webhookConfigured() || !/^price_[A-Za-z0-9]+$/.test(proPrice)) return null;
  if (!/^https?:\/\/[^/\s]+$/.test(appUrl)) return null;
  return {
    secretKey,
    webhookSecret,
    proPrice,
    appUrl,
    live,
    automaticTax: process.env.STRIPE_AUTOMATIC_TAX === "1",
    checkoutPaused: process.env.SHIPSHAPE_CHECKOUT_PAUSED === "1",
  };
}

/** Whether payments take real money here: the pages drop their test-mode lines then (Security L6). */
export function paymentsLive(): boolean {
  return billingConfig()?.live === true;
}

/** Whether a Stripe webhook signing secret is set (its form only), for the health check. */
export function webhookConfigured(): boolean {
  return WEBHOOK_SECRET.test(process.env.STRIPE_WEBHOOK_SECRET ?? "");
}
