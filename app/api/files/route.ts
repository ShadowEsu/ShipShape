import { blobStore, verifyFileParams } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" } as const;

/**
 * Local stand-in for Supabase Storage's signed URLs: serves one stored file for a link signed by
 * the server within the last 5 minutes. Production serves files from the storage origin instead.
 */
export async function GET(req: Request) {
  const file = verifyFileParams(new URL(req.url).searchParams);
  if (!file) return new Response("This link has expired or isn't valid.", { status: 403, headers: { "Cache-Control": "no-store" } });
  // verifyFileParams only accepts paths ending in .pdf, .png or .jpg.
  const ext = file.objectPath.split(".").pop() as keyof typeof TYPES;
  const bytes = await blobStore().get(file.objectPath);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": TYPES[ext],
      "Content-Disposition": `${file.inline ? "inline" : "attachment"}; filename="${file.filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
