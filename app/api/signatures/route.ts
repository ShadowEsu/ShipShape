import { body, fail, json } from "@/lib/http";
import { store } from "@/lib/store";

export async function POST(req: Request) {
  const { documentId, name, email } = await body<{ documentId: string; name: string; email: string }>(req);
  if (!documentId || !name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "")) return fail("A document, a name and a valid email are needed");
  try {
    return json(await store.requestSignature(documentId, name.trim(), email!.trim().toLowerCase()));
  } catch (e) {
    return fail((e as Error).message, 404);
  }
}
