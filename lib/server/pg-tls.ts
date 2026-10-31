/**
 * TLS for every network Postgres connection (the app and scripts/migrate.ts): chain and hostname
 * always verified. postgres.js's `ssl: "require"` would encrypt without checking who answers. RDS and
 * Supabase sign with their own CAs, so DATABASE_CA_CERT holds the provider's CA bundle (PEM); without
 * it Node's built-in CAs apply. Never falls back to unverified. Plain Node (no `server-only`), so the
 * script can load it.
 */
export function pgTls(): { rejectUnauthorized: true; ca?: string } {
  const ca = process.env.DATABASE_CA_CERT;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}
