import "server-only";
import { realDocsEnabled } from "./flags";

// Kept apart from billing.ts so that reading "is billing on?" (plan-limit messages, the status page) doesn't load the
// Stripe SDK into the public share, sign and collect routes, which reach the plan check through passport, documents
// and esign. Every /app page still loads it: app/app/layout.tsx → account.ts → billing.ts.

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
