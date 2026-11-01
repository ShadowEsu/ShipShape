import { cookies } from "next/headers";
import { z } from "zod";
import { COLLECT_COOKIE, receiveFile } from "@/lib/server/collect";
import { MAX_UPLOAD_BYTES } from "@/lib/server/files";
import { clientIp, fail, rateLimited, sameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

// Room for the form's other fields and multipart boundaries around a 4 MB file.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

/**
 * A vendor sends one document through an upload link. A plain form post (works without
 * JavaScript); the answer is a redirect back to the page with an outcome code, never echoed text.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req.headers)) return fail("Forbidden", 403);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("Not found", 404);

  // `k` names the document whose form posted (it's in the form's own address), so the page can put a problem under its field.
  const k = new URL(req.url).searchParams.get("k") ?? "";
  const back = (outcome: string) =>
    new Response(null, { status: 303, headers: { Location: `/c/${id}?r=${outcome}&k=${encodeURIComponent(k)}`, "Cache-Control": "no-store" } });
  // A plain form post: the rate limit is an outcome on the page too, never a JSON answer in the vendor's browser.
  if (await rateLimited("collect-upload", clientIp(req.headers), 30, 600)) return back("busy");
  // Browsers always send the length of a form post; without it the body size is unknown, so no.
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!(length > 0 && length <= MAX_BODY_BYTES)) return back("too_big");

  const form = await req.formData().catch(() => null);
  if (!form) return back("empty");
  const upload = form.get("file");
  const file = upload instanceof File && upload.size > 0 ? { name: upload.name, bytes: new Uint8Array(await upload.arrayBuffer()) } : null;
  const token = (await cookies()).get(COLLECT_COOKIE)?.value;
  // No cookie: the page outlived its 30-minute token (lib/server/links.ts); nothing about the link itself. The page says to reopen it.
  if (!token) return back("reopen");
  const outcome = await receiveFile(id, token, { kind: form.get("kind"), expiresOn: form.get("expires_on"), file });
  return back(outcome === "sent" ? `sent-${String(form.get("kind"))}` : outcome);
}
