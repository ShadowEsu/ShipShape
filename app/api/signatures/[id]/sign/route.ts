import { CONSENT_TEXT } from "@/lib/consent";
import { body, clientIp, fail, json } from "@/lib/http";
import { store } from "@/lib/store";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { typedName, consent } = await body<{ typedName: string; consent: boolean }>(req);
  if (consent !== true) return fail("You must agree to sign electronically");
  if (!typedName || typedName.trim().length < 2) return fail("Type your full name to sign");
  try {
    const signed = await store.sign(id, {
      typedName: typedName.trim(),
      at: new Date().toISOString(),
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent") ?? "unknown",
      consent: CONSENT_TEXT,
    });
    return json(signed);
  } catch (e) {
    return fail((e as Error).message, 409);
  }
}
