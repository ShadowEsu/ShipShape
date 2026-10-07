import { body, fail, json } from "@/lib/http";
import { store } from "@/lib/store";

export async function POST(req: Request) {
  const { email } = await body<{ email: string }>(req);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "") || email!.length > 200) return fail("Enter a valid email");
  await store.joinWaitlist(email!.trim().toLowerCase());
  return json({ ok: true });
}
