import { z } from "zod";
import { asService } from "@/lib/server/db";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "@/lib/server/http";

const Body = z.object({
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
  interest: z.enum(["collect"]).optional(),
});

export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  if (await rateLimited("waitlist", clientIp(req.headers), 10, 3600)) return tooMany();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Enter a valid email address");
  const interests = parsed.data.interest ? [parsed.data.interest] : [];
  // Same answer whether or not the address was already on the list; a second sign-up adds its interest.
  await asService((tx) =>
    tx.query(
      `insert into app.waitlist (email, interests) values ($1, $2) on conflict (email) do update
         set interests = array(select distinct unnest(app.waitlist.interests || excluded.interests) order by 1)`,
      [parsed.data.email, interests],
    ),
  );
  return Response.json({ ok: true });
}
