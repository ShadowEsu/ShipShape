import { bytesStream } from "@/lib/server/http";
import { blobStore, ObjectMissing, verifyFileParams } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" } as const;

/**
 * Serves one stored file for a link the server signed within the last 5 minutes, streaming it from
 * the store (a folder locally, the private S3 bucket in production), so no storage URL ever reaches
 * a browser.
 */
export async function GET(req: Request) {
  const file = verifyFileParams(new URL(req.url).searchParams);
  const invalid = (status: 403 | 404) => new Response("This link has expired or isn't valid.", { status, headers: { "Cache-Control": "no-store" } });
  if (!file) return invalid(403);
  // verifyFileParams only accepts paths ending in .pdf, .png or .jpg.
  const ext = file.objectPath.split(".").pop() as keyof typeof TYPES;
  let bytes: Uint8Array;
  try {
    bytes = await blobStore().get(file.objectPath);
  } catch (e) {
    // The object went inside the link's 5 minutes (a deleted file, account or sample): the link is no longer valid (W11-12).
    if (e instanceof ObjectMissing) return invalid(404);
    throw e;
  }
  return new Response(bytesStream(bytes), {
    headers: {
      "Content-Type": TYPES[ext],
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${file.inline ? "inline" : "attachment"}; filename="${file.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
