import { handleSesNotification } from "@/lib/server/mail";

export const dynamic = "force-dynamic";

/**
 * SES bounces and complaints, posted by infra/mail.yaml's SNS topic (Security 2026-11-04 0715, answer 5:
 * the suppression list). 404 while email is off. Outside proxy.ts's matcher, so the raw body reaches the
 * signature check untouched.
 */
export async function POST(req: Request) {
  const { status, message } = await handleSesNotification(await req.text());
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}
