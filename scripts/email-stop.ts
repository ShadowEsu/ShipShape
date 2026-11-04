#!/usr/bin/env node
/**
 * The manual "stop" (Security 2026-11-04 1058, K3): someone replied "stop" or wrote to the support address
 * asking for no more email. Puts their address on the suppression list as a keyed hash, so ShipShape emails
 * it nothing of any kind again (lib/server/mail.ts checks the list before every send):
 *
 *   node scripts/email-stop.ts      then type the address and press Enter (stdin, so it stays out of the
 *                                   shell's history and the process list)
 *
 * MIGRATE_DATABASE_URL  the master user's connection string, from Secrets Manager for this run only.
 * DATABASE_CA_CERT      the provider's CA bundle (PEM); the certificate is always verified.
 * SHIPSHAPE_HASH_KEY    production's hash key (Vercel, Production), for this run only: the list's hashes are
 *                       keyed with it, and one made with another key matches nothing.
 *
 * Prints whether the address was added or already on the list, never the address itself.
 */
import { createInterface } from "node:readline";
import postgres from "postgres";
import { pgTls } from "../lib/server/pg-tls.ts";
import { stopEmail } from "../lib/server/suppression.ts";

const url = process.env.MIGRATE_DATABASE_URL;
const key = process.env.SHIPSHAPE_HASH_KEY ?? "";
if (!url || key.length < 32) {
  console.error("Set MIGRATE_DATABASE_URL to the master user's connection string and SHIPSHAPE_HASH_KEY to production's hash key.");
  process.exit(1);
}

const lines = createInterface({ input: process.stdin });
const address = await new Promise<string>((resolve) => {
  lines.once("line", (line) => resolve(line));
  lines.once("close", () => resolve(""));
});
lines.close();

const sql = postgres(url, { max: 1, connect_timeout: 10, ssl: pgTls(), onnotice: () => {} });
try {
  const added = await stopEmail((text, params) => sql.unsafe(text, params), address, key);
  console.log(added ? "Added to the suppression list: ShipShape emails this address nothing from now on." : "Already on the suppression list: nothing changed.");
} catch (e) {
  // One line: the error's message, which never holds the address (stopEmail's refusals don't quote it).
  console.error(`FAIL: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
