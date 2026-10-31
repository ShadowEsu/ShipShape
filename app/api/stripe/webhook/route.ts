import { handleStripeWebhook } from "@/lib/server/billing";

export const dynamic = "force-dynamic";

/** Stripe webhooks. Outside proxy.ts's matcher, so the raw body reaches the signature check untouched. */
export async function POST(req: Request) {
  const { status, message } = await handleStripeWebhook(await req.text(), req.headers.get("stripe-signature"));
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}
