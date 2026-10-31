import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Field encryption for tax identifiers (EIN, SSN): AES-256-GCM with a 32-byte key that lives
 * outside the database (SHIPSHAPE_FIELD_KEY, base64). The organization id and field name are
 * bound in as associated data, so a ciphertext copied to another workspace or field won't open.
 */

const FORMAT = "v1";

function fieldKey(): Buffer {
  const raw = process.env.SHIPSHAPE_FIELD_KEY;
  if (!raw) throw new Error("SHIPSHAPE_FIELD_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SHIPSHAPE_FIELD_KEY must be 32 bytes, base64");
  return key;
}

export function encryptField(plain: string, orgId: string, field: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fieldKey(), iv);
  cipher.setAAD(Buffer.from(`${orgId}:${field}`));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [FORMAT, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptField(token: string, orgId: string, field: string): string {
  const [format, iv, tag, body] = token.split(".");
  if (format !== FORMAT || !iv || !tag || !body) throw new Error("Unreadable encrypted field");
  const decipher = createDecipheriv("aes-256-gcm", fieldKey(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`${orgId}:${field}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** A link token: 32 random bytes (256 bits). Only its SHA-256 is stored. */
export function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256Hex(token) };
}

/** HMAC for values we must correlate but never store raw (IP addresses in rate limits and access logs). */
export function keyedHash(value: string, purpose: string): string {
  const secret = process.env.SHIPSHAPE_SESSION_SECRET;
  if (!secret) throw new Error("SHIPSHAPE_SESSION_SECRET is not set");
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex").slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
