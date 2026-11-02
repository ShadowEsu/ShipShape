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
  /** Bytes of stored files in all (every version, archived documents included); null = no limit */
  files: number | null;
  esign: boolean;
  emailReminders: boolean;
}

// `satisfies`, not a type annotation: Free's numbers stay plain numbers, so a sentence can print them without a null check.
export const PLANS = {
  free: { name: "Free", price: 0, documents: 10, passports: 1, files: 100 * 1024 * 1024, esign: false, emailReminders: false },
  pro: { name: "Pro", price: 15, documents: null, passports: null, files: null, esign: true, emailReminders: true },
} satisfies Record<PlanId, Plan>;

/** A byte count as people read it on a page: 104857600 is "100 MB". */
export const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
