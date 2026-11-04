/**
 * The email suppression list's key and its manual "stop" (Security 2026-11-04 1058, K3): the sender checks
 * the list before every email of every kind (lib/server/mail.ts), and a person who writes "stop" (or asks
 * to come off) is added by scripts/email-stop.ts. Each entry is a keyed hash of the trimmed, lowercased
 * address (SHIPSHAPE_HASH_KEY; the same HMAC as crypto.ts's keyedHash, purpose "email-suppression"),
 * never the address itself. Plain Node: no `server-only` and no `@/` imports, so the script can load it.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";

/** The list's entry for `address`: 32 hex digits, under `key` (SHIPSHAPE_HASH_KEY). */
export function suppressionHash(address: string, key: string): string {
  return createHmac("sha256", key).update(`email-suppression:${address.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

/** Runs one statement with its text parameters: the app's service-role transaction, or the script's connection. */
export type RunSql = (text: string, params: string[]) => Promise<readonly unknown[]>;

/**
 * Puts `address` on the suppression list as a "stop": from then on nothing of any kind is emailed to it.
 * True when it was added, false when it was already there (for any reason). An address that isn't one is
 * refused, so a typo can't look like a stop that worked.
 */
export async function stopEmail(run: RunSql, address: string, key: string): Promise<boolean> {
  if (!z.email().safeParse(address.trim()).success) throw new Error("That isn't an email address.");
  if (key.length < 32) throw new Error("SHIPSHAPE_HASH_KEY must be at least 32 characters");
  const added = await run("insert into app.email_suppressions (address_hash, reason) values ($1, 'stop') on conflict (address_hash) do nothing returning 1", [
    suppressionHash(address, key),
  ]);
  return added.length > 0;
}

/**
 * The operator's whole "stop" (Security S-W1): the suppression entry, and the address's waitlist entry deleted, so
 * the waitlist note's "come off the list" and "we'll delete it" are both true. Run it as shipshape_owner, in one
 * transaction (scripts/email-stop.ts): the app's roles can't delete from the waitlist.
 */
export async function stopAndForget(run: RunSql, address: string, key: string): Promise<{ added: boolean; waitlistRemoved: boolean }> {
  const added = await stopEmail(run, address, key);
  const removed = await run("delete from app.waitlist where email = $1 returning 1", [address.trim().toLowerCase()]);
  return { added, waitlistRemoved: removed.length > 0 };
}
