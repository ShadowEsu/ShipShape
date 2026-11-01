import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Field encryption for tax identifiers (EIN, SSN): AES-256-GCM with a 32-byte key that lives
 * outside the database (SHIPSHAPE_FIELD_KEY, base64). The organization id and field name are
 * bound in as associated data, so a ciphertext copied to another workspace or field won't open.
 * Format: v1.<key id>.<iv>.<tag>.<ciphertext>; the key id (first 8 hex of the key's SHA-256)
 * names the key, so a later rotation can tell old ciphertexts apart.
 */

const FORMAT = "v1";

type Env = Record<string, string | undefined>;

/** SHIPSHAPE_FIELD_KEY (32 bytes, base64) and its short id; throws while unset or the wrong size. */
export function fieldKey(env: Env = process.env): { key: Buffer; id: string } {
  const raw = env.SHIPSHAPE_FIELD_KEY;
  if (!raw) throw new Error("SHIPSHAPE_FIELD_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SHIPSHAPE_FIELD_KEY must be 32 bytes, base64");
  return { key, id: createHash("sha256").update(key).digest("hex").slice(0, 8) };
}

export function encryptField(plain: string, orgId: string, field: string): string {
  const { key, id } = fieldKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${orgId}:${field}`));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [FORMAT, id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptField(token: string, orgId: string, field: string): string {
  const [format, kid, iv, tag, body] = token.split(".");
  if (format !== FORMAT || !kid || !iv || !tag || !body) throw new Error("Unreadable encrypted field");
  const { key, id } = fieldKey();
  if (kid !== id) throw new Error("Encrypted with a different key");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: 16 });
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

/** SHIPSHAPE_HASH_KEY; throws while unset or under 32 characters. */
export function hashKey(env: Env = process.env): string {
  const secret = env.SHIPSHAPE_HASH_KEY;
  if (!secret || secret.length < 32) throw new Error("SHIPSHAPE_HASH_KEY must be at least 32 characters");
  return secret;
}

/**
 * HMAC for values we must correlate but never store raw (IP addresses in rate limits and access
 * logs). Its own key, so rotating the session secret doesn't reset rate limits.
 */
export function keyedHash(value: string, purpose: string): string {
  return createHmac("sha256", hashKey()).update(`${purpose}:${value}`).digest("hex").slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
