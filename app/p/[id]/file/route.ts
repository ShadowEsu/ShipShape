import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp, fail, rateLimited, tooMany } from "@/lib/server/http";
import { PASSPORT_COOKIE, passportFileUrl } from "@/lib/server/passport";

export const dynamic = "force-dynamic";

/** Download from a passport: checks the link again, logs the download, redirects to a 5-minute link. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = clientIp(req.headers);
  if (await rateLimited("passport-file", ip, 60, 600)) return tooMany();
  const token = (await cookies()).get(PASSPORT_COOKIE)?.value ?? "";
  const url = await passportFileUrl(id, token, new URL(req.url).searchParams.get("d") ?? "", ip);
  if (!url) return fail("This link isn't available.", 404);
  redirect(url);
}
