import { z } from "zod";
import { asService } from "@/lib/server/db";
import { clientIp, fail, rateLimited, sameOrigin, tooMany } from "@/lib/server/http";
import { sessionInHeader } from "@/lib/server/session";

const Body = z.object({
  email: z.string().trim().toLowerCase().max(200).pipe(z.email()),
  interest: z.enum(["collect"]).optional(),
  // Sent by the forms inside the sample workspace (WaitlistForm inSample), not by the site's.
  from: z.enum(["sample"]).optional(),
});

export async function POST(req: Request) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  if (await rateLimited("waitlist", clientIp(req.headers), 10, 3600)) return tooMany();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Enter your email address, like you@business.com.");
  const interests = parsed.data.interest ? [parsed.data.interest] : [];
  // Same answer whether or not the address was already on the list; a second sign-up adds its interest.
  // A new address also adds 1 to today's count for where it came from (0051): a form inside the sample workspace, which
  // takes the form saying so and a valid sample session (the session alone would count the site's forms too), or not.
  const fromSample = parsed.data.from === "sample" && sessionInHeader(req.headers.get("cookie"))?.demo === true;
  const source = fromSample ? "sample" : "site";
  await asService(async (tx) => {
    const [row] = await tx.query<{ added: boolean }>(
      `insert into app.waitlist (email, interests) values ($1, $2) on conflict (email) do update
         set interests = array(select distinct unnest(app.waitlist.interests || excluded.interests) order by 1)
       returning (xmax = 0) as added`,
      [parsed.data.email, interests],
    );
    if (row?.added)
      await tx.query(
        `insert into app.waitlist_tally as t (day, source, joined) values ((now() at time zone 'utc')::date, $1, 1)
           on conflict (day, source) do update set joined = t.joined + 1`,
        [source],
      );
  });
  return Response.json({ ok: true });
}
