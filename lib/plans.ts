/**
 * What each plan includes. The pricing page, the app and the server's limits all read this table,
 * so what's shown is what's enforced. The Pro price must equal the Stripe price configured in
 * STRIPE_PRICE_PRO: checkout refuses to start if they differ.
 */
export type PlanId = "free" | "pro";

export interface Plan {
  name: string;
  /** US dollars per month. */
  price: number;
  /** null = no limit */
  documents: number | null;
  /** Passport links open at the same time; null = no limit */
  passports: number | null;
  esign: boolean;
  emailReminders: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { name: "Free", price: 0, documents: 10, passports: 1, esign: false, emailReminders: false },
  pro: { name: "Pro", price: 15, documents: null, passports: null, esign: true, emailReminders: true },
};
