import { z } from "zod";
import { asService } from "@/lib/server/db";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "@/lib/server/http";

const Body = z.object({ email: z.string().trim().toLowerCase().max(200).pipe(z.email()) });

export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  if (await rateLimited("waitlist", clientIp(req.headers), 10, 3600)) return tooMany();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Enter a valid email address");
  // Same answer whether or not the address was already on the list.
  await asService((tx) => tx.query("insert into app.waitlist (email) values ($1) on conflict do nothing", [parsed.data.email]));
  return Response.json({ ok: true });
}
