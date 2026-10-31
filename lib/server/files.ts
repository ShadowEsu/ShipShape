import "server-only";

/** Uploads: PDF, PNG and JPEG only, decided by the file's first bytes, never its name (Security R3). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type AllowedMime = "application/pdf" | "image/png" | "image/jpeg";

export const EXTENSION: Record<AllowedMime, "pdf" | "png" | "jpg"> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

// Uploaded PDFs are always served as attachments (never rendered in the app). On top of that,
// PDFs that launch programs or carry embedded files are refused, since a passport link could pass
// them on to someone else. Form scripts (/JavaScript, /AA) are common in official fillable forms
// and insurers' certificates, so they're allowed. Best effort: names inside compressed object
// streams aren't visible to this check.
const ACTIVE_PDF = /\/(Launch|EmbeddedFile|EmbeddedFiles|RichMedia)\b/;

export type UploadCheck = { ok: true; mime: AllowedMime } | { ok: false; error: string };

export function checkUpload(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Files can be up to 4 MB." };
  const mime = sniffMime(bytes);
  if (!mime) return { ok: false, error: "Upload a PDF, PNG or JPEG." };
  if (mime === "application/pdf" && ACTIVE_PDF.test(Buffer.from(bytes).toString("latin1"))) {
    return { ok: false, error: "This PDF launches other programs or carries embedded files, which we don't accept. Print it to a new PDF and try again." };
  }
  return { ok: true, mime };
}
